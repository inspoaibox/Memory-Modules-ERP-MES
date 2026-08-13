import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { request } from "./api";

type TrackingMode = "none" | "lot" | "serial";
type DestinationType = "warehouse" | "process";

type Task = {
  id: number;
  taskNo: string;
  workOrderNo: string;
  productItemCode: string;
  productItemName: string;
  plannedQuantity: number;
  inputQuantity: number;
};

type Item = {
  id: number;
  itemCode: string;
  name: string;
  trackingMode: TrackingMode;
};

type Warehouse = {
  id: number;
  code: string;
  name: string;
  warehouseType: string;
};

type Process = {
  id: number;
  code: string;
  name: string;
};

type Route = {
  id: number;
  code: string;
  name: string;
  productItemId: number | null;
};

type Balance = {
  itemId: number;
  warehouseId: number;
  lotNo: string;
  serialNo: string;
  quantity: number;
};

type DisassemblyOptions = {
  items: Item[];
  warehouses: Warehouse[];
  balances: Balance[];
  processes: Process[];
  routes: Route[];
};

type DisassemblyLineForm = {
  itemId: string;
  quantity: string;
  destinationType: DestinationType;
  warehouseId: string;
  routeId: string;
  startProcessId: string;
  lotNo: string;
  serialNo: string;
  remark: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const blankLine = (): DisassemblyLineForm => ({
  itemId: "",
  quantity: "",
  destinationType: "warehouse",
  warehouseId: "",
  routeId: "",
  startProcessId: "",
  lotNo: "",
  serialNo: "",
  remark: ""
});

export function DisassemblyReportModal({
  task,
  onClose,
  onSaved
}: {
  task: Task;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [options, setOptions] = useState<DisassemblyOptions | null>(null);
  const [reportDate, setReportDate] = useState(today());
  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [sourceQuantity, setSourceQuantity] = useState("");
  const [sourceLotNo, setSourceLotNo] = useState("");
  const [sourceSerialNo, setSourceSerialNo] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<DisassemblyLineForm[]>([blankLine()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void request<DisassemblyOptions>("/production/disassembly-options")
      .then((result) => {
        if (active) setOptions(result);
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError));
      });
    return () => { active = false; };
  }, []);

  const sourceItem = useMemo(
    () => options?.items.find((item) => item.itemCode === task.productItemCode),
    [options, task.productItemCode]
  );
  const sourceBalances = useMemo(
    () => options?.balances.filter((balance) => balance.itemId === sourceItem?.id && balance.warehouseId === Number(sourceWarehouseId)) ?? [],
    [options, sourceItem?.id, sourceWarehouseId]
  );
  const remainingQuantity = Math.max(task.plannedQuantity - task.inputQuantity, 0);

  const updateLine = <K extends keyof DisassemblyLineForm>(index: number, key: K, value: DisassemblyLineForm[K]) => {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line));
  };
  const selectedItem = (line: DisassemblyLineForm) => options?.items.find((item) => item.id === Number(line.itemId));
  const compatibleRoutes = (line: DisassemblyLineForm) => options?.routes.filter((route) => route.productItemId === null || route.productItemId === Number(line.itemId)) ?? [];
  const sourceBalance = sourceBalances.find((balance) => balance.lotNo === sourceLotNo && balance.serialNo === sourceSerialNo)?.quantity ?? 0;

  const submit = async () => {
    setError("");
    setSaving(true);
    try {
      await request(`/production/tasks/${task.id}/report`, {
        method: "POST",
        body: JSON.stringify({
          reportDate,
          inputQuantity: Number(sourceQuantity),
          goodQuantity: Number(sourceQuantity),
          defectQuantity: 0,
          sourceWarehouseId: Number(sourceWarehouseId),
          sourceQuantity: Number(sourceQuantity),
          sourceLotNo,
          sourceSerialNo,
          lotNo: sourceLotNo,
          serialNo: sourceSerialNo,
          disassemblyLines: lines.map((line) => ({
            itemId: Number(line.itemId),
            quantity: Number(line.quantity),
            destinationType: line.destinationType,
            warehouseId: line.destinationType === "warehouse" ? Number(line.warehouseId) : null,
            routeId: line.destinationType === "process" ? Number(line.routeId) : null,
            startProcessId: line.destinationType === "process" ? Number(line.startProcessId) : null,
            lotNo: line.lotNo,
            serialNo: line.serialNo,
            remark: line.remark
          })),
          remark
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
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="disassembly-report-title">
        <div className="modal-header">
          <div><span className="eyebrow">生产拆解</span><h2 id="disassembly-report-title">拆解报工 · {task.taskNo}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </div>
        <form className="modal-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="form-note">来源产品从库存中扣减；每个拆解元器件可分别进入指定仓库，或自动创建新的后续生产工单。来源出库及各元器件入库均需按现有库存单据流程过账后，拆解任务才会完成。</div>
          {!options
            ? <div className="form-note">正在加载商品、仓库、库存和工艺路线...</div>
            : <>
                <div className="entry-table-section">
                  <div className="document-lines-heading">
                    <div><span className="eyebrow">来源产品</span><strong>{task.productItemCode} · {task.productItemName}</strong></div>
                    <span className="entry-table-hint">任务剩余可拆解 {formatQuantity(remainingQuantity)}</span>
                  </div>
                  <div className="entry-table-wrap">
                    <table className="entry-table disassembly-source-table">
                      <thead><tr><th>报工日期</th><th>来源仓库</th><th>可用库存</th><th>来源批次</th><th>来源序列号</th><th>本次拆解数量</th><th>备注</th></tr></thead>
                      <tbody><tr>
                        <td><input type="date" aria-label="拆解报工日期" value={reportDate} onChange={(event) => setReportDate(event.target.value)} /></td>
                        <td><select aria-label="来源仓库" value={sourceWarehouseId} onChange={(event) => { setSourceWarehouseId(event.target.value); setSourceLotNo(""); setSourceSerialNo(""); }}><option value="">请选择来源仓库</option>{options.warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></td>
                        <td className="quantity-cell">{formatQuantity(sourceBalance)}</td>
                        <td>{sourceItem?.trackingMode === "lot" ? <select aria-label="来源批次" value={sourceLotNo} onChange={(event) => setSourceLotNo(event.target.value)}><option value="">请选择批次</option>{sourceBalances.filter((balance) => balance.lotNo).map((balance) => <option value={balance.lotNo} key={balance.lotNo}>{balance.lotNo} · {formatQuantity(balance.quantity)}</option>)}</select> : <input aria-label="来源批次" value={sourceLotNo} disabled placeholder="无需批次" />}</td>
                        <td>{sourceItem?.trackingMode === "serial" ? <select aria-label="来源序列号" value={sourceSerialNo} onChange={(event) => setSourceSerialNo(event.target.value)}><option value="">请选择序列号</option>{sourceBalances.filter((balance) => balance.serialNo).map((balance) => <option value={balance.serialNo} key={balance.serialNo}>{balance.serialNo}</option>)}</select> : <input aria-label="来源序列号" value={sourceSerialNo} disabled placeholder="无需序列号" />}</td>
                        <td className="entry-number-cell"><input aria-label="本次拆解数量" type="number" min="0" max={remainingQuantity} step="any" value={sourceQuantity} onChange={(event) => setSourceQuantity(event.target.value)} /></td>
                        <td><input aria-label="拆解备注" value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="可选" /></td>
                      </tr></tbody>
                    </table>
                  </div>
                </div>
                <div className="entry-table-section">
                  <div className="document-lines-heading">
                    <div><span className="eyebrow">元器件产出</span><strong>一件产品可拆出多个元器件并分别流转</strong></div>
                    <button type="button" className="secondary-button" onClick={() => setLines((current) => [...current, blankLine()])}><Plus size={15} />新增元器件</button>
                  </div>
                  <div className="entry-table-wrap">
                    <table className="entry-table disassembly-lines-table">
                      <thead><tr><th>序号</th><th>元器件</th><th>数量</th><th>去向</th><th>目标仓库 / 后续路线</th><th>起始工序</th><th>批次号</th><th>序列号</th><th>备注</th><th className="action-cell">操作</th></tr></thead>
                      <tbody>{lines.map((line, index) => {
                        const item = selectedItem(line);
                        const routes = compatibleRoutes(line);
                        return <tr key={index}>
                          <td className="entry-index-cell">{index + 1}</td>
                          <td><select aria-label={`第 ${index + 1} 行元器件`} value={line.itemId} onChange={(event) => updateLine(index, "itemId", event.target.value)}><option value="">请选择元器件</option>{options.items.map((entry) => <option value={entry.id} key={entry.id}>{entry.itemCode} · {entry.name}</option>)}</select></td>
                          <td className="entry-number-cell"><input aria-label={`第 ${index + 1} 行数量`} type="number" min="0" step="any" value={line.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} /></td>
                          <td><select aria-label={`第 ${index + 1} 行去向`} value={line.destinationType} onChange={(event) => updateLine(index, "destinationType", event.target.value as DestinationType)}><option value="warehouse">进入仓库</option><option value="process">进入后续工序</option></select></td>
                          <td>{line.destinationType === "warehouse"
                            ? <select aria-label={`第 ${index + 1} 行目标仓库`} value={line.warehouseId} onChange={(event) => updateLine(index, "warehouseId", event.target.value)}><option value="">请选择仓库</option>{options.warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name}</option>)}</select>
                            : <select aria-label={`第 ${index + 1} 行后续路线`} value={line.routeId} onChange={(event) => updateLine(index, "routeId", event.target.value)}><option value="">请选择工艺路线</option>{routes.map((route) => <option value={route.id} key={route.id}>{route.code} · {route.name}</option>)}</select>}</td>
                          <td>{line.destinationType === "process" ? <select aria-label={`第 ${index + 1} 行起始工序`} value={line.startProcessId} onChange={(event) => updateLine(index, "startProcessId", event.target.value)}><option value="">请选择工序</option>{options.processes.map((process) => <option value={process.id} key={process.id}>{process.name}</option>)}</select> : <span className="muted-cell">-</span>}</td>
                          <td>{item?.trackingMode === "lot" ? <input aria-label={`第 ${index + 1} 行批次号`} value={line.lotNo} onChange={(event) => updateLine(index, "lotNo", event.target.value)} placeholder="必填" /> : <span className="muted-cell">-</span>}</td>
                          <td>{item?.trackingMode === "serial" ? <input aria-label={`第 ${index + 1} 行序列号`} value={line.serialNo} onChange={(event) => updateLine(index, "serialNo", event.target.value)} placeholder="必填" /> : <span className="muted-cell">-</span>}</td>
                          <td><input aria-label={`第 ${index + 1} 行备注`} value={line.remark} onChange={(event) => updateLine(index, "remark", event.target.value)} placeholder="例如：PCB 损坏" /></td>
                          <td className="action-cell"><button type="button" className="icon-button danger-icon" title="删除该行" aria-label={`删除第 ${index + 1} 行`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 size={16} /></button></td>
                        </tr>;
                      })}</tbody>
                    </table>
                  </div>
                </div>
              </>}
          {error && <div className="form-error">{error}</div>}
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!options || saving}>{saving ? "提交中..." : "提交拆解报工"} <Check size={16} /></button></div>
        </form>
      </section>
    </div>
  );
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value || 0);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}
