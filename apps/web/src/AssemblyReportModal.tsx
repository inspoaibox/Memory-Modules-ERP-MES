import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { request } from "./api";

type TrackingMode = "none" | "lot" | "serial";

type Task = {
  id: number;
  taskNo: string;
  productItemCode: string;
  productItemName: string;
  productTrackingMode: TrackingMode;
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

type Balance = {
  itemId: number;
  warehouseId: number;
  lotNo: string;
  serialNo: string;
  quantity: number;
};

type AssemblyOptions = {
  items: Item[];
  warehouses: Warehouse[];
  balances: Balance[];
};

type AssemblyLineForm = {
  itemId: string;
  sourceWarehouseId: string;
  unitQuantity: string;
  lotNo: string;
  serialNo: string;
  remark: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const blankLine = (): AssemblyLineForm => ({
  itemId: "",
  sourceWarehouseId: "",
  unitQuantity: "",
  lotNo: "",
  serialNo: "",
  remark: ""
});

export function AssemblyReportModal({
  task,
  onClose,
  onSaved
}: {
  task: Task;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [options, setOptions] = useState<AssemblyOptions | null>(null);
  const [reportDate, setReportDate] = useState(today());
  const [assemblyQuantity, setAssemblyQuantity] = useState("");
  const [outputLotNo, setOutputLotNo] = useState("");
  const [outputSerialNo, setOutputSerialNo] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<AssemblyLineForm[]>([blankLine()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void request<AssemblyOptions>("/production/assembly-options")
      .then((result) => {
        if (active) setOptions(result);
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError));
      });
    return () => {
      active = false;
    };
  }, []);

  const quantity = Number(assemblyQuantity) || 0;
  const remainingQuantity = Math.max(task.plannedQuantity - task.inputQuantity, 0);

  const updateLine = <K extends keyof AssemblyLineForm>(
    index: number,
    key: K,
    value: AssemblyLineForm[K]
  ) => {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [key]: value } : line
      )
    );
  };

  const selectedItem = (line: AssemblyLineForm) =>
    options?.items.find((item) => item.id === Number(line.itemId));

  const lineBalances = (line: AssemblyLineForm) =>
    options?.balances.filter(
      (balance) =>
        balance.itemId === Number(line.itemId) &&
        balance.warehouseId === Number(line.sourceWarehouseId)
    ) ?? [];

  const selectedBalance = (line: AssemblyLineForm) =>
    lineBalances(line).find(
      (balance) =>
        balance.lotNo === line.lotNo && balance.serialNo === line.serialNo
    )?.quantity ?? 0;

  const totalRequired = useMemo(
    () =>
      lines.reduce(
        (total, line) => total + (Number(line.unitQuantity) || 0) * quantity,
        0
      ),
    [lines, quantity]
  );

  const submit = async () => {
    setError("");
    setSaving(true);
    try {
      await request(`/production/tasks/${task.id}/report`, {
        method: "POST",
        body: JSON.stringify({
          reportDate,
          inputQuantity: quantity,
          goodQuantity: quantity,
          defectQuantity: 0,
          assemblyQuantity: quantity,
          lotNo: outputLotNo,
          serialNo: outputSerialNo,
          assemblyLines: lines.map((line) => ({
            itemId: Number(line.itemId),
            sourceWarehouseId: Number(line.sourceWarehouseId),
            unitQuantity: Number(line.unitQuantity),
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
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assembly-report-title"
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">生产组装</span>
            <h2 id="assembly-report-title">组装报工 · {task.taskNo}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </div>
        <form
          className="modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="form-note">
            组装是多个元器件领用后形成一个生产产品。系统按照“单件用量 × 本次组装数量”自动计算实际领用，并为来源仓库生成出库单，库存单据完成审批和过账后才会继续流转。
          </div>
          {!options ? (
            <div className="form-note">正在加载商品、仓库和库存...</div>
          ) : (
            <>
              <div className="entry-table-section">
                <div className="document-lines-heading">
                  <div>
                    <span className="eyebrow">组装成品</span>
                    <strong>
                      {task.productItemCode} · {task.productItemName}
                    </strong>
                  </div>
                  <span className="entry-table-hint">
                    剩余计划 {formatQuantity(remainingQuantity)}
                  </span>
                </div>
                <div className="entry-table-wrap">
                  <table className="entry-table assembly-output-table">
                    <thead>
                      <tr>
                        <th>报工日期</th>
                        <th>成品编码</th>
                        <th>成品名称</th>
                        <th>本次组装数量</th>
                        <th>成品批次号</th>
                        <th>成品序列号</th>
                        <th>本次元器件领用总量</th>
                        <th>备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <input
                            type="date"
                            aria-label="组装报工日期"
                            value={reportDate}
                            onChange={(event) => setReportDate(event.target.value)}
                          />
                        </td>
                        <td>{task.productItemCode}</td>
                        <td>{task.productItemName}</td>
                        <td className="entry-number-cell">
                          <input
                            aria-label="本次组装数量"
                            type="number"
                            min="0"
                            max={remainingQuantity}
                            step="any"
                            value={assemblyQuantity}
                            onChange={(event) => setAssemblyQuantity(event.target.value)}
                          />
                        </td>
                        <td>
                          {task.productTrackingMode === "lot" ? (
                            <input
                              aria-label="成品批次号"
                              value={outputLotNo}
                              onChange={(event) => setOutputLotNo(event.target.value)}
                              placeholder="必填"
                            />
                          ) : (
                            <span className="muted-cell">-</span>
                          )}
                        </td>
                        <td>
                          {task.productTrackingMode === "serial" ? (
                            <input
                              aria-label="成品序列号"
                              value={outputSerialNo}
                              onChange={(event) => setOutputSerialNo(event.target.value)}
                              placeholder="组装数量为 1 时填写"
                            />
                          ) : (
                            <span className="muted-cell">-</span>
                          )}
                        </td>
                        <td className="quantity-cell">{formatQuantity(totalRequired)}</td>
                        <td>
                          <input
                            aria-label="组装备注"
                            value={remark}
                            onChange={(event) => setRemark(event.target.value)}
                            placeholder="可选"
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="entry-table-section">
                <div className="document-lines-heading">
                  <div>
                    <span className="eyebrow">组装元器件</span>
                    <strong>多个元器件按来源仓库领用，自动合计实际出库数量</strong>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setLines((current) => [...current, blankLine()])}
                  >
                    <Plus size={15} />
                    新增元器件
                  </button>
                </div>
                <div className="entry-table-wrap">
                  <table className="entry-table assembly-lines-table">
                    <thead>
                      <tr>
                        <th>序号</th>
                        <th>元器件</th>
                        <th>来源仓库</th>
                        <th>可用库存</th>
                        <th>单件用量</th>
                        <th>实际领用数量</th>
                        <th>批次号</th>
                        <th>序列号</th>
                        <th>备注</th>
                        <th className="action-cell">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, index) => {
                        const item = selectedItem(line);
                        const balances = lineBalances(line);
                        const available = selectedBalance(line);
                        const required = (Number(line.unitQuantity) || 0) * quantity;
                        return (
                          <tr key={index}>
                            <td className="entry-index-cell">{index + 1}</td>
                            <td>
                              <select
                                aria-label={`第 ${index + 1} 行元器件`}
                                value={line.itemId}
                                onChange={(event) =>
                                  setLines((current) =>
                                    current.map((entry, lineIndex) =>
                                      lineIndex === index
                                        ? {
                                            ...entry,
                                            itemId: event.target.value,
                                            lotNo: "",
                                            serialNo: ""
                                          }
                                        : entry
                                    )
                                  )
                                }
                              >
                                <option value="">请选择元器件</option>
                                {options.items.map((entry) => (
                                  <option value={entry.id} key={entry.id}>
                                    {entry.itemCode} · {entry.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <select
                                aria-label={`第 ${index + 1} 行来源仓库`}
                                value={line.sourceWarehouseId}
                                onChange={(event) =>
                                  setLines((current) =>
                                    current.map((entry, lineIndex) =>
                                      lineIndex === index
                                        ? {
                                            ...entry,
                                            sourceWarehouseId: event.target.value,
                                            lotNo: "",
                                            serialNo: ""
                                          }
                                        : entry
                                    )
                                  )
                                }
                              >
                                <option value="">请选择仓库</option>
                                {options.warehouses.map((warehouse) => (
                                  <option value={warehouse.id} key={warehouse.id}>
                                    {warehouse.code} · {warehouse.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="quantity-cell">
                              {formatQuantity(available)}
                            </td>
                            <td className="entry-number-cell">
                              <input
                                aria-label={`第 ${index + 1} 行单件用量`}
                                type="number"
                                min="0"
                                step="any"
                                value={line.unitQuantity}
                                onChange={(event) =>
                                  updateLine(index, "unitQuantity", event.target.value)
                                }
                              />
                            </td>
                            <td className="quantity-cell">
                              <strong>{formatQuantity(required)}</strong>
                            </td>
                            <td>
                              {item?.trackingMode === "lot" ? (
                                <select
                                  aria-label={`第 ${index + 1} 行批次号`}
                                  value={line.lotNo}
                                  onChange={(event) =>
                                    updateLine(index, "lotNo", event.target.value)
                                  }
                                >
                                  <option value="">请选择批次</option>
                                  {balances
                                    .filter((balance) => balance.lotNo)
                                    .map((balance) => (
                                      <option
                                        value={balance.lotNo}
                                        key={`${balance.lotNo}-${balance.serialNo}`}
                                      >
                                        {balance.lotNo} · {formatQuantity(balance.quantity)}
                                      </option>
                                    ))}
                                </select>
                              ) : (
                                <span className="muted-cell">-</span>
                              )}
                            </td>
                            <td>
                              {item?.trackingMode === "serial" ? (
                                <select
                                  aria-label={`第 ${index + 1} 行序列号`}
                                  value={line.serialNo}
                                  onChange={(event) =>
                                    updateLine(index, "serialNo", event.target.value)
                                  }
                                >
                                  <option value="">请选择序列号</option>
                                  {balances
                                    .filter((balance) => balance.serialNo)
                                    .map((balance) => (
                                      <option
                                        value={balance.serialNo}
                                        key={`${balance.serialNo}-${balance.lotNo}`}
                                      >
                                        {balance.serialNo}
                                      </option>
                                    ))}
                                </select>
                              ) : (
                                <span className="muted-cell">-</span>
                              )}
                            </td>
                            <td>
                              <input
                                aria-label={`第 ${index + 1} 行备注`}
                                value={line.remark}
                                onChange={(event) =>
                                  updateLine(index, "remark", event.target.value)
                                }
                                placeholder="可选"
                              />
                            </td>
                            <td className="action-cell">
                              <button
                                type="button"
                                className="icon-button danger-icon"
                                title="删除该行"
                                aria-label={`删除第 ${index + 1} 行`}
                                disabled={lines.length === 1}
                                onClick={() =>
                                  setLines((current) =>
                                    current.filter((_, lineIndex) => lineIndex !== index)
                                  )
                                }
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {error && <div className="form-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              取消
            </button>
            <button className="primary-button" disabled={!options || saving}>
              {saving ? "提交中..." : "提交组装报工"} <Check size={16} />
            </button>
          </div>
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
