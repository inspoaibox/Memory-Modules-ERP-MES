export type OperationFieldType = "text" | "number" | "select" | "textarea" | "multi";

export type OperationField = {
  key: string;
  label: string;
  type: OperationFieldType;
  options?: string[];
  placeholder?: string;
};

export type OperationRow = Record<string, string | number | boolean | string[]>;

export type OperationTemplate = {
  title: string;
  fields: OperationField[];
  layout?: "form" | "table";
  tableKey?: string;
};

export type OperationData = Record<string, string | number | boolean | string[] | OperationRow[]>;

const defectReasons = ["破损", "死机", "报错", "掉点", "其他"];

const templates: Array<{ match: (processCode: string, processName: string) => boolean; template: OperationTemplate }> = [
  {
    match: (code, name) => code.includes("CHIP-TEST") || name.includes("芯片初测"),
    template: {
      title: "芯片初测作业项",
      layout: "table",
      tableKey: "chipTestRows",
      fields: [
        { key: "chipModel", label: "芯片型号", type: "text", placeholder: "例如：H5TQ4G83CFR" },
        { key: "chipSpec", label: "规格", type: "text", placeholder: "容量 / 频率 / 封装" },
        { key: "chipName", label: "名称", type: "text", placeholder: "芯片或颗粒名称" },
        { key: "testQuantity", label: "测试数量", type: "number" },
        { key: "goodQuantity", label: "良品数量", type: "number" },
        { key: "defectQuantity", label: "不良数量", type: "number" },
        { key: "testResult", label: "测试结果", type: "select", options: ["合格", "部分不良", "不合格"] },
        { key: "defectReasons", label: "不良原因", type: "multi", options: defectReasons },
        { key: "defectDescription", label: "不良说明", type: "text", placeholder: "补充不良位置、现象或设备报错信息" }
      ]
    }
  },
  {
    match: (code, name) => code.includes("BGA") || name.includes("植球"),
    template: {
      title: "芯片拆卸植球作业项",
      fields: [
        { key: "chipModel", label: "芯片型号", type: "text" },
        { key: "batchNo", label: "作业批次", type: "text" },
        { key: "bgaQuantity", label: "植球数量", type: "number" },
        { key: "appearanceResult", label: "外观结果", type: "select", options: ["合格", "需返修", "报废"] },
        { key: "operationNote", label: "作业说明", type: "textarea" }
      ]
    }
  },
  {
    match: (code, name) => code.includes("OUTSOURCE") || name.includes("委外"),
    template: {
      title: "委外加工作业项",
      fields: [
        { key: "supplierName", label: "委外供应商", type: "text" },
        { key: "outsourceOrderNo", label: "委外单号", type: "text" },
        { key: "sentQuantity", label: "送外数量", type: "number" },
        { key: "returnedQuantity", label: "回厂数量", type: "number" },
        { key: "operationNote", label: "委外说明", type: "textarea" }
      ]
    }
  },
  {
    match: (code, name) => code.includes("SMT") || name.includes("SMT"),
    template: {
      title: "SMT贴片作业项",
      fields: [
        { key: "pcbModel", label: "PCB型号", type: "text" },
        { key: "lineName", label: "生产线", type: "text" },
        { key: "smtQuantity", label: "贴片数量", type: "number" },
        { key: "reflowProfile", label: "炉温曲线", type: "text" },
        { key: "operationNote", label: "贴片说明", type: "textarea" }
      ]
    }
  },
  {
    match: (code, name) => code.includes("AGING") || name.includes("老化"),
    template: {
      title: "成品测试老化作业项",
      fields: [
        { key: "deviceNo", label: "测试设备", type: "text" },
        { key: "agingHours", label: "老化时长", type: "number" },
        { key: "testResult", label: "测试结果", type: "select", options: ["合格", "部分不良", "不合格"] },
        { key: "defectReasons", label: "不良原因", type: "multi", options: defectReasons },
        { key: "testNote", label: "测试说明", type: "textarea" }
      ]
    }
  },
  {
    match: (code, name) => code.includes("FQC") || name.includes("日检"),
    template: {
      title: "日检入库作业项",
      fields: [
        { key: "inspectionStandard", label: "检验标准", type: "text" },
        { key: "inspectionResult", label: "检验结果", type: "select", options: ["合格", "不合格"] },
        { key: "inboundLotNo", label: "入库批次", type: "text" },
        { key: "inspectionNote", label: "检验说明", type: "textarea" }
      ]
    }
  }
];

export function getOperationTemplate(processCode: string, processName: string, processType?: string): OperationTemplate {
  const code = processCode.toUpperCase();
  const matched = templates.find((entry) => entry.match(code, processName));
  if (matched) return matched.template;
  if (processType === "testing" || processName.includes("测试")) {
    return {
      title: "测试作业项",
      fields: [
        { key: "testResult", label: "测试结果", type: "select", options: ["合格", "部分不良", "不合格"] },
        { key: "defectReasons", label: "不良原因", type: "multi", options: defectReasons },
        { key: "testNote", label: "测试说明", type: "textarea" }
      ]
    };
  }
  return { title: "工序作业项", fields: [{ key: "operationNote", label: "作业说明", type: "textarea" }] };
}

export function createDefaultOperationData(template: OperationTemplate, quantity?: number): OperationData {
  const data: OperationData = {};
  if (template.layout === "table" && template.tableKey) {
    data[template.tableKey] = [createDefaultOperationRow(template, quantity)];
    return data;
  }
  for (const field of template.fields) {
    if (field.type === "multi") data[field.key] = [];
    else if (field.type === "number") data[field.key] = field.key.toLowerCase().includes("quantity") && quantity ? quantity : "";
    else data[field.key] = "";
  }
  return data;
}

export function createDefaultOperationRow(template: OperationTemplate, quantity?: number): OperationRow {
  const row: OperationRow = {};
  for (const field of template.fields) {
    if (field.type === "multi") row[field.key] = [];
    else if (field.type === "number") row[field.key] = field.key === "testQuantity" && quantity ? quantity : "";
    else row[field.key] = "";
  }
  return row;
}

export function getOperationRows(template: OperationTemplate, data?: OperationData): OperationRow[] {
  if (!template.tableKey) return [];
  const rows = data?.[template.tableKey];
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is OperationRow => typeof row === "object" && row !== null && !Array.isArray(row));
}

export function formatOperationValue(field: OperationField, value: unknown) {
  if (Array.isArray(value)) return value.length ? value.join("、") : "-";
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}
