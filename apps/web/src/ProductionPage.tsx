import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  Check,
  ClipboardCheck,
  Download,
  Eye,
  Factory,
  FilePlus2,
  Pause,
  Play,
  Printer,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Square,
  Trash2,
  UserPlus,
  Wrench,
  X
} from "lucide-react";
import { User, request } from "./api";
import { DisassemblyReportModal } from "./DisassemblyReportModal";
import { AssemblyReportModal } from "./AssemblyReportModal";
import {
  createDefaultOperationData,
  formatOperationValue,
  getOperationRows,
  getOperationTemplate,
  type OperationData,
  type OperationField,
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

type ProcessType = "manufacturing" | "testing" | "outsourcing" | "repair" | "warehouse" | "inspection";
type OutputTarget = "next_process" | "semi_finished" | "finished_goods" | "repair";
type WorkOrderStatus = "draft" | "released" | "in_progress" | "completed" | "closed" | "cancelled";
type WorkOrderExecutionStatus = "normal" | "paused" | "terminated";
type WorkOrderTerminationType = "" | "stop" | "terminate";
type WorkOrderPriority = "low" | "normal" | "urgent";
type TaskStatus = "pending" | "ready" | "in_progress" | "completed" | "abnormal" | "cancelled";
type TaskFlowStatus = "active" | "awaiting_quality" | "awaiting_inventory";
type RepairStatus = "pending" | "repairing" | "retested" | "returned" | "scrapped" | "closed";
type QualityCheckStatus = "pending" | "passed" | "failed";

type ProductionProcess = {
  id: number;
  code: string;
  name: string;
  processType: ProcessType;
  sortOrder: number;
  description: string;
  status: "active" | "inactive";
  supervisorCount: number;
  authorizedRoleCount: number;
  authorizedUserCount: number;
};

type ProductItem = {
  id: number;
  itemCode: string;
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

type AuthorizationRole = { id: number; name: string; code: string };

type ProductionAuthorizationOptions = {
  roles: AuthorizationRole[];
  users: Operator[];
  warehouses: Array<{ id: number; code: string; name: string; departmentId: number; departmentName: string; warehouseType: WarehouseType }>;
};

type WarehouseType = "raw_material" | "semi_finished" | "finished_goods" | "quarantine" | "scrap" | "general";

type ProductionRouteOptions = {
  warehouses: Array<{ id: number; code: string; name: string; departmentId: number; departmentName: string; warehouseType: WarehouseType }>;
};

type ProductionRoute = {
  id: number;
  code: string;
  name: string;
  productItemId: number | null;
  productItemCode: string | null;
  productItemName: string | null;
  description: string;
  status: "active" | "inactive";
  stepCount: number;
};

type ProductionRouteStep = {
  id?: number;
  processId: number;
  processCode?: string;
  processName?: string;
  processType?: ProcessType;
  stepNo?: number;
  outputTarget: OutputTarget;
  outputItemId: number | null;
  outputItemCode?: string | null;
  outputItemName?: string | null;
  outputWarehouseId: number | null;
  outputWarehouseName?: string | null;
  qualityGate: boolean | number;
  description: string;
};

type WorkOrder = {
  id: number;
  workOrderNo: string;
  productItemId: number;
  productItemCode: string;
  productItemName: string;
  routeId: number;
  routeName: string;
  managerName: string | null;
  plannedQuantity: number;
  status: WorkOrderStatus;
  executionStatus: WorkOrderExecutionStatus;
  terminationType: WorkOrderTerminationType;
  priority: WorkOrderPriority;
  plannedStartDate: string;
  plannedEndDate: string;
  remark: string;
  createdByName: string;
  itemCount: number;
  itemSummaries: WorkOrderItemSummary[];
  taskCount: number;
  goodQuantity: number;
  defectQuantity: number;
  createdAt: string;
};

type WorkOrderItemSummary = {
  lineNo: number;
  productItemCode: string;
  productItemName: string;
  routeName: string;
  plannedQuantity: number;
  goodQuantity: number;
  defectQuantity: number;
  scrapQuantity: number;
};

type ProductionTask = {
  id: number;
  taskNo: string;
  workOrderId: number;
  workOrderItemId: number | null;
  workOrderItemLineNo: number;
  workOrderNo: string;
  executionStatus: WorkOrderExecutionStatus;
  terminationType: WorkOrderTerminationType;
  productItemCode: string;
  productItemName: string;
  productTrackingMode: "none" | "lot" | "serial";
  itemRouteName: string | null;
  processId: number;
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
  reworkQuantity: number;
  scrapQuantity: number;
  status: TaskStatus;
  flowStatus: TaskFlowStatus;
  outputDocumentId: number | null;
  outputDocumentNo: string | null;
  remark: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

type ProductionReport = {
  id: number;
  reportNo: string;
  reportDate: string;
  taskNo: string;
  workOrderItemLineNo: number;
  workOrderNo: string;
  productItemCode: string;
  productItemName: string;
  processName: string;
  operatorName: string;
  inputQuantity: number;
  goodQuantity: number;
  defectQuantity: number;
  reworkQuantity: number;
  scrapQuantity: number;
  lotNo: string;
  serialNo: string;
  operationData?: OperationData;
  remark: string;
  createdAt: string;
};

type ProductionTaskReport = Omit<ProductionReport, "taskNo" | "workOrderNo" | "productItemCode" | "productItemName" | "processName">;

export type ProductionTaskDetail = {
  item: ProductionTask;
  reports: ProductionTaskReport[];
  repairs: Array<Pick<RepairRecord, "id" | "repairNo" | "quantity" | "defectCode" | "defectDescription" | "itemSpecification" | "chipModel" | "chipName" | "chipSpec" | "sourceLotNo" | "sourceSerialNo" | "repairGoodQuantity" | "repairDefectQuantity" | "scrapQuantity" | "scrapReason" | "status" | "ownerName" | "createdAt" | "updatedAt">>;
  repairOperations: Array<{
    id: number;
    repairNo: string;
    repairGoodQuantity: number;
    repairDefectQuantity: number;
    scrapQuantity: number;
    scrapReason: string;
    operatorName: string;
    createdAt: string;
  }>;
  qualityChecks: Array<{
    id: number;
    checkNo: string;
    quantity: number;
    passedQuantity: number;
    failedQuantity: number;
    status: QualityCheckStatus;
    checkResult: string;
    inspectorName: string | null;
    checkedAt: string | null;
    createdAt: string;
  }>;
  inventoryDocuments: Array<{
    id: number;
    documentNo: string;
    documentType: string;
    status: string;
    businessDate: string;
    linkType: string;
    linkStatus: string;
    postedAt: string | null;
  }>;
  disassemblyLines: Array<{
    reportNo: string;
    lineNo: number;
    itemCode: string;
    itemName: string;
    quantity: number;
    destinationType: "warehouse" | "process";
    warehouseName: string | null;
    routeName: string | null;
    startProcessName: string | null;
    receiptDocumentNo: string | null;
    childWorkOrderNo: string | null;
    lotNo: string;
    serialNo: string;
    remark: string;
  }>;
  assemblyLines: Array<{
    reportNo: string;
    lineNo: number;
    itemCode: string;
    itemName: string;
    unitQuantity: number;
    quantity: number;
    warehouseCode: string;
    warehouseName: string;
    lotNo: string;
    serialNo: string;
    issueDocumentNo: string;
    remark: string;
  }>;
};

type RepairRecord = {
  id: number;
  taskId: number;
  repairNo: string;
  workOrderNo: string;
  workOrderItemLineNo: number;
  taskNo: string;
  itemCode: string | null;
  itemName: string | null;
  quantity: number;
  defectCode: string;
  defectDescription: string;
  itemSpecification: string;
  chipModel: string;
  chipName: string;
  chipSpec: string;
  sourceLotNo: string;
  sourceSerialNo: string;
  repairGoodQuantity: number;
  repairDefectQuantity: number;
  scrapQuantity: number;
  scrapReason: string;
  status: RepairStatus;
  executionStatus: WorkOrderExecutionStatus;
  terminationType: WorkOrderTerminationType;
  ownerUserId: number | null;
  ownerName: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

type ScrapProductRecord = {
  id: number;
  repairNo: string;
  workOrderId: number;
  workOrderNo: string;
  workOrderItemLineNo: number;
  taskNo: string;
  itemCode: string | null;
  itemName: string | null;
  itemSpecification: string;
  chipModel: string;
  chipName: string;
  chipSpec: string;
  sourceLotNo: string;
  sourceSerialNo: string;
  scrapQuantity: number;
  scrapReason: string;
  repairGoodQuantity: number;
  repairDefectQuantity: number;
  defectCode: string;
  defectDescription: string;
  operatorName: string;
  createdAt: string;
};

type QualityCheck = {
  id: number;
  checkNo: string;
  quantity: number;
  passedQuantity: number;
  failedQuantity: number;
  status: QualityCheckStatus;
  checkResult: string;
  checkedAt: string | null;
  createdAt: string;
  taskId: number;
  taskNo: string;
  workOrderItemLineNo: number;
  taskFlowStatus: TaskFlowStatus;
  workOrderNo: string;
  productItemCode: string;
  productItemName: string;
  processName: string;
  inspectorName: string | null;
  executionStatus: WorkOrderExecutionStatus;
  terminationType: WorkOrderTerminationType;
};

const processTypeLabels: Record<ProcessType, string> = {
  manufacturing: "生产加工",
  testing: "生产测试",
  outsourcing: "委外加工",
  repair: "不良维修",
  warehouse: "半成品流转",
  inspection: "目检放行"
};

const outputTargetLabels: Record<Exclude<OutputTarget, "repair">, string> = {
  next_process: "进入下道工序",
  semi_finished: "半成品入库",
  finished_goods: "成品入库"
};

const warehouseTypeLabels: Record<WarehouseType, string> = {
  raw_material: "原料仓",
  semi_finished: "半成品仓",
  finished_goods: "成品仓",
  quarantine: "待检/隔离仓",
  scrap: "不良/报废仓",
  general: "综合仓"
};

const workOrderStatusLabels: Record<WorkOrderStatus, string> = {
  draft: "草稿",
  released: "已下达",
  in_progress: "生产中",
  completed: "已完成",
  closed: "已关闭",
  cancelled: "已取消"
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

const taskStatusLabels: Record<TaskStatus, string> = {
  pending: "待流转",
  ready: "待开工",
  in_progress: "进行中",
  completed: "已完成",
  abnormal: "异常",
  cancelled: "已取消"
};

const flowStatusLabels: Record<TaskFlowStatus, string> = {
  active: "",
  awaiting_quality: "待质检",
  awaiting_inventory: "待仓储入库"
};

const repairStatusLabels: Record<RepairStatus, string> = {
  pending: "待维修",
  repairing: "继续维修",
  retested: "维修完成",
  returned: "维修完成",
  scrapped: "维修完成",
  closed: "维修完成"
};

const qualityStatusLabels: Record<QualityCheckStatus, string> = {
  pending: "待检",
  passed: "已通过",
  failed: "不合格"
};

const priorityLabels: Record<WorkOrderPriority, string> = {
  low: "低",
  normal: "普通",
  urgent: "紧急"
};

const hasPermission = (user: User, code: string) => user.permissions.some((permission) => permission.code === code);
const isSystemAdmin = (user: User) => user.roles.some((role) => role.code === "SYSTEM_ADMIN");
const today = () => new Date().toISOString().slice(0, 10);

function ProductionPageLayout({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="inventory-page"><div className="page-header"><div><span className="eyebrow">生产管理</span><h1>{title}</h1><p>{description}</p></div></div>{children}</div>;
}

export function ProductionOverviewPage() {
  const [data, setData] = useState<{ cards: Array<{ key: string; label: string; value: number; tone: string }>; flow: Array<{ title: string; detail: string }> } | null>(null);
  const [error, setError] = useState("");
  const load = () => request<typeof data>("/production/dashboard").then(setData).catch((loadError) => setError(errorMessage(loadError)));
  useEffect(() => { void load(); }, []);
  return <ProductionPageLayout title="生产工作台" description="追踪工单、指定员工工序任务、质量关卡、维修和受控入库。">{error && <div className="form-error">{error}</div>}<div className="metric-grid">{(data?.cards ?? []).map((card) => <div className="metric-card" key={card.key}><div className={`metric-icon ${card.tone}`}><Factory size={20} /></div><div><span>{card.label}</span><strong>{formatQuantity(card.value)}</strong></div></div>)}{!data && [1, 2, 3, 4].map((item) => <div className="metric-card skeleton" key={item} />)}</div><section className="panel inventory-guide"><div className="panel-heading"><div><span className="eyebrow">MES 闭环</span><h2>受控生产路径</h2></div><RefreshCw size={18} className="muted-icon" /></div><div className="inventory-guide-list">{(data?.flow ?? []).map((item, index) => <GuideStep key={item.title} index={String(index + 1).padStart(2, "0")} title={item.title} detail={item.detail} />)}</div></section></ProductionPageLayout>;
}

export function ProductionProcessesPage({ currentUser }: { currentUser: User }) {
  return <ProductionPageLayout title="工序流程" description="维护生产拆解、生产组装、芯片拆卸植球等工序流程，并明确主管、岗位角色和员工账号。"><ProcessesPanel currentUser={currentUser} /></ProductionPageLayout>;
}

export function ProductionRoutesPage({ currentUser }: { currentUser: User }) {
  return <ProductionPageLayout title="工艺路线" description="按产品配置工序顺序、质量关卡和半成品/成品输出仓。"><RoutesPanel currentUser={currentUser} /></ProductionPageLayout>;
}

export function ProductionWorkOrdersPage({ currentUser }: { currentUser: User }) {
  return <ProductionPageLayout title="生产工单" description="工单下达后生成受控工序任务，实际产出以最后工序合格数量统计。"><WorkOrdersPanel currentUser={currentUser} /></ProductionPageLayout>;
}

export function ProductionTasksPage({ currentUser }: { currentUser: User }) {
  return <ProductionPageLayout title="工序任务" description="经理派给指定员工后，员工才能在已授权的工序上开工和报工。"><TasksPanel currentUser={currentUser} /></ProductionPageLayout>;
}

export function ProductionReportsPage() {
  return <ProductionPageLayout title="工序报工记录" description="追踪每次人工报工的投入、合格、不良、返工、报废和批次信息。"><ReportsPanel /></ProductionPageLayout>;
}

export function ProductionQualityPage({ currentUser }: { currentUser: User }) {
  return <ProductionPageLayout title="质量检验" description="质量关卡必须由质检员判定；不合格品自动进入维修闭环。"><QualityPanel currentUser={currentUser} /></ProductionPageLayout>;
}

export function ProductionRepairsPage({ currentUser }: { currentUser: User }) {
  return <ProductionPageLayout title="不良维修" description="维修完成后，合格品直接放行到下一道工序，报废品闭环不再流转。"><RepairsPanel currentUser={currentUser} /></ProductionPageLayout>;
}

export function ProductionScrapProductsPage() {
  return <ProductionPageLayout title="报废产品" description="汇总不良维修结算中产生报废数量的记录，按维修单、批次和序列号追踪报废流向。"><ScrapProductsPanel /></ProductionPageLayout>;
}

export function ProcessesPanel({ currentUser }: { currentUser: User }) {
  const [items, setItems] = useState<ProductionProcess[]>([]);
  const [editing, setEditing] = useState<ProductionProcess | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const canManage = hasPermission(currentUser, "production.processes.manage");
  const load = () => request<{ items: ProductionProcess[] }>("/production/processes").then((result) => setItems(result.items));
  useEffect(() => { void load(); }, []);
  const remove = async (item: ProductionProcess) => {
    if (!window.confirm(`确定删除工序“${item.name}”吗？删除后不可恢复。`)) return;
    setError("");
    try {
      await request(`/production/processes/${item.id}`, { method: "DELETE" });
      await load();
    } catch (removeError) {
      setError(errorMessage(removeError));
    }
  };
  return <MasterPanel title="工序列表" description="工序授权决定哪些主管、岗位角色和员工可以实际开工、报工。" count={`${items.length} 道`} canManage={canManage} onCreate={() => { setEditing(null); setShowForm(true); }} onRefresh={load}>{error && <div className="form-error">{error}</div>}<div className="table-wrap"><table><thead><tr><th>工序</th><th>类型</th><th>执行授权</th><th>排序</th><th>说明</th><th>状态</th><th className="action-cell">操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small className="code-cell">{item.code}</small></td><td>{processTypeLabels[item.processType]}</td><td>{item.supervisorCount} 名主管 / {item.authorizedRoleCount} 个角色 / {item.authorizedUserCount} 名员工</td><td>{item.sortOrder}</td><td className="muted-cell">{item.description || "-"}</td><td><StatusBadge status={item.status} /></td><td className="action-cell">{canManage && <div className="table-actions"><button className="table-action" onClick={() => { setEditing(item); setShowForm(true); }}>编辑</button><button className="table-action danger-action" onClick={() => void remove(item)}><Trash2 size={13} />删除</button></div>}</td></tr>)}{!items.length && <EmptyTable colSpan={7} title="暂无工序" description="系统初始化会内置基础工序，也可以由管理员继续新增。" />}</tbody></table></div>{showForm && <ProcessForm item={editing} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); void load(); }} />}</MasterPanel>;
}

function RoutesPanel({ currentUser }: { currentUser: User }) {
  const [items, setItems] = useState<ProductionRoute[]>([]);
  const [editing, setEditing] = useState<ProductionRoute | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const canManage = hasPermission(currentUser, "production.routes.manage");
  const load = () => request<{ items: ProductionRoute[] }>("/production/routes").then((result) => setItems(result.items));
  useEffect(() => { void load(); }, []);
  const remove = async (item: ProductionRoute) => {
    if (!window.confirm(`确定删除工艺路线“${item.name}”吗？删除后不可恢复。`)) return;
    setError("");
    try {
      await request(`/production/routes/${item.id}`, { method: "DELETE" });
      await load();
    } catch (removeError) {
      setError(errorMessage(removeError));
    }
  };
  return <MasterPanel title="工艺路线" description="系统初始化提供内存条标准生产路线模板；路线支持新增、编辑和删除，已被工单引用的路线不能直接删除。" count={`${items.length} 条`} canManage={canManage} onCreate={() => { setEditing(null); setShowForm(true); }} onRefresh={load}>{error && <div className="form-error">{error}</div>}<div className="table-wrap"><table><thead><tr><th>路线</th><th>适用商品</th><th>步骤</th><th>说明</th><th>状态</th><th className="action-cell">操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small className="code-cell">{item.code}</small></td><td>{item.productItemName ? <><strong>{item.productItemName}</strong><small className="code-cell">{item.productItemCode}</small></> : "通用路线模板"}</td><td>{item.stepCount} 道</td><td className="muted-cell">{item.description || "-"}</td><td><StatusBadge status={item.status} /></td><td className="action-cell">{canManage && <div className="table-actions"><button className="table-action" onClick={() => { setEditing(item); setShowForm(true); }}>编辑</button><button className="table-action danger-action" onClick={() => void remove(item)}><Trash2 size={13} />删除</button></div>}</td></tr>)}{!items.length && <EmptyTable colSpan={6} title="暂无工艺路线" description="系统初始化会内置标准路线模板，也可以由管理员继续新增。" />}</tbody></table></div>{showForm && <RouteForm item={editing} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); void load(); }} />}</MasterPanel>;
}

function WorkOrdersPanel({ currentUser }: { currentUser: User }) {
  const [items, setItems] = useState<WorkOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | WorkOrderStatus>("all");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const canManage = hasPermission(currentUser, "production.workorders.manage");
  const canControl = hasPermission(currentUser, "production.workorders.control");
  const canDelete = hasPermission(currentUser, "production.workorders.delete");
  const load = () => { const params = new URLSearchParams(); if (statusFilter !== "all") params.set("status", statusFilter); return request<{ items: WorkOrder[] }>(`/production/work-orders${params.toString() ? `?${params}` : ""}`).then((result) => setItems(result.items)); };
  useEffect(() => { void load(); }, [statusFilter]);
  const runAction = async (item: WorkOrder, action: "release" | "close" | "cancel" | "pause" | "resume" | "terminate" | "delete", terminationType?: "stop" | "terminate") => {
    setError("");
    try {
      if (action === "delete") {
        await request(`/production/work-orders/${item.id}`, { method: "DELETE" });
      } else {
        await request(`/production/work-orders/${item.id}/${action}`, {
          method: "POST",
          ...(action === "terminate" ? { body: JSON.stringify({ terminationType }) } : {})
        });
      }
      await load();
    } catch (actionError) {
      setError(errorMessage(actionError));
    }
  };
  const confirmAction = (item: WorkOrder, action: "pause" | "resume" | "stop" | "terminate" | "delete") => {
    const messages = {
      pause: `确定暂停工单 ${item.workOrderNo} 吗？暂停后不能开工、报工、质检、维修结算或生产入库。`,
      resume: `确定继续工单 ${item.workOrderNo} 吗？`,
      stop: `确定停止工单 ${item.workOrderNo} 吗？停止后不可继续生产，但会保留已产生的业务记录。`,
      terminate: `确定终止工单 ${item.workOrderNo} 吗？终止后不可恢复，只能保留历史并关闭工单。`,
      delete: `确定删除草稿工单 ${item.workOrderNo} 吗？删除后不可恢复。`
    } as const;
    if (!window.confirm(messages[action])) return;
    if (action === "stop" || action === "terminate") {
      void runAction(item, "terminate", action);
    } else {
      void runAction(item, action);
    }
  };
  const canCloseWorkOrder = (item: WorkOrder) =>
    canManage
    && item.status !== "closed"
    && (
      ["completed", "cancelled"].includes(item.status)
      || (item.executionStatus === "terminated" && ["released", "in_progress"].includes(item.status))
    );
  return (
    <section className="panel">
      <div className="panel-heading">
        <div><span className="eyebrow">生产计划</span><h2>生产工单</h2><p>草稿下达后生成工序任务；暂停允许继续，停止和终止不可恢复。</p></div>
        <div className="header-actions"><button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} />刷新</button>{canManage && <button className="primary-button" onClick={() => setShowForm(true)}><FilePlus2 size={16} />新建工单</button>}</div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="inventory-filters"><label>工单状态<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | WorkOrderStatus)}><option value="all">全部状态</option>{Object.entries(workOrderStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
      <div className="table-wrap"><table className="production-table"><thead><tr><th>工单</th><th>产品明细</th><th>路线</th><th>总计划数量</th><th>最终合格 / 报废</th><th>状态</th><th>负责人</th><th className="action-cell">操作</th></tr></thead><tbody>
        {items.map((item) => <tr key={item.id}>
          <td><strong>{item.workOrderNo}</strong><small>{priorityLabels[item.priority]} · {item.plannedStartDate || "-"} 至 {item.plannedEndDate || "-"}</small></td>
          <td>
            <strong>{item.itemCount} 项产品</strong>
            {item.itemSummaries.slice(0, 2).map((product) => <small key={product.lineNo} className="code-cell">P{String(product.lineNo).padStart(2, "0")} · {product.productItemCode} · {product.productItemName}</small>)}
            {item.itemSummaries.length > 2 && <small className="muted-cell">另有 {item.itemSummaries.length - 2} 项</small>}
          </td>
          <td><strong>{item.itemSummaries.length === 1 ? item.itemSummaries[0].routeName : "按产品明细路线执行"}</strong></td>
          <td className="quantity-cell">{formatQuantity(item.plannedQuantity)}</td>
          <td><strong>{formatQuantity(item.goodQuantity)}</strong><small className={item.defectQuantity > 0 ? "quantity-negative" : "muted-cell"}>报废 {formatQuantity(item.defectQuantity)}</small></td>
          <td><div className="work-order-status-stack"><WorkOrderStatusBadge status={item.status} /><span className={`production-status execution-${item.executionStatus}`}>{item.executionStatus === "terminated" && item.terminationType ? workOrderTerminationLabels[item.terminationType] : workOrderExecutionLabels[item.executionStatus]}</span></div></td>
          <td>{item.managerName || item.createdByName}</td>
          <td className="action-cell">
            <div className="work-order-actions">
              {item.status === "draft" && canManage && <div className="work-order-action-group"><button className="table-action" onClick={() => void runAction(item, "release")}>下达</button><button className="table-action danger-action" onClick={() => void runAction(item, "cancel")}>取消</button></div>}
              {canManage && item.status === "draft" && item.executionStatus === "normal" && canDelete && <div className="work-order-action-group"><button className="table-action danger-action" onClick={() => confirmAction(item, "delete")}><Trash2 size={13} />删除</button></div>}
              {canControl && ["released", "in_progress"].includes(item.status) && item.executionStatus === "normal" && <div className="work-order-action-group"><button className="table-action" onClick={() => confirmAction(item, "pause")}><Pause size={13} />暂停</button><button className="table-action danger-action" onClick={() => confirmAction(item, "stop")}><Square size={12} />停止</button><button className="table-action danger-action" onClick={() => confirmAction(item, "terminate")}><X size={13} />终止</button></div>}
              {canControl && item.executionStatus === "paused" && <div className="work-order-action-group"><button className="table-action" onClick={() => confirmAction(item, "resume")}><Play size={13} />继续</button><button className="table-action danger-action" onClick={() => confirmAction(item, "stop")}><Square size={12} />停止</button><button className="table-action danger-action" onClick={() => confirmAction(item, "terminate")}><X size={13} />终止</button></div>}
              {canCloseWorkOrder(item) && <div className="work-order-action-group"><button className="table-action" onClick={() => void runAction(item, "close")}>关闭</button></div>}
            </div>
          </td>
        </tr>)}
        {!items.length && <EmptyTable colSpan={8} title="暂无生产工单" description="创建工单并下达后，会自动生成工序任务。" />}
      </tbody></table></div>
      {showForm && <WorkOrderForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); void load(); }} />}
    </section>
  );
}

function TasksPanel({ currentUser }: { currentUser: User }) {
  const [items, setItems] = useState<ProductionTask[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | TaskStatus>("all");
  const [query, setQuery] = useState("");
  const [assigning, setAssigning] = useState<ProductionTask | null>(null);
  const [reporting, setReporting] = useState<ProductionTask | null>(null);
  const [detail, setDetail] = useState<ProductionTaskDetail | null>(null);
  const canManage = hasPermission(currentUser, "production.tasks.manage");
  const canReport = hasPermission(currentUser, "production.operations.execute");
  const load = () => { const params = new URLSearchParams(); if (statusFilter !== "all") params.set("status", statusFilter); return request<{ items: ProductionTask[] }>(`/production/tasks${params.toString() ? `?${params}` : ""}`).then((result) => setItems(result.items)); };
  useEffect(() => { void load(); }, [statusFilter]);
  const filtered = items.filter((item) => `${item.taskNo}${item.workOrderNo}${item.productItemName}${item.productItemCode}${item.processName}`.toLowerCase().includes(query.toLowerCase()));
  const startTask = async (item: ProductionTask) => { await request(`/production/tasks/${item.id}/start`, { method: "POST" }); await load(); };
  const recordTaskOutput = async (id: number, action: "preview" | "print" | "download") => {
    try {
      await request(`/production/tasks/${id}/output-actions`, { method: "POST", body: JSON.stringify({ action }) });
    } catch (auditError) {
      console.error("生产任务输出操作审计记录失败", auditError);
    }
  };
  const openDetail = async (id: number) => {
    const result = await request<ProductionTaskDetail>(`/production/tasks/${id}`);
    setDetail(result);
    void recordTaskOutput(id, "preview");
  };
  const printTask = async (id: number) => {
    const result = await request<ProductionTaskDetail>(`/production/tasks/${id}`);
    printProductionTask(result);
    void recordTaskOutput(id, "print");
  };
  const downloadTask = async (id: number) => {
    const result = await request<ProductionTaskDetail>(`/production/tasks/${id}`);
    downloadProductionTask(result);
    void recordTaskOutput(id, "download");
  };
  return (
    <section className="panel">
      <div className="panel-heading">
        <div><span className="eyebrow">现场执行</span><h2>工序任务</h2><p>待质检和待仓储入库都是系统阻塞状态，不能跳过。</p></div>
        <button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} />刷新</button>
      </div>
      <div className="toolbar">
        <div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、工单、商品或工序" /></div>
        <div className="inventory-filters production-inline-filter"><label>任务状态<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | TaskStatus)}><option value="all">全部状态</option>{Object.entries(taskStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
      </div>
      <div className="table-wrap">
        <table className="production-table">
          <thead><tr><th>任务</th><th>工单 / 商品</th><th>工序</th><th>派工</th><th>计划</th><th>合格 / 流转 / 不良</th><th>状态</th><th className="action-cell document-output-cell">任务输出</th><th className="action-cell">操作</th></tr></thead>
          <tbody>
            {filtered.map((item) => {
              const canExecuteThis = isSystemAdmin(currentUser) || item.assignedUserId === currentUser.id;
              const executionAvailable = item.executionStatus === "normal";
              return <tr key={item.id}><td><strong>{item.taskNo}</strong><small>P{String(item.workOrderItemLineNo).padStart(2, "0")} · 第 {item.sequenceNo} 道</small></td><td><strong>{item.workOrderNo}</strong><small>{item.productItemName} · {item.productItemCode}</small></td><td><strong>{item.processName}</strong><small>{item.itemRouteName || processTypeLabels[item.processType]}</small></td><td><strong>{item.assignedUserName || "未派工"}</strong></td><td className="quantity-cell">{formatQuantity(item.plannedQuantity)}</td><td><strong>{formatQuantity(item.goodQuantity)}</strong><small className="muted-cell">已流转 {formatQuantity(item.outputQuantity)}</small><small className={item.defectQuantity > 0 ? "quantity-negative" : "muted-cell"}>不良 {formatQuantity(item.defectQuantity)}</small></td><td><div className="work-order-status-stack">{item.flowStatus !== "active" ? <FlowStatusBadge status={item.flowStatus} /> : <TaskStatusBadge status={item.status} />}<WorkOrderExecutionBadge status={item.executionStatus} terminationType={item.terminationType} /></div>{item.outputDocumentNo && <small className="code-cell">{item.outputDocumentNo}</small>}</td><td className="action-cell document-output-cell"><TaskOutputActions onPreview={() => void openDetail(item.id)} onPrint={() => void printTask(item.id)} onDownload={() => void downloadTask(item.id)} /></td><td className="action-cell"><div className="table-actions">{executionAvailable && canManage && ["pending", "ready"].includes(item.status) && item.flowStatus === "active" && <button className="table-action" onClick={() => setAssigning(item)}>派工</button>}{executionAvailable && canReport && canExecuteThis && item.status === "ready" && item.flowStatus === "active" && <button className="table-action" onClick={() => void startTask(item)}>开工</button>}{executionAvailable && canReport && canExecuteThis && item.status === "in_progress" && item.flowStatus === "active" && <button className="table-action" onClick={() => setReporting(item)}>报工</button>}</div></td></tr>;
            })}
            {!filtered.length && <EmptyTable colSpan={9} title="暂无工序任务" description="下达生产工单后，任务会显示在这里。" />}
          </tbody>
        </table>
      </div>
      {assigning && <AssignTaskModal task={assigning} onClose={() => setAssigning(null)} onSaved={() => { setAssigning(null); void load(); }} />}
      {reporting && (reporting.processCode === "PROC-DISASSEMBLY"
        ? <DisassemblyReportModal task={reporting} onClose={() => setReporting(null)} onSaved={() => { setReporting(null); void load(); }} />
        : reporting.processCode === "PROC-ASSEMBLY"
          ? <AssemblyReportModal task={reporting} onClose={() => setReporting(null)} onSaved={() => { setReporting(null); void load(); }} />
          : <ReportTaskModal task={reporting} onClose={() => setReporting(null)} onSaved={() => { setReporting(null); void load(); }} />)}
      {detail && <ProductionTaskDetailModal detail={detail} onClose={() => setDetail(null)} onPrint={() => { printProductionTask(detail); void recordTaskOutput(detail.item.id, "print"); }} onDownload={() => { downloadProductionTask(detail); void recordTaskOutput(detail.item.id, "download"); }} />}
    </section>
  );
}

function TaskOutputActions({ onPreview, onPrint, onDownload }: { onPreview: () => void; onPrint: () => void; onDownload: () => void }) {
  return <div className="document-output-actions"><button className="table-icon-action" onClick={onPreview} title="预览任务单" aria-label="预览任务单"><Eye size={16} /></button><button className="table-icon-action" onClick={onPrint} title="打印任务单" aria-label="打印任务单"><Printer size={16} /></button><button className="table-icon-action" onClick={onDownload} title="下载任务单 CSV" aria-label="下载任务单 CSV"><Download size={16} /></button></div>;
}

export function ProductionTaskDetailModal({ detail, onClose, onPrint, onDownload }: { detail: ProductionTaskDetail; onClose: () => void; onPrint: () => void; onDownload: () => void }) {
  const task = detail.item;
  const template = getOperationTemplate(task.processCode, task.processName, task.processType);
  return (
    <SimpleModal title={`任务单预览 · ${task.taskNo}`} onClose={onClose}>
      <div className="document-detail">
        <div className="document-detail-toolbar">
          <div><span className="eyebrow">生产任务单</span><strong>{task.processName}</strong></div>
          <div className="header-actions"><button className="secondary-button" onClick={onPrint}><Printer size={16} />打印</button><button className="secondary-button" onClick={onDownload}><Download size={16} />下载 CSV</button></div>
        </div>
         <div className="document-detail-meta"><span>任务：<strong>{task.taskNo}</strong></span><span>工单：<strong>{task.workOrderNo}</strong></span><span>产品行：<strong>P{String(task.workOrderItemLineNo).padStart(2, "0")}</strong></span><span>商品：<strong>{task.productItemName}</strong></span><span>工序：<strong>{task.processName}</strong></span><span>计划：<strong>{formatQuantity(task.plannedQuantity)}</strong></span><span>任务状态：{task.flowStatus !== "active" ? <FlowStatusBadge status={task.flowStatus} /> : <TaskStatusBadge status={task.status} />}</span><span>工单执行：<WorkOrderExecutionBadge status={task.executionStatus} terminationType={task.terminationType} /></span></div>
        <div className="document-detail-meta"><span>已投入：<strong>{formatQuantity(task.inputQuantity)}</strong></span><span>合格：<strong>{formatQuantity(task.goodQuantity)}</strong></span><span>已流转：<strong>{formatQuantity(task.outputQuantity)}</strong></span><span>不良：<strong>{formatQuantity(task.defectQuantity)}</strong></span><span>执行人：<strong>{task.assignedUserName || "-"}</strong></span></div>
        <TaskReportsDetail reports={detail.reports} template={template} />
         <TaskRepairsDetail repairs={detail.repairs} />
        <TaskRepairOperationsDetail operations={detail.repairOperations} />
        <TaskQualityDetail qualityChecks={detail.qualityChecks} />
        <TaskDisassemblyDetail lines={detail.disassemblyLines} />
        <TaskAssemblyDetail lines={detail.assemblyLines} />
        <TaskInventoryDetail documents={detail.inventoryDocuments} />
      </div>
    </SimpleModal>
  );
}

function TaskReportsDetail({ reports, template }: { reports: ProductionTaskReport[]; template: ReturnType<typeof getOperationTemplate> }) {
  if (template.layout === "table") {
    const rows = reports.flatMap((report) => operationRowsForReport(template, report.operationData).map((row, rowIndex) => ({ report, row, rowIndex })));
    return <div className="table-wrap"><table className="chip-test-result-table"><thead><tr><th>报工单</th><th>报工人</th><th>芯片型号</th><th>名称</th><th>规格</th><th>测试</th><th>良品</th><th>不良</th><th>结果</th><th>不良原因</th><th>不良说明</th></tr></thead><tbody>{rows.map(({ report, row, rowIndex }) => <tr key={`${report.id}-${rowIndex}`}><td><strong>{report.reportNo}</strong><small>{report.reportDate}</small></td><td>{report.operatorName}</td><td>{operationValue(row.chipModel)}</td><td>{operationValue(row.chipName)}</td><td>{operationValue(row.chipSpec)}</td><td className="quantity-cell">{formatQuantity(Number(row.testQuantity) || 0)}</td><td className="quantity-positive">{formatQuantity(Number(row.goodQuantity) || 0)}</td><td className={Number(row.defectQuantity) > 0 ? "quantity-negative" : "muted-cell"}>{formatQuantity(Number(row.defectQuantity) || 0)}</td><td>{operationValue(row.testResult)}</td><td>{operationValue(row.defectReasons)}</td><td>{operationValue(row.defectDescription)}</td></tr>)}{!rows.length && <EmptyTable colSpan={11} title="暂无芯片初测明细" description="该任务尚未提交包含芯片型号的测试报工。" />}</tbody></table></div>;
  }
  const fields = template.fields;
  return <div className="table-wrap"><table><thead><tr><th>报工单</th><th>报工人</th><th>投入 / 合格 / 不良</th><th>批次 / 序列号</th><th>工序作业项</th></tr></thead><tbody>{reports.map((report) => <tr key={report.id}><td><strong>{report.reportNo}</strong><small>{report.reportDate}</small></td><td>{report.operatorName}</td><td><strong>{formatQuantity(report.inputQuantity)}</strong><small>合格 {formatQuantity(report.goodQuantity)} · 不良 {formatQuantity(report.defectQuantity)}</small></td><td>{report.serialNo || report.lotNo || "-"}</td><td>{operationSummaryRows(fields, report.operationData).map((row) => <small key={row.label}><b>{row.label}：</b>{row.value}</small>)}</td></tr>)}{!reports.length && <EmptyTable colSpan={5} title="暂无报工记录" description="该任务尚未提交报工。" />}</tbody></table></div>;
}

function TaskRepairsDetail({ repairs }: { repairs: ProductionTaskDetail["repairs"] }) {
  if (!repairs.length) return null;
  return <div className="table-wrap"><table className="repairs-detail-table"><thead><tr><th>维修单</th><th>商品规格</th><th>芯片型号</th><th>芯片规格</th><th>来源不良</th><th>不良原因</th><th>维修合格</th><th>仍不良</th><th>报废</th><th>报废原因</th><th>状态</th></tr></thead><tbody>{repairs.map((repair) => <tr key={repair.id}><td><strong>{repair.repairNo}</strong><small>{repair.sourceSerialNo || repair.sourceLotNo || "-"}</small></td><td>{repair.itemSpecification || "-"}</td><td>{repair.chipModel || repair.chipName || "-"}</td><td>{repair.chipSpec || "-"}</td><td className="quantity-negative">{formatQuantity(repair.quantity)}</td><td><strong>{repair.defectCode || "-"}</strong><small>{repair.defectDescription || "-"}</small></td><td className="quantity-positive">{formatQuantity(repair.repairGoodQuantity)}</td><td className={repair.repairDefectQuantity > 0 ? "quantity-negative" : "muted-cell"}>{formatQuantity(repair.repairDefectQuantity)}</td><td>{formatQuantity(repair.scrapQuantity)}</td><td>{repair.scrapReason || "-"}</td><td><RepairStatusBadge status={repair.status} /></td></tr>)}</tbody></table></div>;
}

function TaskRepairOperationsDetail({ operations }: { operations: ProductionTaskDetail["repairOperations"] }) {
  if (!operations.length) return null;
  return <div className="table-wrap"><table><thead><tr><th>维修处理</th><th>合格 / 仍不良 / 报废</th><th>报废原因</th><th>维修人</th></tr></thead><tbody>{operations.map((operation) => <tr key={operation.id}><td><strong>{operation.repairNo}</strong><small>{formatDateTime(operation.createdAt)}</small></td><td><strong>合格 {formatQuantity(operation.repairGoodQuantity)}</strong><small>仍不良 {formatQuantity(operation.repairDefectQuantity)} · 报废 {formatQuantity(operation.scrapQuantity)}</small></td><td>{operation.scrapReason || "-"}</td><td>{operation.operatorName}</td></tr>)}</tbody></table></div>;
}

function TaskQualityDetail({ qualityChecks }: { qualityChecks: ProductionTaskDetail["qualityChecks"] }) {
  if (!qualityChecks.length) return null;
  return <div className="table-wrap"><table><thead><tr><th>质检单</th><th>待检</th><th>合格 / 不合格</th><th>状态</th><th>结论</th></tr></thead><tbody>{qualityChecks.map((check) => <tr key={check.id}><td><strong>{check.checkNo}</strong><small>{check.inspectorName || "-"}</small></td><td className="quantity-cell">{formatQuantity(check.quantity)}</td><td><strong>{formatQuantity(check.passedQuantity)}</strong><small>不合格 {formatQuantity(check.failedQuantity)}</small></td><td><QualityStatusBadge status={check.status} /></td><td>{check.checkResult || "-"}</td></tr>)}</tbody></table></div>;
}

function TaskDisassemblyDetail({ lines }: { lines: ProductionTaskDetail["disassemblyLines"] }) {
  if (!lines.length) return null;
  return <div className="table-wrap"><table className="production-table task-flow-detail-table task-flow-disassembly-table"><thead><tr><th>拆解报工</th><th>元器件</th><th>数量</th><th>去向</th><th>目标</th><th>批次 / 序列号</th><th>备注</th></tr></thead><tbody>{lines.map((line) => <tr key={`${line.reportNo}-${line.lineNo}`}><td><strong>{line.reportNo}</strong><small>第 {line.lineNo} 行</small></td><td><strong>{line.itemName}</strong><small className="code-cell">{line.itemCode}</small></td><td className="quantity-positive">{formatQuantity(line.quantity)}</td><td>{line.destinationType === "warehouse" ? "进入仓库" : "进入后续工序"}</td><td>{line.destinationType === "warehouse" ? <><strong>{line.warehouseName || "-"}</strong><small>{line.receiptDocumentNo || "待生成入库单"}</small></> : <><strong>{line.startProcessName || "-"}</strong><small>{line.routeName || "-"} · {line.childWorkOrderNo || "待生成工单"}</small></>}</td><td>{line.serialNo || line.lotNo || "-"}</td><td>{line.remark || "-"}</td></tr>)}</tbody></table></div>;
}

function TaskAssemblyDetail({ lines }: { lines: ProductionTaskDetail["assemblyLines"] }) {
  if (!lines.length) return null;
  return <div className="table-wrap"><table className="production-table task-flow-detail-table task-flow-assembly-table"><thead><tr><th>组装报工</th><th>元器件</th><th>来源仓库</th><th>单件用量</th><th>实际领用</th><th>批次 / 序列号</th><th>领用出库单</th><th>备注</th></tr></thead><tbody>{lines.map((line) => <tr key={`${line.reportNo}-${line.lineNo}`}><td><strong>{line.reportNo}</strong><small>第 {line.lineNo} 行</small></td><td><strong>{line.itemName}</strong><small className="code-cell">{line.itemCode}</small></td><td><strong>{line.warehouseName}</strong><small className="code-cell">{line.warehouseCode}</small></td><td className="quantity-cell">{formatQuantity(line.unitQuantity)}</td><td className="quantity-negative">{formatQuantity(line.quantity)}</td><td>{line.serialNo || line.lotNo || "-"}</td><td>{line.issueDocumentNo}</td><td>{line.remark || "-"}</td></tr>)}</tbody></table></div>;
}

function TaskInventoryDetail({ documents }: { documents: ProductionTaskDetail["inventoryDocuments"] }) {
  if (!documents.length) return null;
  const linkTypeLabel: Record<string, string> = {
    finished_goods_receipt: "成品入库",
    semi_finished_receipt: "半成品入库",
    disassembly_source_issue: "拆解来源出库",
    disassembly_component_receipt: "拆解元器件入库",
    assembly_component_issue: "组装元器件领用出库"
  };
  return <div className="table-wrap"><table><thead><tr><th>关联库存单</th><th>类型</th><th>业务日期</th><th>单据状态</th><th>关联状态</th></tr></thead><tbody>{documents.map((document) => <tr key={`${document.linkType}-${document.id}`}><td><strong>{document.documentNo}</strong></td><td>{linkTypeLabel[document.linkType] || document.linkType}</td><td>{document.businessDate}</td><td>{document.status}</td><td>{document.linkStatus}</td></tr>)}</tbody></table></div>;
}

function ReportsPanel() {
  const [items, setItems] = useState<ProductionReport[]>([]);
  const [query, setQuery] = useState("");
  const load = () => request<{ items: ProductionReport[] }>("/production/reports").then((result) => setItems(result.items));
  useEffect(() => { void load(); }, []);
  const filtered = items.filter((item) => `${item.reportNo}${item.taskNo}${item.workOrderNo}${item.productItemName}${item.processName}${item.operatorName}`.toLowerCase().includes(query.toLowerCase()));
  return <MasterPanel title="报工记录" description="报工记录不可直接修改，维修和质检会在后续记录中留下闭环痕迹。" count={`最近 ${items.length} 条`} canManage={false} onCreate={() => undefined} onRefresh={load}><div className="toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索报工、任务、工单、商品或员工" /></div></div><div className="table-wrap"><table className="production-table"><thead><tr><th>报工单号</th><th>任务 / 工单</th><th>商品 / 工序</th><th>报工人</th><th>投入</th><th>合格</th><th>不良</th><th>批次 / 序列号</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><strong>{item.reportNo}</strong><small>{item.reportDate}</small></td><td><strong>{item.taskNo}</strong><small>{item.workOrderNo} · P{String(item.workOrderItemLineNo).padStart(2, "0")}</small></td><td><strong>{item.productItemName}</strong><small>{item.processName}</small></td><td>{item.operatorName}</td><td className="quantity-cell">{formatQuantity(item.inputQuantity)}</td><td className="quantity-positive">{formatQuantity(item.goodQuantity)}</td><td className={item.defectQuantity > 0 ? "quantity-negative" : "muted-cell"}>{formatQuantity(item.defectQuantity)}</td><td>{item.serialNo || item.lotNo || "-"}</td></tr>)}{!filtered.length && <EmptyTable colSpan={8} title="暂无报工记录" description="员工提交工序报工后，会在这里形成不可直接修改的记录。" />}</tbody></table></div></MasterPanel>;
}

function QualityPanel({ currentUser }: { currentUser: User }) {
  const [items, setItems] = useState<QualityCheck[]>([]);
  const [inspecting, setInspecting] = useState<QualityCheck | null>(null);
  const canManage = hasPermission(currentUser, "quality.inspection.manage");
  const load = () => request<{ items: QualityCheck[] }>("/production/quality-checks").then((result) => setItems(result.items));
  useEffect(() => { void load(); }, []);
  return <MasterPanel title="质量关卡" description="待检任务仅能通过质检判定放行；不合格数量会自动生成维修记录。" count={`${items.length} 条`} canManage={false} onCreate={() => undefined} onRefresh={load}><div className="table-wrap"><table className="production-table"><thead><tr><th>质检单</th><th>任务 / 工单</th><th>商品 / 工序</th><th>待检数量</th><th>结果</th><th>质检员</th><th>状态</th><th className="action-cell">操作</th></tr></thead><tbody>{items.map((item) => { const executionAvailable = item.executionStatus === "normal"; return <tr key={item.id}><td><strong>{item.checkNo}</strong><small>{item.createdAt}</small></td><td><strong>{item.taskNo}</strong><small>{item.workOrderNo} · P{String(item.workOrderItemLineNo).padStart(2, "0")}</small></td><td><strong>{item.productItemName}</strong><small>{item.processName}</small></td><td className="quantity-cell">{formatQuantity(item.quantity)}</td><td><strong>{formatQuantity(item.passedQuantity)}</strong><small className={item.failedQuantity > 0 ? "quantity-negative" : "muted-cell"}>不合格 {formatQuantity(item.failedQuantity)}</small></td><td>{item.inspectorName || "-"}</td><td><div className="work-order-status-stack"><QualityStatusBadge status={item.status} /><WorkOrderExecutionBadge status={item.executionStatus} terminationType={item.terminationType} /></div></td><td className="action-cell">{canManage && executionAvailable && item.status === "pending" && <button className="table-action" onClick={() => setInspecting(item)}>判定</button>}</td></tr>; })}{!items.length && <EmptyTable colSpan={8} title="暂无待检任务" description="路线配置质量关卡后，生产报工完成会自动创建待检记录。" />}</tbody></table></div>{inspecting && <QualityInspectModal item={inspecting} onClose={() => setInspecting(null)} onSaved={() => { setInspecting(null); void load(); }} />}</MasterPanel>;
}

function RepairsPanel({ currentUser }: { currentUser: User }) {
  const [items, setItems] = useState<RepairRecord[]>([]);
  const [editing, setEditing] = useState<RepairRecord | null>(null);
  const [detail, setDetail] = useState<ProductionTaskDetail | null>(null);
  const canManage = hasPermission(currentUser, "production.repairs.manage");
  const load = () => request<{ items: RepairRecord[] }>("/production/repairs").then((result) => setItems(result.items));
  useEffect(() => { void load(); }, []);
  const loadTaskDetail = async (taskId: number) => request<ProductionTaskDetail>(`/production/tasks/${taskId}`);
  const previewRepair = async (taskId: number) => setDetail(await loadTaskDetail(taskId));
  const printRepair = async (taskId: number) => printProductionTask(await loadTaskDetail(taskId));
  const downloadRepair = async (taskId: number) => downloadProductionTask(await loadTaskDetail(taskId));
  return <MasterPanel title="不良维修记录" description="每条维修单对应来源不良的商品和芯片型号；维修合格立即放行，仍不良继续留在维修池，报废必须登记数量与原因。" count={`${items.length} 条`} canManage={false} onCreate={() => undefined} onRefresh={load}><div className="table-wrap"><table className="production-table repairs-table"><thead><tr><th>维修单</th><th>工单 / 任务</th><th>商品</th><th>商品规格</th><th>芯片型号</th><th>芯片规格</th><th>来源不良</th><th>不良原因</th><th>维修合格</th><th>仍不良</th><th>报废</th><th>报废原因</th><th>状态</th><th className="action-cell document-output-cell">工单输出</th><th className="action-cell">操作</th></tr></thead><tbody>{items.map((item) => { const executionAvailable = item.executionStatus === "normal"; return <tr key={item.id}><td><strong>{item.repairNo}</strong><small>{item.createdByName}</small></td><td><strong>{item.workOrderNo || "-"}</strong><small>{item.taskNo || "-"}</small></td><td><strong>{item.itemName || "-"}</strong><small className="code-cell">{item.itemCode || "-"}</small></td><td>{item.itemSpecification || "-"}</td><td>{item.chipModel || item.chipName || "-"}</td><td>{item.chipSpec || "-"}</td><td className="quantity-negative">{formatQuantity(item.quantity)}</td><td><strong>{item.defectCode || "-"}</strong><small>{item.defectDescription || "-"}</small></td><td className="quantity-positive">{formatQuantity(item.repairGoodQuantity)}</td><td className={item.repairDefectQuantity > 0 ? "quantity-negative" : "muted-cell"}>{formatQuantity(item.repairDefectQuantity)}</td><td>{formatQuantity(item.scrapQuantity)}</td><td>{item.scrapReason || "-"}</td><td><div className="work-order-status-stack"><RepairStatusBadge status={item.status} /><WorkOrderExecutionBadge status={item.executionStatus} terminationType={item.terminationType} /></div></td><td className="action-cell document-output-cell"><TaskOutputActions onPreview={() => void previewRepair(item.taskId)} onPrint={() => void printRepair(item.taskId)} onDownload={() => void downloadRepair(item.taskId)} /></td><td className="action-cell">{canManage && executionAvailable && item.repairDefectQuantity > 0 && <button className="table-action" onClick={() => setEditing(item)}>维修结算</button>}</td></tr>; })}{!items.length && <EmptyTable colSpan={15} title="暂无维修记录" description="报工或质检产生不良后，会自动进入维修池。" />}</tbody></table></div>{editing && <RepairUpdateModal item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}{detail && <ProductionTaskDetailModal detail={detail} onClose={() => setDetail(null)} onPrint={() => printProductionTask(detail)} onDownload={() => downloadProductionTask(detail)} />}</MasterPanel>;
}

function ScrapProductsPanel() {
  const [items, setItems] = useState<ScrapProductRecord[]>([]);
  const [query, setQuery] = useState("");
  const load = () => request<{ items: ScrapProductRecord[] }>("/production/scrap-products").then((result) => setItems(result.items));
  useEffect(() => { void load(); }, []);
  const keyword = query.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (!keyword) return true;
    return [
      item.repairNo,
      item.workOrderNo,
      item.taskNo,
      item.itemCode,
      item.itemName,
      item.itemSpecification,
      item.chipModel,
      item.chipName,
      item.chipSpec,
      item.sourceLotNo,
      item.sourceSerialNo,
      item.scrapReason,
      item.defectCode,
      item.defectDescription,
      item.operatorName,
      item.createdAt
    ].some((value) => String(value ?? "").toLowerCase().includes(keyword));
  });
  const totalScrapQuantity = filtered.reduce((total, item) => total + item.scrapQuantity, 0);
  return <MasterPanel title="报废产品" description="不良维修结算中有报废数量的记录会自动汇总到这里，便于按批次和报废原因追踪。" count={`${filtered.length} 条`} canManage={false} onCreate={() => undefined} onRefresh={load}><div className="toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索维修单、工单、批次、商品或报废原因" /></div></div><div className="form-note">当前筛选报废合计 {formatQuantity(totalScrapQuantity)} 件。</div><div className="table-wrap"><table className="production-table repairs-table"><thead><tr><th>维修单</th><th>工单 / 任务</th><th>商品 / 规格</th><th>芯片 / 批次</th><th>合格 / 仍不良 / 报废</th><th>报废原因</th><th>维修人</th><th>时间</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><strong>{item.repairNo}</strong><small>{item.defectCode || "-"}</small></td><td><strong>{item.workOrderNo || "-"}</strong><small>{item.taskNo || "-"}</small></td><td><strong>{item.itemName || "-"}</strong><small className="code-cell">{item.itemCode || "-"}</small><small>{item.itemSpecification || "-"}</small></td><td><strong>{item.chipModel || item.chipName || "-"}</strong><small>{item.chipSpec || "-"}</small><small className="code-cell">{item.sourceLotNo || item.sourceSerialNo || "-"}</small></td><td><strong>{formatQuantity(item.repairGoodQuantity)}</strong><small>仍不良 {formatQuantity(item.repairDefectQuantity)}</small><small className={item.scrapQuantity > 0 ? "quantity-negative" : "muted-cell"}>报废 {formatQuantity(item.scrapQuantity)}</small></td><td>{item.scrapReason || "-"}</td><td>{item.operatorName}</td><td>{formatDateTime(item.createdAt)}</td></tr>)}{!filtered.length && <EmptyTable colSpan={8} title="暂无报废产品" description="带有报废数量的维修结算记录会自动显示在这里。" />}</tbody></table></div></MasterPanel>;
}

function ProcessForm({ item, onClose, onSaved }: { item: ProductionProcess | null; onClose: () => void; onSaved: () => void }) {
  const [options, setOptions] = useState<ProductionAuthorizationOptions | null>(null);
  const [form, setForm] = useState({ code: item?.code ?? "", name: item?.name ?? "", processType: item?.processType ?? "manufacturing", sortOrder: String(item?.sortOrder ?? 0), description: item?.description ?? "", status: item?.status ?? "active", supervisorIds: [] as number[], roleIds: [] as number[], userIds: [] as number[] });
  useEffect(() => { void Promise.all([request<ProductionAuthorizationOptions>(item ? `/production/authorization-options?processId=${item.id}` : "/production/authorization-options"), item ? request<{ authorizations: { supervisorIds: number[]; roleIds: number[]; userIds: number[] } }>(`/production/processes/${item.id}`) : Promise.resolve(null)]).then(([loadedOptions, detail]) => { setOptions(loadedOptions); if (detail) setForm((current) => ({ ...current, supervisorIds: detail.authorizations.supervisorIds, roleIds: detail.authorizations.roleIds, userIds: detail.authorizations.userIds })); }); }, [item]);
  const toggle = (key: "supervisorIds" | "roleIds" | "userIds", id: number) => setForm((current) => ({ ...current, [key]: current[key].includes(id) ? current[key].filter((value) => value !== id) : [...current[key], id] }));
  if (!options) return <SimpleModal title={item ? "编辑工序" : "新建工序"} onClose={onClose}><div className="modal-form">正在加载工序授权配置...</div></SimpleModal>;
  return <EntityModal title={item ? "编辑工序" : "新建工序"} onClose={onClose} onSubmit={async () => { const result = await request<{ item: { id: number } }>(item ? `/production/processes/${item.id}` : "/production/processes", { method: item ? "PUT" : "POST", body: JSON.stringify({ code: form.code, name: form.name, processType: form.processType, sortOrder: Number(form.sortOrder), description: form.description, status: form.status }) }); await request(`/production/processes/${result.item.id}/authorizations`, { method: "PUT", body: JSON.stringify({ supervisorIds: form.supervisorIds, roleIds: form.roleIds, userIds: form.userIds }) }); }} onSaved={onSaved}><div className="form-grid"><label>工序名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>工序编码<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="留空自动生成" /></label><label>工序类型<select value={form.processType} onChange={(event) => setForm({ ...form, processType: event.target.value as ProcessType })}>{Object.entries(processTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>排序<input type="number" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} /></label><label>状态<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "active" | "inactive" })}><option value="active">启用</option><option value="inactive">停用</option></select></label><label className="full-span">工序说明<textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div><div className="role-picker"><div className="field-label">工序主管（至少 1 名）</div><div className="role-options">{options.users.map((user) => <button type="button" className={`role-option ${form.supervisorIds.includes(user.id) ? "selected" : ""}`} key={user.id} onClick={() => toggle("supervisorIds", user.id)}><span>{form.supervisorIds.includes(user.id) ? <Check size={14} /> : <span className="empty-check" />}</span>{user.displayName} · {user.position || "员工"}</button>)}</div></div>{item && <div className="role-picker"><div className="field-label">当前工序角色</div><div className="role-options">{options.roles.map((role) => <button type="button" className={`role-option ${form.roleIds.includes(role.id) ? "selected" : ""}`} key={role.id} onClick={() => toggle("roleIds", role.id)}><span>{form.roleIds.includes(role.id) ? <Check size={14} /> : <span className="empty-check" />}</span>{role.name}</button>)}</div></div>}<div className="role-picker"><div className="field-label">额外指定员工</div><div className="role-options">{options.users.map((user) => <button type="button" className={`role-option ${form.userIds.includes(user.id) ? "selected" : ""}`} key={user.id} onClick={() => toggle("userIds", user.id)}><span>{form.userIds.includes(user.id) ? <Check size={14} /> : <span className="empty-check" />}</span>{user.displayName} · {user.position || "员工"}</button>)}</div></div></EntityModal>;
}

function RouteForm({ item, onClose, onSaved }: { item: ProductionRoute | null; onClose: () => void; onSaved: () => void }) {
  const [processes, setProcesses] = useState<ProductionProcess[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [options, setOptions] = useState<ProductionRouteOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const blankStep = () => ({ processId: "", outputTarget: "next_process" as OutputTarget, outputItemId: "", outputWarehouseId: "", qualityGate: false, description: "" });
  const [form, setForm] = useState({ code: item?.code ?? "", name: item?.name ?? "", productItemId: item?.productItemId?.toString() ?? "", description: item?.description ?? "", status: item?.status ?? "active", steps: [blankStep()] });
  useEffect(() => { const load = async () => { const [processResult, itemResult, optionResult] = await Promise.all([request<{ items: ProductionProcess[] }>("/production/processes"), request<{ items: ProductItem[] }>("/inventory/items"), request<ProductionRouteOptions>("/production/route-options")]); setProcesses(processResult.items.filter((entry) => entry.status === "active")); setProducts(itemResult.items.filter((entry) => entry.status === "active")); setOptions(optionResult); if (item) { const detail = await request<{ steps: ProductionRouteStep[] }>(`/production/routes/${item.id}`); setForm((current) => ({ ...current, steps: detail.steps.map((step) => ({ processId: String(step.processId), outputTarget: step.outputTarget, outputItemId: step.outputItemId?.toString() ?? "", outputWarehouseId: step.outputWarehouseId?.toString() ?? "", qualityGate: Boolean(step.qualityGate), description: step.description })) })); } setLoading(false); }; void load(); }, [item]);
  const addStep = () => setForm((current) => ({ ...current, steps: [...current.steps, blankStep()] }));
  const changeStep = (index: number, key: "processId" | "outputTarget" | "outputItemId" | "outputWarehouseId" | "qualityGate" | "description", value: string | boolean) => setForm((current) => ({ ...current, steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, [key]: value } : step) }));
  const removeStep = (index: number) => setForm((current) => ({ ...current, steps: current.steps.length === 1 ? current.steps : current.steps.filter((_, stepIndex) => stepIndex !== index) }));
  if (loading || !options) return <SimpleModal title={item ? "编辑工艺路线" : "新建工艺路线"} onClose={onClose}><div className="modal-form">正在加载工艺配置...</div></SimpleModal>;
  return <EntityModal title={item ? "编辑工艺路线" : "新建工艺路线"} onClose={onClose} onSubmit={async () => { await request(item ? `/production/routes/${item.id}` : "/production/routes", { method: item ? "PUT" : "POST", body: JSON.stringify({ ...form, productItemId: form.productItemId ? Number(form.productItemId) : null, steps: form.steps.map((step) => ({ ...step, processId: Number(step.processId), outputItemId: step.outputItemId ? Number(step.outputItemId) : null, outputWarehouseId: step.outputWarehouseId ? Number(step.outputWarehouseId) : null })) }) }); }} onSaved={onSaved}><div className="form-grid"><label>路线名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>路线编码<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="留空自动生成" /></label><label>适用商品<select value={form.productItemId} onChange={(event) => setForm({ ...form, productItemId: event.target.value })}><option value="">通用路线</option>{products.map((product) => <option value={product.id} key={product.id}>{product.itemCode} · {product.name}</option>)}</select></label><label>状态<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "active" | "inactive" })}><option value="active">启用</option><option value="inactive">停用</option></select></label><label className="full-span">路线说明<textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div><div className="production-steps"><div className="document-lines-heading"><div><span className="eyebrow">工序步骤</span><strong>按实际生产顺序配置</strong></div><button type="button" className="secondary-button" onClick={addStep}><Plus size={15} />新增步骤</button></div>{form.steps.map((step, index) => { const needsOutput = step.outputTarget === "semi_finished" || step.outputTarget === "finished_goods"; const outputWarehouseType: WarehouseType | null = step.outputTarget === "semi_finished" ? "semi_finished" : step.outputTarget === "finished_goods" ? "finished_goods" : null; const outputWarehouses = outputWarehouseType ? options.warehouses.filter((warehouse) => warehouse.warehouseType === outputWarehouseType) : []; return <div className="production-step-row route-step-row" key={index}><span className="roadmap-index current">{index + 1}</span><label>工序<select value={step.processId} onChange={(event) => changeStep(index, "processId", event.target.value)}><option value="">请选择工序</option>{processes.map((process) => <option value={process.id} key={process.id}>{process.name}</option>)}</select></label><label>合格输出<select value={step.outputTarget} onChange={(event) => { const outputTarget = event.target.value as OutputTarget; setForm((current) => ({ ...current, steps: current.steps.map((currentStep, stepIndex) => stepIndex === index ? { ...currentStep, outputTarget, outputWarehouseId: "" } : currentStep) })); }}>{Object.entries(outputTargetLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>{needsOutput && <label>输出商品<select value={step.outputItemId} onChange={(event) => changeStep(index, "outputItemId", event.target.value)}><option value="">成品默认使用工单商品</option>{products.map((product) => <option value={product.id} key={product.id}>{product.itemCode} · {product.name}</option>)}</select></label>}{needsOutput && <label>输出仓库<select value={step.outputWarehouseId} onChange={(event) => changeStep(index, "outputWarehouseId", event.target.value)}><option value="">请选择{warehouseTypeLabels[outputWarehouseType as WarehouseType]}</option>{outputWarehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name} · {warehouseTypeLabels[warehouse.warehouseType]} · {warehouse.departmentName}</option>)}</select></label>}{needsOutput && !outputWarehouses.length && <span className="form-note">暂无{warehouseTypeLabels[outputWarehouseType as WarehouseType]}，请先在仓库管理中创建。</span>}<label className="production-check"><input type="checkbox" checked={step.qualityGate} onChange={(event) => changeStep(index, "qualityGate", event.target.checked)} />质量关卡</label><label>说明<input value={step.description} onChange={(event) => changeStep(index, "description", event.target.value)} /></label><button type="button" className="icon-button danger-icon" onClick={() => removeStep(index)} aria-label="删除步骤"><X size={16} /></button></div>; })}</div></EntityModal>;
}

function WorkOrderForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [routes, setRoutes] = useState<ProductionRoute[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [form, setForm] = useState<WorkOrderEntryForm>({
    lines: [{ productItemId: "", routeId: "", plannedQuantity: "", remark: "" }],
    managerUserId: "",
    priority: "normal",
    plannedStartDate: today(),
    plannedEndDate: "",
    remark: ""
  });
  useEffect(() => { void Promise.all([request<{ items: ProductItem[] }>("/inventory/items"), request<{ items: ProductionRoute[] }>("/production/routes"), request<{ items: Operator[] }>("/production/operators")]).then(([productResult, routeResult, operatorResult]) => { setProducts(productResult.items.filter((entry) => entry.status === "active")); setRoutes(routeResult.items.filter((entry) => entry.status === "active")); setOperators(operatorResult.items); }); }, []);
  return <EntityModal title="新建生产工单" onClose={onClose} onSubmit={async () => { await request("/production/work-orders", { method: "POST", body: JSON.stringify({ items: form.lines.map((line) => ({ productItemId: Number(line.productItemId), routeId: Number(line.routeId), plannedQuantity: Number(line.plannedQuantity), remark: line.remark })), managerUserId: form.managerUserId ? Number(form.managerUserId) : null, priority: form.priority as WorkOrderPriority, plannedStartDate: form.plannedStartDate, plannedEndDate: form.plannedEndDate, remark: form.remark }) }); }} onSaved={onSaved}>
    <div className="form-note">工单先保存为草稿。每个产品明细会独立生成自己的工序任务链，报工、质检、维修和入库按产品行分别追溯。</div>
    <ProductionWorkOrderEntryTable
      form={form}
      products={products}
      routes={routes}
      operators={operators}
      priorities={Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))}
      onChange={setForm}
    />
  </EntityModal>;
}

function AssignTaskModal({ task, onClose, onSaved }: { task: ProductionTask; onClose: () => void; onSaved: () => void }) {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [form, setForm] = useState({ assignedUserId: task.assignedUserId?.toString() ?? "", remark: task.remark ?? "" });
  useEffect(() => { void request<{ items: Operator[] }>(`/production/operators?processCode=${encodeURIComponent(task.processCode)}`).then((result) => setOperators(result.items)); }, [task.processCode]);
  return <EntityModal title={`派工 · ${task.taskNo}`} onClose={onClose} onSubmit={async () => { await request(`/production/tasks/${task.id}/assign`, { method: "POST", body: JSON.stringify({ assignedUserId: Number(form.assignedUserId), remark: form.remark }) }); }} onSaved={onSaved}><div className="form-note">系统仅列出拥有当前工序执行授权的启用员工。</div><div className="form-grid"><label>执行员工<select value={form.assignedUserId} onChange={(event) => setForm({ ...form, assignedUserId: event.target.value })}><option value="">请选择执行员工</option>{operators.map((operator) => <option value={operator.id} key={operator.id}>{operator.displayName} · {operator.employeeNo}</option>)}</select></label><label className="full-span">派工备注<textarea rows={3} value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} /></label></div></EntityModal>;
}

function ReportTaskModal({ task, onClose, onSaved }: { task: ProductionTask; onClose: () => void; onSaved: () => void }) {
  const template = getOperationTemplate(task.processCode, task.processName, task.processType);
  const remainingQuantity = Math.max(task.plannedQuantity - task.inputQuantity, 0);
  const [form, setForm] = useState<ReportEntryForm>({ reportDate: today(), inputQuantity: "", goodQuantity: "", defectQuantity: "0", reworkQuantity: "0", scrapQuantity: "0", lotNo: "", serialNo: "", defectCode: "", remark: "" });
  const [operationData, setOperationData] = useState<OperationData>(() => createDefaultOperationData(template, remainingQuantity));
  const detailTotals = operationTableTotals(template, operationData);
  const isDetailTable = template.layout === "table";
  return <EntityModal title={`工序报工 · ${task.taskNo}`} onClose={onClose} onSubmit={async () => { await request(`/production/tasks/${task.id}/report`, { method: "POST", body: JSON.stringify({ ...form, inputQuantity: isDetailTable ? detailTotals.inputQuantity : Number(form.inputQuantity), goodQuantity: isDetailTable ? detailTotals.goodQuantity : Number(form.goodQuantity || 0), defectQuantity: isDetailTable ? detailTotals.defectQuantity : Number(form.defectQuantity || 0), reworkQuantity: Number(form.reworkQuantity || 0), scrapQuantity: Number(form.scrapQuantity || 0), operationData }) }); }} onSaved={onSaved}>
    <div className="form-note">计划 {formatQuantity(task.plannedQuantity)}，已投入 {formatQuantity(task.inputQuantity)}。所有工序统一用表格录入；芯片初测按型号逐行录入，数量由明细自动汇总。</div>
    {isDetailTable ? <ChipTestRowsEditor template={template} data={operationData} onChange={setOperationData} /> : <OperationFieldsTable template={template} data={operationData} onChange={setOperationData} />}
    <ProductionReportEntryTable form={form} onChange={setForm} lockedQuantities={isDetailTable} quantitySummary={isDetailTable ? detailTotals : undefined} />
  </EntityModal>;
}

function OperationFieldsEditor({ template, data, onChange }: { template: ReturnType<typeof getOperationTemplate>; data: OperationData; onChange: (data: OperationData) => void }) {
  if (template.layout === "table") return <ChipTestRowsEditor template={template} data={data} onChange={onChange} />;
  return <OperationFieldsTable template={template} data={data} onChange={onChange} />;
}

function QualityInspectModal({ item, onClose, onSaved }: { item: QualityCheck; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ passedQuantity: String(item.quantity), failedQuantity: "0", checkResult: "" });
  return <EntityModal title={`质检判定 · ${item.checkNo}`} onClose={onClose} onSubmit={async () => { await request(`/production/quality-checks/${item.id}/inspect`, { method: "POST", body: JSON.stringify({ passedQuantity: Number(form.passedQuantity || 0), failedQuantity: Number(form.failedQuantity || 0), checkResult: form.checkResult }) }); }} onSaved={onSaved}><div className="form-note">待检数量 {formatQuantity(item.quantity)}；判定不合格的数量将自动创建不良维修记录。</div><div className="form-grid"><label>合格数量<input type="number" min="0" step="any" value={form.passedQuantity} onChange={(event) => setForm({ ...form, passedQuantity: event.target.value })} /></label><label>不合格数量<input type="number" min="0" step="any" value={form.failedQuantity} onChange={(event) => setForm({ ...form, failedQuantity: event.target.value })} /></label><label className="full-span">检验结论<textarea rows={3} value={form.checkResult} onChange={(event) => setForm({ ...form, checkResult: event.target.value })} /></label></div></EntityModal>;
}

function RepairUpdateModal({ item, onClose, onSaved }: { item: RepairRecord; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ repairGoodQuantity: "", scrapQuantity: "0", scrapReason: "", settlementStatus: "continue" as "continue" | "complete" });
  const repairGoodQuantity = Number(form.repairGoodQuantity || 0);
  const scrapQuantity = Number(form.scrapQuantity || 0);
  const repairDefectQuantity = Math.max(item.repairDefectQuantity - repairGoodQuantity - scrapQuantity, 0);
  const exceedsAvailableQuantity = repairGoodQuantity + scrapQuantity > item.repairDefectQuantity;
  return <EntityModal title={`维修结算 · ${item.repairNo}`} onClose={onClose} onSubmit={async () => { await request(`/production/repairs/${item.id}`, { method: "PUT", body: JSON.stringify({ repairGoodQuantity, scrapQuantity, scrapReason: form.scrapReason, settlementStatus: form.settlementStatus }) }); }} onSaved={onSaved}><div className="form-note">继续维修表示本次只保存部分处理进度；维修完成要求本次把当前待维修数量全部处理完，报废数量会进入报废产品页面。</div><div className="repair-settlement-wrap"><table className="repair-settlement-table"><thead><tr><th>商品</th><th>商品规格</th><th>芯片型号</th><th>芯片规格</th><th>来源批次 / 序列号</th><th>来源不良</th><th className="compact-number-col">来源数量</th><th className="compact-number-col">待维修</th><th className="compact-number-col">本次合格</th><th className="compact-number-col">本次仍不良</th><th className="compact-number-col">本次报废</th><th>报废原因</th><th>维修状态</th></tr></thead><tbody><tr><td>{item.itemName || "-"}</td><td>{item.itemSpecification || "-"}</td><td>{item.chipModel || item.chipName || "-"}</td><td>{item.chipSpec || "-"}</td><td>{item.sourceSerialNo || item.sourceLotNo || "-"}</td><td><strong>{item.defectCode || "-"}</strong><small>{item.defectDescription || "-"}</small></td><td className="quantity-negative compact-number-cell">{formatQuantity(item.quantity)}</td><td className="quantity-cell compact-number-cell">{formatQuantity(item.repairDefectQuantity)}</td><td className="compact-number-cell"><input aria-label="本次维修合格数量" type="number" min="0" step="any" value={form.repairGoodQuantity} onChange={(event) => setForm({ ...form, repairGoodQuantity: event.target.value })} /></td><td className="compact-number-cell"><input aria-label="本次维修不良数量" disabled className={exceedsAvailableQuantity ? "input-error" : ""} value={exceedsAvailableQuantity ? "超出" : formatQuantity(repairDefectQuantity)} /></td><td className="compact-number-cell"><input aria-label="本次维修报废数量" type="number" min="0" step="any" value={form.scrapQuantity} onChange={(event) => setForm({ ...form, scrapQuantity: event.target.value })} /></td><td><input aria-label="报废原因" value={form.scrapReason} onChange={(event) => setForm({ ...form, scrapReason: event.target.value })} placeholder="有报废时必填" /></td><td><select aria-label="维修状态" value={form.settlementStatus} onChange={(event) => setForm({ ...form, settlementStatus: event.target.value as "continue" | "complete" })}><option value="continue">继续维修</option><option value="complete">维修完成</option></select></td></tr></tbody></table></div></EntityModal>;
}

function MasterPanel({ title, description, count, canManage, onCreate, onRefresh, children }: { title: string; description: string; count: string; canManage: boolean; onCreate: () => void; onRefresh: () => void; children: ReactNode }) {
  return <section className="panel"><div className="panel-heading"><div><span className="eyebrow">生产基础</span><h2>{title}</h2><p>{description}</p></div><div className="header-actions"><span className="count-label">{count}</span><button className="icon-button" onClick={onRefresh} title="刷新列表" aria-label="刷新列表"><RefreshCw size={17} /></button>{canManage && <button className="primary-button" onClick={onCreate}><Plus size={16} />新建</button>}</div></div>{children}</section>;
}

function EntityModal({ title, onClose, onSubmit, onSaved, children }: { title: string; onClose: () => void; onSubmit: () => Promise<void>; onSaved: () => void; children: ReactNode }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(""); setSaving(true); try { await onSubmit(); onSaved(); } catch (saveError) { setError(errorMessage(saveError)); } finally { setSaving(false); } };
  return <SimpleModal title={title} onClose={onClose}><form className="modal-form" onSubmit={submit}>{children}{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving}>{saving ? "保存中..." : "保存"} <Check size={16} /></button></div></form></SimpleModal>;
}

function SimpleModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="eyebrow">生产 MES</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div>{children}</section></div>;
}

function GuideStep({ index, title, detail }: { index: string; title: string; detail: string }) {
  return <div className="guide-step"><span>{index}</span><div><strong>{title}</strong><p>{detail}</p></div></div>;
}

function operationSummaryRows(fields: OperationField[], data?: OperationData) {
  return fields.map((field) => ({ label: field.label, value: formatOperationValue(field, data?.[field.key]) }));
}

function operationRowsForReport(template: ReturnType<typeof getOperationTemplate>, data?: OperationData) {
  const rows = getOperationRows(template, data);
  if (rows.length || template.layout !== "table" || !data) return rows;
  const legacyRow: OperationRow = {};
  for (const field of template.fields) {
    const value = data[field.key];
    if (value === undefined || (Array.isArray(value) && value.some((entry) => typeof entry === "object"))) continue;
    legacyRow[field.key] = value as OperationRow[string];
  }
  return Object.keys(legacyRow).length ? [legacyRow] : [];
}

function operationValue(value: unknown) {
  if (Array.isArray(value)) return value.length ? value.join("、") : "-";
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function operationTableTotals(template: ReturnType<typeof getOperationTemplate>, data?: OperationData) {
  return operationRowsForReport(template, data).reduce<{ inputQuantity: number; goodQuantity: number; defectQuantity: number }>((totals, row) => ({
    inputQuantity: totals.inputQuantity + (Number(row.testQuantity) || 0),
    goodQuantity: totals.goodQuantity + (Number(row.goodQuantity) || 0),
    defectQuantity: totals.defectQuantity + (Number(row.defectQuantity) || 0)
  }), { inputQuantity: 0, goodQuantity: 0, defectQuantity: 0 });
}

export function downloadProductionTask(detail: ProductionTaskDetail) {
  const task = detail.item;
  const template = getOperationTemplate(task.processCode, task.processName, task.processType);
  const fields = template.fields;
  const disassemblyRows = detail.disassemblyLines.map((line) => [
    line.reportNo,
    line.lineNo,
    line.itemCode,
    line.itemName,
    formatQuantity(line.quantity),
    line.destinationType === "warehouse" ? "进入仓库" : "进入后续工序",
    line.destinationType === "warehouse" ? line.warehouseName || "" : line.routeName || "",
    line.destinationType === "warehouse" ? line.receiptDocumentNo || "" : line.startProcessName || "",
    line.destinationType === "process" ? line.childWorkOrderNo || "" : "",
    line.lotNo,
    line.serialNo,
    line.remark
  ]);
  const assemblyRows = detail.assemblyLines.map((line) => [
    line.reportNo,
    line.lineNo,
    line.itemCode,
    line.itemName,
    line.warehouseCode,
    line.warehouseName,
    formatQuantity(line.unitQuantity),
    formatQuantity(line.quantity),
    line.lotNo,
    line.serialNo,
    line.issueDocumentNo,
    line.remark
  ]);
  const reportHeaders = template.layout === "table"
    ? ["报工单", "报工日期", "报工人", "批次号", "序列号", ...fields.map((field) => field.label), "报工备注"]
    : ["报工单", "报工日期", "报工人", "投入", "合格", "不良", "批次号", "序列号", ...fields.map((field) => field.label), "备注"];
  const reportRows = template.layout === "table"
    ? detail.reports.flatMap((report) => {
      const detailRows = operationRowsForReport(template, report.operationData);
      return (detailRows.length ? detailRows : [{} as OperationRow]).map((row) => [
        report.reportNo,
        report.reportDate,
        report.operatorName,
        report.lotNo,
        report.serialNo,
        ...fields.map((field) => operationValue(row[field.key])),
        report.remark
      ]);
    })
    : detail.reports.map((report) => [
      report.reportNo,
      report.reportDate,
      report.operatorName,
      formatQuantity(report.inputQuantity),
      formatQuantity(report.goodQuantity),
      formatQuantity(report.defectQuantity),
      report.lotNo,
      report.serialNo,
      ...fields.map((field) => formatOperationValue(field, report.operationData?.[field.key])),
      report.remark
    ]);
  const rows = [
    ["生产任务单导出"],
    ["任务编号", task.taskNo],
    ["生产工单", task.workOrderNo],
    ["产品明细行", `P${String(task.workOrderItemLineNo).padStart(2, "0")}`],
    ["生产商品", task.productItemName],
    ["工序", task.processName],
    ["计划数量", formatQuantity(task.plannedQuantity)],
    ["已投入", formatQuantity(task.inputQuantity)],
    ["合格数量", formatQuantity(task.goodQuantity)],
    ["已流转", formatQuantity(task.outputQuantity)],
    ["不良数量", formatQuantity(task.defectQuantity)],
    ["执行员工", task.assignedUserName || ""],
    [],
    reportHeaders,
    ...reportRows,
    [],
    ["拆解报工单", "行号", "元器件编码", "元器件名称", "数量", "去向", "目标仓库 / 路线", "入库单 / 起始工序", "后续工单", "批次号", "序列号", "备注"],
    ...disassemblyRows,
    [],
    ["组装报工单", "行号", "元器件编码", "元器件名称", "来源仓库编码", "来源仓库", "单件用量", "实际领用", "批次号", "序列号", "领用出库单", "备注"],
    ...assemblyRows,
    [],
    ["维修单", "来源不良", "商品规格", "芯片型号", "芯片规格", "维修合格", "仍不良", "维修报废", "报废原因", "状态"],
    ...detail.repairs.map((repair) => [repair.repairNo, formatQuantity(repair.quantity), repair.itemSpecification, repair.chipModel || repair.chipName, repair.chipSpec, formatQuantity(repair.repairGoodQuantity), formatQuantity(repair.repairDefectQuantity), formatQuantity(repair.scrapQuantity), repair.scrapReason, repairStatusLabels[repair.status]]),
    [],
    ["维修处理记录", "处理时间", "维修合格", "仍不良", "维修报废", "报废原因", "维修人"],
    ...detail.repairOperations.map((operation) => [operation.repairNo, formatDateTime(operation.createdAt), formatQuantity(operation.repairGoodQuantity), formatQuantity(operation.repairDefectQuantity), formatQuantity(operation.scrapQuantity), operation.scrapReason, operation.operatorName]),
    [],
    ["质检单", "待检", "合格", "不合格", "状态", "结论"],
    ...detail.qualityChecks.map((check) => [check.checkNo, formatQuantity(check.quantity), formatQuantity(check.passedQuantity), formatQuantity(check.failedQuantity), qualityStatusLabels[check.status], check.checkResult])
  ];
  const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = window.document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${task.taskNo}-生产任务单.csv`.replace(/[\\/:*?"<>|]/g, "-");
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

export function printProductionTask(detail: ProductionTaskDetail) {
  const printFrame = window.document.createElement("iframe");
  printFrame.className = "document-print-frame";
  printFrame.setAttribute("aria-hidden", "true");
  window.document.body.appendChild(printFrame);
  const frameDocument = printFrame.contentDocument;
  if (!frameDocument) {
    printFrame.remove();
    return;
  }
  frameDocument.open();
  frameDocument.write(buildProductionTaskPrintHtml(detail));
  frameDocument.close();
  window.setTimeout(() => {
    const printWindow = printFrame.contentWindow;
    if (!printWindow) {
      printFrame.remove();
      return;
    }
    printWindow.focus();
    printWindow.print();
    window.setTimeout(() => printFrame.remove(), 600);
  }, 150);
}

function buildProductionTaskPrintHtml(detail: ProductionTaskDetail) {
  const task = detail.item;
  const template = getOperationTemplate(task.processCode, task.processName, task.processType);
  const fields = template.fields;
  const isDetailTable = template.layout === "table";
  const reportHeaderCells = isDetailTable
    ? ["报工单", "报工人", "芯片型号", "名称", "规格", "测试", "良品", "不良", "结果", "不良原因", "不良说明"]
    : ["报工单", "报工人", "投入", "合格", "不良", "工序作业项"];
  const reportRows = isDetailTable
    ? detail.reports.flatMap((report) => {
      const detailRows = operationRowsForReport(template, report.operationData);
      return (detailRows.length ? detailRows : [{} as OperationRow]).map((row) => `<tr><td><strong>${escapeHtml(report.reportNo)}</strong><br /><span>${escapeHtml(report.reportDate)}</span></td><td>${escapeHtml(report.operatorName)}</td><td>${escapeHtml(operationValue(row.chipModel))}</td><td>${escapeHtml(operationValue(row.chipName))}</td><td>${escapeHtml(operationValue(row.chipSpec))}</td><td>${escapeHtml(formatQuantity(Number(row.testQuantity) || 0))}</td><td>${escapeHtml(formatQuantity(Number(row.goodQuantity) || 0))}</td><td>${escapeHtml(formatQuantity(Number(row.defectQuantity) || 0))}</td><td>${escapeHtml(operationValue(row.testResult))}</td><td>${escapeHtml(operationValue(row.defectReasons))}</td><td>${escapeHtml(operationValue(row.defectDescription))}</td></tr>`);
    }).join("")
    : detail.reports.map((report) => {
      const operationRows = operationSummaryRows(fields, report.operationData)
        .map((row) => `<div><strong>${escapeHtml(row.label)}：</strong>${escapeHtml(row.value)}</div>`)
        .join("");
      return `<tr><td><strong>${escapeHtml(report.reportNo)}</strong><br /><span>${escapeHtml(report.reportDate)}</span></td><td>${escapeHtml(report.operatorName)}</td><td>${escapeHtml(formatQuantity(report.inputQuantity))}</td><td>${escapeHtml(formatQuantity(report.goodQuantity))}</td><td>${escapeHtml(formatQuantity(report.defectQuantity))}</td><td>${operationRows || "-"}</td></tr>`;
    }).join("");
  const repairRows = detail.repairs.map((repair) => `<tr><td>${escapeHtml(repair.repairNo)}</td><td>${escapeHtml(formatQuantity(repair.quantity))}</td><td>${escapeHtml(formatQuantity(repair.repairGoodQuantity))}</td><td>${escapeHtml(formatQuantity(repair.repairDefectQuantity))}</td><td>${escapeHtml(formatQuantity(repair.scrapQuantity))}</td><td>${escapeHtml(repair.scrapReason || "-")}</td><td>${escapeHtml(repairStatusLabels[repair.status])}</td></tr>`).join("");
  const disassemblyRows = detail.disassemblyLines.map((line) => `<tr><td>${escapeHtml(line.reportNo)}</td><td>${escapeHtml(line.itemCode)}<br /><span>${escapeHtml(line.itemName)}</span></td><td>${escapeHtml(formatQuantity(line.quantity))}</td><td>${escapeHtml(line.destinationType === "warehouse" ? "进入仓库" : "进入后续工序")}</td><td>${escapeHtml(line.destinationType === "warehouse" ? line.warehouseName || "-" : line.startProcessName || "-")}</td><td>${escapeHtml(line.destinationType === "warehouse" ? line.receiptDocumentNo || "-" : `${line.routeName || "-"} · ${line.childWorkOrderNo || "-"}`)}</td><td>${escapeHtml(line.serialNo || line.lotNo || "-")}</td><td>${escapeHtml(line.remark || "-")}</td></tr>`).join("");
  const assemblyRows = detail.assemblyLines.map((line) => `<tr><td>${escapeHtml(line.reportNo)}</td><td>${escapeHtml(line.itemCode)}<br /><span>${escapeHtml(line.itemName)}</span></td><td>${escapeHtml(line.warehouseCode)} · ${escapeHtml(line.warehouseName)}</td><td>${escapeHtml(formatQuantity(line.unitQuantity))}</td><td>${escapeHtml(formatQuantity(line.quantity))}</td><td>${escapeHtml(line.serialNo || line.lotNo || "-")}</td><td>${escapeHtml(line.issueDocumentNo)}</td><td>${escapeHtml(line.remark || "-")}</td></tr>`).join("");
  const repairOperationRows = detail.repairOperations.map((operation) => `<tr><td>${escapeHtml(operation.repairNo)}</td><td>${escapeHtml(formatDateTime(operation.createdAt))}</td><td>${escapeHtml(formatQuantity(operation.repairGoodQuantity))}</td><td>${escapeHtml(formatQuantity(operation.repairDefectQuantity))}</td><td>${escapeHtml(formatQuantity(operation.scrapQuantity))}</td><td>${escapeHtml(operation.scrapReason || "-")}</td><td>${escapeHtml(operation.operatorName)}</td></tr>`).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(task.taskNo)} - 生产任务单</title>
  <style>
    body { margin: 0; font-family: "Microsoft YaHei", Arial, sans-serif; color: #23384d; background: #fff; }
    main { padding: 32px; }
    header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #24384d; padding-bottom: 16px; }
    h1 { margin: 6px 0 0; font-size: 24px; }
    .brand, span { color: #6d7f91; font-size: 12px; }
    .doc-no { font-size: 18px; font-weight: 800; color: #263d55; }
    .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }
    .meta div { border: 1px solid #e3e8ee; padding: 10px; }
    .meta strong { display: block; margin-top: 4px; color: #263d55; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 12px; }
    th, td { border: 1px solid #dfe6ee; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f3f6f9; color: #40576f; }
    footer { margin-top: 24px; display: flex; justify-content: space-between; color: #7d8b99; font-size: 11px; }
  </style>
</head>
<body>
  <main>
    <header><div><div class="brand">内存条 ERP / MES</div><h1>生产任务单</h1></div><div class="doc-no">${escapeHtml(task.taskNo)}</div></header>
    <section class="meta">
      <div><span>生产工单</span><strong>${escapeHtml(task.workOrderNo)}</strong></div>
      <div><span>产品明细行</span><strong>P${escapeHtml(String(task.workOrderItemLineNo).padStart(2, "0"))}</strong></div>
      <div><span>生产商品</span><strong>${escapeHtml(task.productItemName)}</strong></div>
      <div><span>工序</span><strong>${escapeHtml(task.processName)}</strong></div>
      <div><span>计划数量</span><strong>${escapeHtml(formatQuantity(task.plannedQuantity))}</strong></div>
      <div><span>已投入 / 合格 / 不良</span><strong>${escapeHtml(formatQuantity(task.inputQuantity))} / ${escapeHtml(formatQuantity(task.goodQuantity))} / ${escapeHtml(formatQuantity(task.defectQuantity))}</strong></div>
      <div><span>执行员工</span><strong>${escapeHtml(task.assignedUserName || "-")}</strong></div>
    </section>
    <table><thead><tr>${reportHeaderCells.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${reportRows || `<tr><td colspan="${reportHeaderCells.length}">暂无报工记录</td></tr>`}</tbody></table>
    ${disassemblyRows ? `<table><thead><tr><th>拆解报工</th><th>元器件</th><th>数量</th><th>去向</th><th>目标</th><th>入库单 / 后续工单</th><th>批次 / 序列号</th><th>备注</th></tr></thead><tbody>${disassemblyRows}</tbody></table>` : ""}
    ${assemblyRows ? `<table><thead><tr><th>组装报工</th><th>元器件</th><th>来源仓库</th><th>单件用量</th><th>实际领用</th><th>批次 / 序列号</th><th>领用出库单</th><th>备注</th></tr></thead><tbody>${assemblyRows}</tbody></table>` : ""}
    ${repairRows ? `<table><thead><tr><th>维修单</th><th>来源不良</th><th>维修合格</th><th>仍不良</th><th>维修报废</th><th>报废原因</th><th>状态</th></tr></thead><tbody>${repairRows}</tbody></table>` : ""}
    ${repairOperationRows ? `<table><thead><tr><th>维修单</th><th>处理时间</th><th>维修合格</th><th>仍不良</th><th>维修报废</th><th>报废原因</th><th>维修人</th></tr></thead><tbody>${repairOperationRows}</tbody></table>` : ""}
    <footer><span>打印时间：${escapeHtml(formatDateTime(new Date().toISOString()))}</span><span>本任务单由系统自动生成</span></footer>
  </main>
</body>
</html>`;
}

function StatusBadge({ status }: { status: "active" | "inactive" }) {
  return <span className={`status-badge ${status}`}>{status === "active" ? "启用" : "停用"}</span>;
}

function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  return <span className={`production-status ${status}`}>{workOrderStatusLabels[status]}</span>;
}

function WorkOrderExecutionBadge({ status, terminationType }: { status: WorkOrderExecutionStatus; terminationType: WorkOrderTerminationType }) {
  const label = status === "terminated" && terminationType ? workOrderTerminationLabels[terminationType] : workOrderExecutionLabels[status];
  return <span className={`production-status execution-${status}`}>{label}</span>;
}

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`production-status ${status}`}>{taskStatusLabels[status]}</span>;
}

function FlowStatusBadge({ status }: { status: TaskFlowStatus }) {
  return <span className="production-status abnormal">{flowStatusLabels[status]}</span>;
}

function RepairStatusBadge({ status }: { status: RepairStatus }) {
  return <span className={`production-status ${status}`}>{repairStatusLabels[status]}</span>;
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

function formatDateTime(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function csvCell(value: string | number | boolean | undefined | null) {
  const text = value === undefined || value === null ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function escapeHtml(value: string | number | boolean | undefined | null) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}
