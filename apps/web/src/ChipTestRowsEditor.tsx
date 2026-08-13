import { Plus, Trash2 } from "lucide-react";
import {
  createDefaultOperationRow,
  getOperationRows,
  type OperationData,
  type OperationField,
  type OperationRow,
  type OperationTemplate
} from "./productionOperationTemplates";

type ChipTestRowsEditorProps = {
  template: OperationTemplate;
  data: OperationData;
  onChange: (data: OperationData) => void;
  readOnly?: boolean;
};

export function ChipTestRowsEditor({ template, data, onChange, readOnly = false }: ChipTestRowsEditorProps) {
  const tableKey = template.tableKey;
  const rows = getOperationRows(template, data);
  if (!tableKey) return null;

  const setRows = (nextRows: OperationRow[]) => onChange({ ...data, [tableKey]: nextRows });
  const updateCell = (rowIndex: number, field: OperationField, value: OperationRow[string]) => {
    setRows(rows.map((row, index) => index === rowIndex ? { ...row, [field.key]: value } : row));
  };

  return <div className="operation-fields operation-table-fields">
    <div className="document-lines-heading">
      <div><span className="eyebrow">工序明细</span><strong>{template.title}</strong></div>
      {!readOnly && <button type="button" className="secondary-button" onClick={() => setRows([...rows, createDefaultOperationRow(template)])}><Plus size={15} />新增型号</button>}
    </div>
    <div className="operation-table-wrap">
      <table className="operation-entry-table">
        <thead><tr><th>序号</th>{template.fields.map((field) => <th key={field.key}>{field.label}</th>)}{!readOnly && <th className="action-cell">操作</th>}</tr></thead>
        <tbody>
          {rows.map((row, rowIndex) => <tr key={rowIndex}>
            <td className="quantity-cell">{rowIndex + 1}</td>
            {template.fields.map((field) => <td key={field.key}>{readOnly ? <span>{formatCellValue(row[field.key])}</span> : <OperationCell field={field} value={row[field.key]} rowIndex={rowIndex} onChange={(value) => updateCell(rowIndex, field, value)} />}</td>)}
            {!readOnly && <td className="action-cell"><button type="button" className="icon-button danger-icon" disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, index) => index !== rowIndex))} aria-label={`删除第 ${rowIndex + 1} 行`} title="删除该型号"><Trash2 size={16} /></button></td>}
          </tr>)}
          {!rows.length && <tr><td colSpan={template.fields.length + 2}><div className="operation-table-empty">请新增一条芯片型号明细。</div></td></tr>}
        </tbody>
      </table>
    </div>
    {!readOnly && <div className="operation-table-summary">本次汇总：测试 {formatQuantity(total(rows, "testQuantity"))}，良品 {formatQuantity(total(rows, "goodQuantity"))}，不良 {formatQuantity(total(rows, "defectQuantity"))}。</div>}
  </div>;
}

function OperationCell({ field, value, rowIndex, onChange }: { field: OperationField; value: OperationRow[string] | undefined; rowIndex: number; onChange: (value: OperationRow[string]) => void }) {
  const ariaLabel = `${field.label} 第 ${rowIndex + 1} 行`;
  if (field.type === "select") {
    return <select aria-label={ariaLabel} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">请选择</option>{(field.options ?? []).map((option) => <option value={option} key={option}>{option}</option>)}</select>;
  }
  if (field.type === "multi") {
    const selected = Array.isArray(value) ? value.find((entry): entry is string => typeof entry === "string") ?? "" : "";
    return <select aria-label={ariaLabel} value={selected} onChange={(event) => onChange(event.target.value ? [event.target.value] : [])}><option value="">无</option>{(field.options ?? []).map((option) => <option value={option} key={option}>{option}</option>)}</select>;
  }
  return <input aria-label={ariaLabel} type={field.type === "number" ? "number" : "text"} min={field.type === "number" ? "0" : undefined} step={field.type === "number" ? "any" : undefined} value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => onChange(field.type === "number" ? Number(event.target.value || 0) : event.target.value)} />;
}

function total(rows: OperationRow[], key: string) {
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}

function formatCellValue(value: unknown) {
  if (Array.isArray(value)) return value.join("、") || "-";
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value);
}
