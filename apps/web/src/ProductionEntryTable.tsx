import {
  type OperationData,
  type OperationField,
  type OperationTemplate
} from "./productionOperationTemplates";

export type ReportEntryForm = {
  reportDate: string;
  inputQuantity: string;
  goodQuantity: string;
  defectQuantity: string;
  reworkQuantity: string;
  scrapQuantity: string;
  lotNo: string;
  serialNo: string;
  defectCode: string;
  remark: string;
};

export type WorkOrderEntryForm = {
  lines: WorkOrderProductLine[];
  managerUserId: string;
  priority: string;
  plannedStartDate: string;
  plannedEndDate: string;
  remark: string;
};

export type WorkOrderProductLine = {
  productItemId: string;
  routeId: string;
  plannedQuantity: string;
  remark: string;
};

type ReportQuantitySummary = {
  inputQuantity: number;
  goodQuantity: number;
  defectQuantity: number;
};

export function ProductionReportEntryTable({
  form,
  onChange,
  lockedQuantities = false,
  quantitySummary
}: {
  form: ReportEntryForm;
  onChange: (form: ReportEntryForm) => void;
  lockedQuantities?: boolean;
  quantitySummary?: ReportQuantitySummary;
}) {
  const update = <K extends keyof ReportEntryForm>(key: K, value: ReportEntryForm[K]) => {
    onChange({ ...form, [key]: value });
  };
  const quantity = (key: "inputQuantity" | "goodQuantity" | "defectQuantity") => {
    if (lockedQuantities && quantitySummary) return formatQuantity(quantitySummary[key]);
    return form[key];
  };

  return (
    <div className="entry-table-section">
      <div className="document-lines-heading">
        <div><span className="eyebrow">报工明细</span><strong>本次数量与追溯信息</strong></div>
        <span className="entry-table-hint">{lockedQuantities ? "数量由工序明细自动汇总" : "合格数量 + 不良数量 = 投入数量"}</span>
      </div>
      <div className="entry-table-wrap">
        <table className="entry-table report-entry-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>报工日期</th>
              <th>投入数量</th>
              <th>合格数量</th>
              <th>不良数量</th>
              <th>返工数量</th>
              <th>报废数量</th>
              <th>批次号</th>
              <th>序列号</th>
              <th>不良代码</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="entry-index-cell">1</td>
              <td><input aria-label="报工日期" type="date" value={form.reportDate} onChange={(event) => update("reportDate", event.target.value)} /></td>
              <td className="entry-number-cell">
                {lockedQuantities ? <span>{quantity("inputQuantity")}</span> : <input aria-label="投入数量" type="number" min="0" step="any" value={form.inputQuantity} onChange={(event) => update("inputQuantity", event.target.value)} />}
              </td>
              <td className="entry-number-cell">
                {lockedQuantities ? <span className="quantity-positive">{quantity("goodQuantity")}</span> : <input aria-label="合格数量" type="number" min="0" step="any" value={form.goodQuantity} onChange={(event) => update("goodQuantity", event.target.value)} />}
              </td>
              <td className="entry-number-cell">
                {lockedQuantities ? <span className="quantity-negative">{quantity("defectQuantity")}</span> : <input aria-label="不良数量" type="number" min="0" step="any" value={form.defectQuantity} onChange={(event) => update("defectQuantity", event.target.value)} />}
              </td>
              <td className="entry-number-cell"><input aria-label="返工数量" type="number" min="0" step="any" value={form.reworkQuantity} onChange={(event) => update("reworkQuantity", event.target.value)} /></td>
              <td className="entry-number-cell"><input aria-label="报废数量" type="number" min="0" step="any" value={form.scrapQuantity} onChange={(event) => update("scrapQuantity", event.target.value)} /></td>
              <td><input aria-label="批次号" value={form.lotNo} onChange={(event) => update("lotNo", event.target.value)} placeholder="可选" /></td>
              <td><input aria-label="序列号" value={form.serialNo} onChange={(event) => update("serialNo", event.target.value)} placeholder="可选" /></td>
              <td><input aria-label="不良代码" value={form.defectCode} onChange={(event) => update("defectCode", event.target.value)} placeholder="有不良时填写" /></td>
              <td><input aria-label="报工备注" value={form.remark} onChange={(event) => update("remark", event.target.value)} placeholder="可选" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProductionWorkOrderEntryTable({
  form,
  products,
  routes,
  operators,
  priorities,
  onChange
}: {
  form: WorkOrderEntryForm;
  products: Array<{ id: number; itemCode: string; name: string }>;
  routes: Array<{ id: number; code: string; name: string }>;
  operators: Array<{ id: number; displayName: string; position: string; processName?: string | null }>;
  priorities: Array<{ value: string; label: string }>;
  onChange: (form: WorkOrderEntryForm) => void;
}) {
  const update = <K extends keyof WorkOrderEntryForm>(key: K, value: WorkOrderEntryForm[K]) => {
    onChange({ ...form, [key]: value });
  };
  const updateLine = <K extends keyof WorkOrderProductLine>(index: number, key: K, value: WorkOrderProductLine[K]) => {
    onChange({
      ...form,
      lines: form.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line)
    });
  };
  const addLine = () => onChange({
    ...form,
    lines: [...form.lines, { productItemId: "", routeId: "", plannedQuantity: "", remark: "" }]
  });
  const removeLine = (index: number) => {
    if (form.lines.length === 1) return;
    onChange({ ...form, lines: form.lines.filter((_, lineIndex) => lineIndex !== index) });
  };
  return (
    <div className="entry-table-section">
      <div className="document-lines-heading">
        <div><span className="eyebrow">产品明细</span><strong>一张工单可安排多个产品</strong></div>
        <button type="button" className="secondary-button" onClick={addLine}>新增产品</button>
      </div>
      <div className="entry-table-wrap">
        <table className="entry-table work-order-entry-table">
          <thead><tr><th>序号</th><th>生产商品</th><th>工艺路线</th><th>计划数量</th><th>产品备注</th><th>操作</th></tr></thead>
          <tbody>{form.lines.map((line, index) => <tr key={index}>
            <td className="entry-index-cell">P{String(index + 1).padStart(2, "0")}</td>
            <td><select aria-label={`第 ${index + 1} 行生产商品`} value={line.productItemId} onChange={(event) => updateLine(index, "productItemId", event.target.value)}><option value="">请选择商品</option>{products.map((product) => <option value={product.id} key={product.id}>{product.itemCode} · {product.name}</option>)}</select></td>
            <td><select aria-label={`第 ${index + 1} 行工艺路线`} value={line.routeId} onChange={(event) => updateLine(index, "routeId", event.target.value)}><option value="">请选择路线</option>{routes.map((route) => <option value={route.id} key={route.id}>{route.code} · {route.name}</option>)}</select></td>
            <td className="entry-number-cell"><input aria-label={`第 ${index + 1} 行计划数量`} type="number" min="0" step="any" value={line.plannedQuantity} onChange={(event) => updateLine(index, "plannedQuantity", event.target.value)} /></td>
            <td><input aria-label={`第 ${index + 1} 行产品备注`} value={line.remark} onChange={(event) => updateLine(index, "remark", event.target.value)} placeholder="可选" /></td>
            <td className="action-cell"><button type="button" className="table-action danger-action" disabled={form.lines.length === 1} onClick={() => removeLine(index)}>删除</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="form-grid work-order-common-fields">
        <label>工单负责人<select value={form.managerUserId} onChange={(event) => update("managerUserId", event.target.value)}><option value="">暂不指定</option>{operators.map((operator) => <option value={operator.id} key={operator.id}>{operator.displayName} · {operator.processName || "未分配工序"} · {operator.position || "员工"}</option>)}</select></label>
        <label>优先级<select value={form.priority} onChange={(event) => update("priority", event.target.value)}>{priorities.map((priority) => <option value={priority.value} key={priority.value}>{priority.label}</option>)}</select></label>
        <label>计划开始<input type="date" value={form.plannedStartDate} onChange={(event) => update("plannedStartDate", event.target.value)} /></label>
        <label>计划结束<input type="date" value={form.plannedEndDate} onChange={(event) => update("plannedEndDate", event.target.value)} /></label>
        <label className="full-span">工单备注<textarea rows={2} value={form.remark} onChange={(event) => update("remark", event.target.value)} /></label>
      </div>
    </div>
  );
}

export function OperationFieldsTable({
  template,
  data,
  onChange
}: {
  template: OperationTemplate;
  data: OperationData;
  onChange: (data: OperationData) => void;
}) {
  if (!template.fields.length) return null;

  const updateField = (key: string, value: OperationData[string]) => {
    onChange({ ...data, [key]: value });
  };

  return (
    <div className="entry-table-section">
      <div className="document-lines-heading">
        <div><span className="eyebrow">工序明细</span><strong>{template.title}</strong></div>
        <span className="entry-table-hint">按当前工序填写一行作业数据</span>
      </div>
      <div className="entry-table-wrap">
        <table className="entry-table operation-field-table">
          <thead><tr><th>序号</th>{template.fields.map((field) => <th key={field.key}>{field.label}</th>)}</tr></thead>
          <tbody>
            <tr>
              <td className="entry-index-cell">1</td>
              {template.fields.map((field) => (
                <td key={field.key}>
                  <OperationFieldCell field={field} value={data[field.key]} onChange={(value) => updateField(field.key, value)} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OperationFieldCell({
  field,
  value,
  onChange
}: {
  field: OperationField;
  value: OperationData[string] | undefined;
  onChange: (value: OperationData[string]) => void;
}) {
  if (field.type === "select") {
    return <select aria-label={field.label} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">请选择</option>{(field.options ?? []).map((option) => <option value={option} key={option}>{option}</option>)}</select>;
  }
  if (field.type === "multi") {
    const values = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    return <select aria-label={field.label} multiple value={values} onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))}>{(field.options ?? []).map((option) => <option value={option} key={option}>{option}</option>)}</select>;
  }
  if (field.type === "textarea") {
    return <textarea aria-label={field.label} rows={2} value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
  }
  return <input aria-label={field.label} type={field.type === "number" ? "number" : "text"} min={field.type === "number" ? "0" : undefined} step={field.type === "number" ? "any" : undefined} value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => onChange(field.type === "number" ? Number(event.target.value || 0) : event.target.value)} />;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value);
}
