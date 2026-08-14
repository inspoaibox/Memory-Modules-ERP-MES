import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardCheck, Download, Eye, FilePlus2, Play, Printer, RefreshCw, Search, ShieldAlert, X } from "lucide-react";
import { User, request } from "./api";
import { downloadProductionTask, printProductionTask, ProductionTaskDetail, ProductionTaskDetailModal } from "./ProductionPage";
import { DisassemblyReportModal } from "./DisassemblyReportModal";
import { AssemblyReportModal } from "./AssemblyReportModal";
import {
  createDefaultOperationData,
  getOperationRows,
  getOperationTemplate,
  type OperationData,
  type OperationRow
} from "./productionOperationTemplates";
import { ChipTestRowsEditor } from "./ChipTestRowsEditor";
import {
  OperationFieldsTable,
  ProductionReportEntryTable,
  ProductionWorkOrderEntryTable,
  type ReportEntryForm,
  type WorkOrderEntryForm
} from "./ProductionEntryTable";

export type ProductionStationKey =
  | "bga"
  | "disassembly"
  | "assembly"
  | "chip-initial-test"
  | "outsource"
  | "chip-retest"
  | "smt"
  | "aging"
  | "fqc";

type TaskStatus = "pending" | "ready" | "in_progress" | "completed" | "abnormal" | "cancelled";
type TaskFlowStatus = "active" | "awaiting_quality" | "awaiting_inventory";
type WorkOrderExecutionStatus = "normal" | "paused" | "terminated";
type WorkOrderTerminationType = "" | "stop" | "terminate";
type QualityCheckStatus = "pending" | "passed" | "failed";
type ProcessType = "manufacturing" | "testing" | "outsourcing" | "repair" | "warehouse" | "inspection";
type WorkOrderPriority = "low" | "normal" | "urgent";

type ProductionTask = {
  id: number;
  taskNo: string;
  workOrderItemId: number | null;
  workOrderItemLineNo: number;
  workOrderNo: string;
  executionStatus: WorkOrderExecutionStatus;
  terminationType: WorkOrderTerminationType;
  productItemCode: string;
  productItemName: string;
  productTrackingMode: "none" | "lot" | "serial";
  itemRouteName: string | null;
  processCode: string;
  processName: string;
  processType: ProcessType;
  sequenceNo: number;
  assignedUserId: number | null;
  assignedUserName: string | null;
  plannedQuantity: number;
  inputQuantity: number;
  goodQuantity: number;
  outputQuantity: number;
  defectQuantity: number;
  status: TaskStatus;
  flowStatus: TaskFlowStatus;
  outputDocumentNo: string | null;
};

type QualityCheck = {
  id: number;
  checkNo: string;
  quantity: number;
  passedQuantity: number;
  failedQuantity: number;
  status: QualityCheckStatus;
  checkResult: string;
  taskNo: string;
  workOrderItemLineNo: number;
  workOrderNo: string;
  productItemCode: string;
  productItemName: string;
  processCode: string;
  processName: string;
  inspectorName: string | null;
  executionStatus: WorkOrderExecutionStatus;
  terminationType: WorkOrderTerminationType;
};

type StationDefinition = {
  processCode: string;
  title: string;
  description: string;
  qualityGate: boolean;
};

type ProductItem = {
  id: number;
  itemCode: string;
  name: string;
  status: "active" | "inactive";
};

type ProductionRoute = {
  id: number;
  code: string;
  name: string;
  status: "active" | "inactive";
};

type Operator = {
  id: number;
  displayName: string;
  employeeNo: string;
  position: string;
  processId: number | null;
  processName: string | null;
};

const stations: Record<ProductionStationKey, StationDefinition> = {
  bga: {
    processCode: "PROC-BGA",
    title: "芯片拆卸植球",
    description: "处理本工位已派发任务，并提交拆卸、植球等前处理的实际报工。",
    qualityGate: false
  },
  disassembly: {
    processCode: "PROC-DISASSEMBLY",
    title: "生产拆解",
    description: "处理生产拆解任务，并按现有工单、派工、报工和流转规则记录现场作业。",
    qualityGate: false
  },
  assembly: {
    processCode: "PROC-ASSEMBLY",
    title: "生产组装",
    description: "处理生产组装任务，并按现有工单、派工、报工和流转规则记录现场作业。",
    qualityGate: false
  },
  "chip-initial-test": {
    processCode: "PROC-CHIP-TEST",
    title: "芯片初测",
    description: "处理植球后的芯片初步测试任务，并完成本阶段质量判定。",
    qualityGate: true
  },
  outsource: {
    processCode: "PROC-OUTSOURCE",
    title: "委外加工",
    description: "登记本工位的委外加工流转与回厂交接任务。",
    qualityGate: false
  },
  "chip-retest": {
    processCode: "PROC-CHIP-RETEST",
    title: "委外回厂复测",
    description: "处理委外回厂后的芯片复测任务，合格后受控流转至半成品仓。",
    qualityGate: true
  },
  smt: {
    processCode: "PROC-SMT",
    title: "SMT贴片",
    description: "处理半成品贴片任务，并提交本工位的投入、合格与不良数量。",
    qualityGate: false
  },
  aging: {
    processCode: "PROC-AGING",
    title: "成品测试老化",
    description: "处理成品功能测试与老化任务，并完成本阶段质量判定。",
    qualityGate: true
  },
  fqc: {
    processCode: "PROC-FQC",
    title: "日检合格成品入库",
    description: "处理日检放行任务；判定合格后系统生成进入成品仓的受控入库单。",
    qualityGate: true
  }
};

const taskStatusLabels: Record<TaskStatus, string> = {
  pending: "待流转",
  ready: "待开工",
  in_progress: "进行中",
  completed: "已完成",
  abnormal: "异常",
  cancelled: "已取消"
};

const qualityStatusLabels: Record<QualityCheckStatus, string> = {
  pending: "待判定",
  passed: "已通过",
  failed: "不合格"
};

const workOrderExecutionLabels: Record<WorkOrderExecutionStatus, string> = {
  normal: "正常执行",
  paused: "已暂停",
  terminated: "已终止"
};

const workOrderTerminationLabels: Record<WorkOrderTerminationType, string> = {
  "": "",
  stop: "停止",
  terminate: "终止"
};

const hasPermission = (user: User, code: string) => user.permissions.some((permission) => permission.code === code);
const isSystemAdmin = (user: User) => user.roles.some((role) => role.code === "SYSTEM_ADMIN");
const today = () => new Date().toISOString().slice(0, 10);

export function ProductionStationPage({ currentUser, station }: { currentUser: User; station: ProductionStationKey }) {
  const definition = stations[station];
  const canViewQuality = definition.qualityGate && hasPermission(currentUser, "quality.inspection.view");

  return (
    <div className="inventory-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">生产工位</span>
          <h1>{definition.title}</h1>
          <p>{definition.description}</p>
        </div>
      </div>
      <StationTasksPanel currentUser={currentUser} station={definition} />
      {canViewQuality && <StationQualityPanel currentUser={currentUser} station={definition} />}
    </div>
  );
}

function StationTasksPanel({ currentUser, station }: { currentUser: User; station: StationDefinition }) {
  const [items, setItems] = useState<ProductionTask[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskStatus>("all");
  const [reporting, setReporting] = useState<ProductionTask | null>(null);
  const [detail, setDetail] = useState<ProductionTaskDetail | null>(null);
  const [showWorkOrderForm, setShowWorkOrderForm] = useState(false);
  const [error, setError] = useState("");
  const canExecute = hasPermission(currentUser, "production.operations.execute");
  const canCreateWorkOrder = hasPermission(currentUser, "production.workorders.manage")
    && (isSystemAdmin(currentUser) || currentUser.authorizedProcessCodes.includes(station.processCode));

  const load = () => {
    const params = new URLSearchParams({ processCode: station.processCode });
    if (statusFilter !== "all") params.set("status", statusFilter);
    return request<{ items: ProductionTask[] }>(`/production/tasks?${params.toString()}`)
      .then((result) => setItems(result.items))
      .catch((loadError) => setError(errorMessage(loadError)));
  };

  useEffect(() => { void load(); }, [station.processCode, statusFilter]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return items.filter((item) => !keyword || `${item.taskNo}${item.workOrderNo}${item.productItemCode}${item.productItemName}${item.assignedUserName ?? ""}`.toLowerCase().includes(keyword));
  }, [items, query]);

  const startTask = async (task: ProductionTask) => {
    setError("");
    try {
      await request(`/production/tasks/${task.id}/start`, { method: "POST" });
      await load();
    } catch (actionError) {
      setError(errorMessage(actionError));
    }
  };
  const recordTaskOutput = async (id: number, action: "preview" | "print" | "download") => {
    try {
      await request(`/production/tasks/${id}/output-actions`, { method: "POST", body: JSON.stringify({ action }) });
    } catch (auditError) {
      console.error("生产任务输出操作审计记录失败", auditError);
    }
  };
  const openDetail = async (id: number) => {
    try {
      setError("");
      const result = await request<ProductionTaskDetail>(`/production/tasks/${id}`);
      setDetail(result);
      void recordTaskOutput(id, "preview");
    } catch (actionError) {
      setError(errorMessage(actionError));
    }
  };
  const printTask = async (id: number) => {
    try {
      setError("");
      const result = await request<ProductionTaskDetail>(`/production/tasks/${id}`);
      printProductionTask(result);
      void recordTaskOutput(id, "print");
    } catch (actionError) {
      setError(errorMessage(actionError));
    }
  };
  const downloadTask = async (id: number) => {
    try {
      setError("");
      const result = await request<ProductionTaskDetail>(`/production/tasks/${id}`);
      downloadProductionTask(result);
      void recordTaskOutput(id, "download");
    } catch (actionError) {
      setError(errorMessage(actionError));
    }
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <div><span className="eyebrow">本工位任务</span><h2>{station.title}</h2><p>只显示当前工位的任务，不与其他生产环节混合。</p></div>
        <div className="header-actions">
          <button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} />刷新</button>
          {canCreateWorkOrder && <button className="primary-button" onClick={() => setShowWorkOrderForm(true)}><FilePlus2 size={16} />新建本工序工单</button>}
        </div>
      </div>
      <div className="toolbar">
        <div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、工单、商品或执行员工" /></div>
        <div className="inventory-filters production-inline-filter"><label>任务状态<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | TaskStatus)}><option value="all">全部状态</option>{Object.entries(taskStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="table-wrap"><table className="production-table"><thead><tr><th>任务</th><th>工单 / 商品</th><th>执行员工</th><th>计划 / 已投入</th><th>合格 / 流转 / 不良</th><th>状态</th><th className="action-cell document-output-cell">任务输出</th><th className="action-cell">操作</th></tr></thead><tbody>
        {filtered.map((item) => {
          const canExecuteTask = isSystemAdmin(currentUser) || item.assignedUserId === currentUser.id;
          const executionAvailable = item.executionStatus === "normal";
          return <tr key={item.id}><td><strong>{item.taskNo}</strong><small>P{String(item.workOrderItemLineNo).padStart(2, "0")} · 第 {item.sequenceNo} 道 · {item.processName}</small></td><td><strong>{item.workOrderNo}</strong><small>{item.productItemName} · {item.productItemCode}</small></td><td><strong>{item.assignedUserName || "未派工"}</strong></td><td><strong>{formatQuantity(item.plannedQuantity)}</strong><small>已投入 {formatQuantity(item.inputQuantity)}</small></td><td><strong>{formatQuantity(item.goodQuantity)}</strong><small className="muted-cell">已流转 {formatQuantity(item.outputQuantity)}</small><small className={item.defectQuantity > 0 ? "quantity-negative" : "muted-cell"}>不良 {formatQuantity(item.defectQuantity)}</small></td><td><div className="work-order-status-stack">{item.flowStatus === "awaiting_quality" ? <span className="production-status ready">待质检</span> : item.flowStatus === "awaiting_inventory" ? <span className="production-status ready">待入库</span> : <TaskStatusBadge status={item.status} />}<WorkOrderExecutionBadge status={item.executionStatus} terminationType={item.terminationType} /></div>{item.outputDocumentNo && <small className="code-cell">{item.outputDocumentNo}</small>}</td><td className="action-cell document-output-cell"><StationTaskOutputActions onPreview={() => void openDetail(item.id)} onPrint={() => void printTask(item.id)} onDownload={() => void downloadTask(item.id)} /></td><td className="action-cell"><div className="table-actions">{executionAvailable && canExecute && canExecuteTask && item.status === "ready" && item.flowStatus === "active" && <button className="table-action" onClick={() => void startTask(item)}><Play size={14} />开工</button>}{executionAvailable && canExecute && canExecuteTask && item.status === "in_progress" && item.flowStatus === "active" && <button className="table-action" onClick={() => setReporting(item)}>报工</button>}</div></td></tr>;
        })}
        {!filtered.length && <EmptyTable colSpan={8} title="暂无本工位任务" description="本工位暂无已派发任务，或当前账号无可查看的数据范围。" />}
      </tbody></table></div>
      {reporting && (station.processCode === "PROC-DISASSEMBLY"
        ? <DisassemblyReportModal task={reporting} onClose={() => setReporting(null)} onSaved={() => { setReporting(null); void load(); }} />
        : station.processCode === "PROC-ASSEMBLY"
          ? <AssemblyReportModal task={reporting} onClose={() => setReporting(null)} onSaved={() => { setReporting(null); void load(); }} />
          : <StationReportModal task={reporting} onClose={() => setReporting(null)} onSaved={() => { setReporting(null); void load(); }} />)}
      {detail && <ProductionTaskDetailModal detail={detail} onClose={() => setDetail(null)} onPrint={() => { printProductionTask(detail); void recordTaskOutput(detail.item.id, "print"); }} onDownload={() => { downloadProductionTask(detail); void recordTaskOutput(detail.item.id, "download"); }} />}
      {showWorkOrderForm && <StationWorkOrderForm station={station} onClose={() => setShowWorkOrderForm(false)} onSaved={() => { setShowWorkOrderForm(false); void load(); }} />}
    </section>
  );
}

function StationWorkOrderForm({ station, onClose, onSaved }: { station: StationDefinition; onClose: () => void; onSaved: () => void }) {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [routes, setRoutes] = useState<ProductionRoute[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<WorkOrderEntryForm>({
    lines: [{ productItemId: "", routeId: "", plannedQuantity: "", remark: "" }],
    managerUserId: "",
    priority: "normal",
    plannedStartDate: today(),
    plannedEndDate: "",
    remark: ""
  });

  useEffect(() => {
    let active = true;
    void Promise.all([
      request<{ items: ProductItem[] }>("/inventory/items"),
      request<{ items: ProductionRoute[] }>(`/production/routes?processCode=${encodeURIComponent(station.processCode)}`),
      request<{ items: Operator[] }>(`/production/operators?processCode=${encodeURIComponent(station.processCode)}`)
    ])
      .then(([productResult, routeResult, operatorResult]) => {
        if (!active) return;
        setProducts(productResult.items.filter((item) => item.status === "active"));
        setRoutes(routeResult.items.filter((route) => route.status === "active"));
        setOperators(operatorResult.items);
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [station.processCode]);

  const submit = async () => {
    setError("");
    setSaving(true);
    try {
      await request(`/production/processes/${encodeURIComponent(station.processCode)}/work-orders`, {
        method: "POST",
        body: JSON.stringify({
          items: form.lines.map((line) => ({
            productItemId: Number(line.productItemId),
            routeId: Number(line.routeId),
            plannedQuantity: Number(line.plannedQuantity),
            remark: line.remark
          })),
          managerUserId: form.managerUserId ? Number(form.managerUserId) : null,
          priority: form.priority as WorkOrderPriority,
          plannedStartDate: form.plannedStartDate,
          plannedEndDate: form.plannedEndDate,
          remark: form.remark
        })
      });
      onSaved();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <StationModal title={`新建${station.title}工单`} onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="form-note">从当前工序直接发起并下达。系统只接受包含“{station.title}”的工艺路线，并从当前工序生成首个待开工任务，后续工序继续按该路线流转。</div>
        {loading
          ? <div className="form-note">正在加载商品、路线与工序员工...</div>
          : <ProductionWorkOrderEntryTable
              form={form}
              products={products}
              routes={routes}
              operators={operators}
              priorities={[
                { value: "low", label: "低" },
                { value: "normal", label: "普通" },
                { value: "urgent", label: "紧急" }
              ]}
              onChange={setForm}
            />}
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={loading || saving}>{saving ? "创建中..." : "创建并下达"} <Check size={16} /></button>
        </div>
      </form>
    </StationModal>
  );
}

function StationTaskOutputActions({ onPreview, onPrint, onDownload }: { onPreview: () => void; onPrint: () => void; onDownload: () => void }) {
  return <div className="document-output-actions"><button className="table-icon-action" onClick={onPreview} title="预览任务单" aria-label="预览任务单"><Eye size={16} /></button><button className="table-icon-action" onClick={onPrint} title="打印任务单" aria-label="打印任务单"><Printer size={16} /></button><button className="table-icon-action" onClick={onDownload} title="下载任务单 CSV" aria-label="下载任务单 CSV"><Download size={16} /></button></div>;
}

function StationQualityPanel({ currentUser, station }: { currentUser: User; station: StationDefinition }) {
  const [items, setItems] = useState<QualityCheck[]>([]);
  const [inspecting, setInspecting] = useState<QualityCheck | null>(null);
  const [error, setError] = useState("");
  const canManage = hasPermission(currentUser, "quality.inspection.manage");

  const load = () => request<{ items: QualityCheck[] }>(`/production/quality-checks?processCode=${encodeURIComponent(station.processCode)}`)
    .then((result) => setItems(result.items))
    .catch((loadError) => setError(errorMessage(loadError)));

  useEffect(() => { void load(); }, [station.processCode]);

  return (
    <section className="panel">
      <div className="panel-heading">
        <div><span className="eyebrow">本工位质检</span><h2>{station.title}判定</h2><p>仅显示本工位完成报工后产生的待判定记录。</p></div>
        <button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} />刷新</button>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="table-wrap"><table className="production-table"><thead><tr><th>质检单</th><th>任务 / 工单</th><th>商品</th><th>待检数量</th><th>合格 / 不合格</th><th>质检员</th><th>状态</th><th className="action-cell">操作</th></tr></thead><tbody>
        {items.map((item) => { const executionAvailable = item.executionStatus === "normal"; return <tr key={item.id}><td><strong>{item.checkNo}</strong><small>{item.processName}</small></td><td><strong>{item.taskNo}</strong><small>{item.workOrderNo} · P{String(item.workOrderItemLineNo).padStart(2, "0")}</small></td><td><strong>{item.productItemName}</strong><small>{item.productItemCode}</small></td><td className="quantity-cell">{formatQuantity(item.quantity)}</td><td><strong>{formatQuantity(item.passedQuantity)}</strong><small className={item.failedQuantity > 0 ? "quantity-negative" : "muted-cell"}>不合格 {formatQuantity(item.failedQuantity)}</small></td><td>{item.inspectorName || "-"}</td><td><div className="work-order-status-stack"><QualityStatusBadge status={item.status} /><WorkOrderExecutionBadge status={item.executionStatus} terminationType={item.terminationType} /></div></td><td className="action-cell">{canManage && executionAvailable && item.status === "pending" && <button className="table-action" onClick={() => setInspecting(item)}>判定</button>}</td></tr>; })}
        {!items.length && <EmptyTable colSpan={8} title="暂无本工位质检记录" description="本工位完成带质量关卡的报工后，会在这里形成待判定记录。" />}
      </tbody></table></div>
      {inspecting && <StationQualityModal item={inspecting} onClose={() => setInspecting(null)} onSaved={() => { setInspecting(null); void load(); }} />}
    </section>
  );
}

function StationReportModal({ task, onClose, onSaved }: { task: ProductionTask; onClose: () => void; onSaved: () => void }) {
  const template = getOperationTemplate(task.processCode, task.processName, task.processType);
  const remainingQuantity = Math.max(task.plannedQuantity - task.inputQuantity, 0);
  const [form, setForm] = useState<ReportEntryForm>({ reportDate: today(), inputQuantity: "", goodQuantity: "", defectQuantity: "0", reworkQuantity: "0", scrapQuantity: "0", lotNo: "", serialNo: "", defectCode: "", remark: "" });
  const [operationData, setOperationData] = useState<OperationData>(() => createDefaultOperationData(template, remainingQuantity));
  const isDetailTable = template.layout === "table";
  const detailTotals = isDetailTable ? operationRows(template, operationData).reduce<{ inputQuantity: number; goodQuantity: number; defectQuantity: number }>((totals, row) => ({
    inputQuantity: totals.inputQuantity + (Number(row.testQuantity) || 0),
    goodQuantity: totals.goodQuantity + (Number(row.goodQuantity) || 0),
    defectQuantity: totals.defectQuantity + (Number(row.defectQuantity) || 0)
  }), { inputQuantity: 0, goodQuantity: 0, defectQuantity: 0 }) : null;
  return <StationModal title={`工位报工 · ${task.taskNo}`} onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className="form-note">计划 {formatQuantity(task.plannedQuantity)}，已投入 {formatQuantity(task.inputQuantity)}。所有工位统一用表格录入；芯片初测按型号逐行录入，数量由明细自动汇总。</div>
    {isDetailTable ? <ChipTestRowsEditor template={template} data={operationData} onChange={setOperationData} /> : <OperationFieldsTable template={template} data={operationData} onChange={setOperationData} />}
    <ProductionReportEntryTable form={form} onChange={setForm} lockedQuantities={isDetailTable} quantitySummary={isDetailTable ? detailTotals ?? undefined : undefined} />
    <StationModalActions onClose={onClose} onSubmit={async () => { await request(`/production/tasks/${task.id}/report`, { method: "POST", body: JSON.stringify({ ...form, inputQuantity: isDetailTable ? detailTotals?.inputQuantity ?? 0 : Number(form.inputQuantity), goodQuantity: isDetailTable ? detailTotals?.goodQuantity ?? 0 : Number(form.goodQuantity || 0), defectQuantity: isDetailTable ? detailTotals?.defectQuantity ?? 0 : Number(form.defectQuantity || 0), reworkQuantity: Number(form.reworkQuantity || 0), scrapQuantity: Number(form.scrapQuantity || 0), operationData }) }); onSaved(); }} />
  </form></StationModal>;

  function submit() {
    const button = window.document.querySelector<HTMLButtonElement>(".station-modal-submit");
    button?.click();
  }
}

function StationOperationFields({ template, data, onChange }: { template: ReturnType<typeof getOperationTemplate>; data: OperationData; onChange: (data: OperationData) => void }) {
  if (template.layout === "table") return <ChipTestRowsEditor template={template} data={data} onChange={onChange} />;
  return <OperationFieldsTable template={template} data={data} onChange={onChange} />;
}

function operationRows(template: ReturnType<typeof getOperationTemplate>, data: OperationData) {
  return getOperationRows(template, data);
}

function StationQualityModal({ item, onClose, onSaved }: { item: QualityCheck; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ passedQuantity: String(item.quantity), failedQuantity: "0", checkResult: "" });
  return <StationModal title={`质检判定 · ${item.checkNo}`} onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className="form-note">待检数量 {formatQuantity(item.quantity)}；不合格数量会自动进入不良维修闭环。</div>
    <div className="form-grid"><label>合格数量<input type="number" min="0" step="any" value={form.passedQuantity} onChange={(event) => setForm({ ...form, passedQuantity: event.target.value })} /></label><label>不合格数量<input type="number" min="0" step="any" value={form.failedQuantity} onChange={(event) => setForm({ ...form, failedQuantity: event.target.value })} /></label><label className="full-span">检验结论<textarea rows={3} value={form.checkResult} onChange={(event) => setForm({ ...form, checkResult: event.target.value })} /></label></div>
    <StationModalActions onClose={onClose} onSubmit={async () => { await request(`/production/quality-checks/${item.id}/inspect`, { method: "POST", body: JSON.stringify({ passedQuantity: Number(form.passedQuantity || 0), failedQuantity: Number(form.failedQuantity || 0), checkResult: form.checkResult }) }); onSaved(); }} />
  </form></StationModal>;

  function submit() {
    const button = window.document.querySelector<HTMLButtonElement>(".station-modal-submit");
    button?.click();
  }
}

function StationModalActions({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setError("");
    setSaving(true);
    try {
      await onSubmit();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };
  return <><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="button" className="primary-button station-modal-submit" onClick={() => void save()} disabled={saving}>{saving ? "提交中..." : "提交"} <Check size={16} /></button></div>{error && <div className="form-error">{error}</div>}</>;
}

function StationModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="eyebrow">生产工位</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div>{children}</section></div>;
}

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`production-status ${status}`}>{taskStatusLabels[status]}</span>;
}

function WorkOrderExecutionBadge({ status, terminationType }: { status: WorkOrderExecutionStatus; terminationType: WorkOrderTerminationType }) {
  const label = status === "terminated" && terminationType ? workOrderTerminationLabels[terminationType] : workOrderExecutionLabels[status];
  return <span className={`production-status execution-${status}`}>{label}</span>;
}

function QualityStatusBadge({ status }: { status: QualityCheckStatus }) {
  return <span className={`production-status ${status === "passed" ? "completed" : status === "failed" ? "abnormal" : "ready"}`}>{qualityStatusLabels[status]}</span>;
}

function EmptyTable({ colSpan, title, description }: { colSpan: number; title: string; description: string }) {
  return <tr><td colSpan={colSpan}><div className="empty-state"><div className="empty-icon"><ShieldAlert size={18} /></div><strong>{title}</strong><span>{description}</span></div></td></tr>;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value ?? 0);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}
