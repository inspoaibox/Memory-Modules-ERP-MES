import bcrypt from "bcryptjs";
import { db, type WarehouseType } from "./db.js";

type IdRow = { id: number };
type DemoDocumentType = "receipt" | "issue" | "transfer" | "count" | "scrap";
type DemoDocumentStatus = "draft" | "submitted" | "approved" | "posted";

type DemoLine = {
  itemId: number;
  quantity: number;
  lotNo?: string;
  serialNo?: string;
  remark?: string;
};

type DemoDocument = {
  documentNo: string;
  documentType: DemoDocumentType;
  status: DemoDocumentStatus;
  businessDate: string;
  departmentId: number;
  warehouseId?: number | null;
  sourceWarehouseId?: number | null;
  targetWarehouseId?: number | null;
  supplierName?: string;
  purchaseOrderNo?: string;
  referenceNo?: string;
  reason?: string;
  remark?: string;
  createdBy: number;
  submittedBy?: number;
  approvedBy?: number;
  postedBy?: number;
  lines: DemoLine[];
};

type DemoProcessType = "manufacturing" | "testing" | "outsourcing" | "repair" | "warehouse" | "inspection";
type DemoTaskStatus = "pending" | "ready" | "in_progress" | "completed" | "abnormal";
type DemoOutputTarget = "next_process" | "semi_finished" | "finished_goods";

const DEMO_SENTINEL_USERNAME = "demo.warehouse";

const processRoleCode = (processCode: string, kind: "manager" | "operator") => `${processCode}-${kind === "manager" ? "MANAGER" : "OPERATOR"}`;

function requireId(table: "departments" | "roles" | "units" | "item_categories" | "item_attribute_definitions" | "warehouses", code: string) {
  const row = db.prepare(`SELECT id FROM ${table} WHERE code = ?`).get(code) as IdRow | undefined;
  if (!row) throw new Error(`演示数据依赖的 ${table} 编码不存在：${code}`);
  return row.id;
}

function requireItemId(itemCode: string) {
  const row = db.prepare("SELECT id FROM items WHERE item_code = ?").get(itemCode) as IdRow | undefined;
  if (!row) throw new Error(`演示数据依赖的商品编码不存在：${itemCode}`);
  return row.id;
}

function requireUserId(username: string) {
  const row = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as IdRow | undefined;
  if (!row) throw new Error(`演示数据依赖的账号不存在：${username}`);
  return row.id;
}

function requireProductionProcessId(code: string) {
  const row = db.prepare("SELECT id FROM production_processes WHERE code = ?").get(code) as IdRow | undefined;
  if (!row) throw new Error(`演示数据依赖的工序编码不存在：${code}`);
  return row.id;
}

function ensureUser(spec: {
  username: string;
  password: string;
  displayName: string;
  employeeNo: string;
  position: string;
  departmentCode: string;
  roleCode: string;
  managedDepartmentCodes?: string[];
}) {
  const departmentId = requireId("departments", spec.departmentCode);
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(spec.username) as IdRow | undefined;
  const userId = existing
    ? existing.id
    : Number(
        db
          .prepare(
            `INSERT INTO users
             (username, password_hash, display_name, employee_no, position, department_id, must_change_password)
             VALUES (?, ?, ?, ?, ?, ?, 1)`
          )
          .run(
            spec.username,
            bcrypt.hashSync(spec.password, 10),
            spec.displayName,
            spec.employeeNo,
            spec.position,
            departmentId
          ).lastInsertRowid
      );

  const roleId = requireId("roles", spec.roleCode);
  db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)").run(userId, roleId);

  const insertManager = db.prepare(
    "INSERT OR IGNORE INTO department_managers (department_id, user_id) VALUES (?, ?)"
  );
  for (const departmentCode of spec.managedDepartmentCodes ?? []) {
    insertManager.run(requireId("departments", departmentCode), userId);
  }
  return userId;
}

function ensureCategory(code: string, name: string, parentId: number | null, description: string) {
  db.prepare(
    `INSERT OR IGNORE INTO item_categories (parent_id, code, name, description)
     VALUES (?, ?, ?, ?)`
  ).run(parentId, code, name, description);
  return requireId("item_categories", code);
}

function ensureItem(spec: {
  itemCode: string;
  name: string;
  categoryId: number;
  unitId: number;
  barcode: string;
  trackingMode: "none" | "lot" | "serial";
  description: string;
}) {
  db.prepare(
    `INSERT OR IGNORE INTO items
     (item_code, name, category_id, unit_id, barcode, tracking_mode, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    spec.itemCode,
    spec.name,
    spec.categoryId,
    spec.unitId,
    spec.barcode,
    spec.trackingMode,
    spec.description
  );
  return requireItemId(spec.itemCode);
}

function setAttributeValue(itemId: number, attributeCode: string, value: string) {
  const attributeId = requireId("item_attribute_definitions", attributeCode);
  db.prepare(
    `INSERT OR REPLACE INTO item_attribute_values (item_id, attribute_id, value)
     VALUES (?, ?, ?)`
  ).run(itemId, attributeId, value);
}

function ensureWarehouse(spec: {
  code: string;
  name: string;
  departmentCode: string;
  managerUserId: number;
  warehouseType: WarehouseType;
  address: string;
  description: string;
}) {
  const departmentId = requireId("departments", spec.departmentCode);
  db.prepare(
    `INSERT OR IGNORE INTO warehouses
     (code, name, department_id, manager_user_id, warehouse_type, address, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(spec.code, spec.name, departmentId, spec.managerUserId, spec.warehouseType, spec.address, spec.description);
  db.prepare(
    `UPDATE warehouses
     SET name = ?, department_id = ?, manager_user_id = ?, warehouse_type = ?,
         address = ?, description = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
     WHERE code = ?`
  ).run(spec.name, departmentId, spec.managerUserId, spec.warehouseType, spec.address, spec.description, spec.code);
  return requireId("warehouses", spec.code);
}

function ensureProductionProcess(spec: {
  code: string;
  name: string;
  processType: DemoProcessType;
  sortOrder: number;
  description: string;
}) {
  db.prepare(
    `INSERT OR IGNORE INTO production_processes
     (code, name, process_type, sort_order, description)
     VALUES (?, ?, ?, ?, ?)`
  ).run(spec.code, spec.name, spec.processType, spec.sortOrder, spec.description);
  db.prepare(
    `UPDATE production_processes
     SET name = ?, process_type = ?, sort_order = ?, description = ?,
         status = 'active', updated_at = CURRENT_TIMESTAMP
     WHERE code = ?`
  ).run(spec.name, spec.processType, spec.sortOrder, spec.description, spec.code);
  return requireProductionProcessId(spec.code);
}

function ensureProcessRoleAuthorization(processId: number, roleCodes: string[]) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO production_process_role_authorizations (process_id, role_id) VALUES (?, ?)"
  );
  for (const roleCode of roleCodes) insert.run(processId, requireId("roles", roleCode));
}

function ensureProductionRoute(spec: {
  code: string;
  name: string;
  productItemId: number;
  description: string;
  steps: Array<{
    processId: number;
    defaultDepartmentId: number;
    outputTarget: string;
    outputItemId?: number | null;
    outputWarehouseId?: number | null;
    qualityGate?: boolean;
    description?: string;
  }>;
}) {
  const existing = db.prepare("SELECT id FROM production_routes WHERE code = ?").get(spec.code) as IdRow | undefined;
  const routeId = existing
    ? existing.id
    : Number(
        db
          .prepare(
            `INSERT INTO production_routes (code, name, product_item_id, description)
             VALUES (?, ?, ?, ?)`
          )
          .run(spec.code, spec.name, spec.productItemId, spec.description).lastInsertRowid
      );
  db.prepare(
    "UPDATE production_routes SET name = ?, product_item_id = ?, description = ?, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(spec.name, spec.productItemId, spec.description, routeId);
  db.prepare("DELETE FROM production_route_steps WHERE route_id = ?").run(routeId);
  const insertStep = db.prepare(
    `INSERT INTO production_route_steps
     (route_id, process_id, step_no, default_department_id, output_target,
      output_item_id, output_warehouse_id, quality_gate, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  spec.steps.forEach((step, index) => {
    insertStep.run(
      routeId,
      step.processId,
      index + 1,
      step.defaultDepartmentId,
      step.outputTarget,
      step.outputItemId ?? null,
      step.outputWarehouseId ?? null,
      step.qualityGate ? 1 : 0,
      step.description ?? ""
    );
  });
  return routeId;
}

function ensureProductionWorkOrder(spec: {
  workOrderNo: string;
  productItemId: number;
  routeId: number;
  departmentId: number;
  managerUserId: number;
  plannedQuantity: number;
  createdBy: number;
  tasks: Array<{
    taskNo: string;
    routeStepId: number;
    processId: number;
    sequenceNo: number;
    assignedDepartmentId: number;
    status: DemoTaskStatus;
    outputTarget?: DemoOutputTarget;
    qualityGate?: boolean;
    outputItemId?: number | null;
    outputWarehouseId?: number | null;
    inputQuantity?: number;
    goodQuantity?: number;
    outputQuantity?: number;
    defectQuantity?: number;
    plannedQuantity?: number;
    assignedUserId?: number;
    report?: {
      reportNo: string;
      operatorUserId: number;
      inputQuantity: number;
      goodQuantity: number;
      defectQuantity: number;
      remark: string;
    };
  }>;
}) {
  const existing = db.prepare("SELECT id FROM production_work_orders WHERE work_order_no = ?").get(spec.workOrderNo) as
    | IdRow
    | undefined;
  if (existing) {
    db.prepare("DELETE FROM production_repairs WHERE work_order_id = ?").run(existing.id);
    db.prepare("DELETE FROM production_quality_checks WHERE work_order_id = ?").run(existing.id);
    db.prepare(
      `DELETE FROM production_inventory_links
       WHERE task_id IN (SELECT id FROM production_tasks WHERE work_order_id = ?)`
    ).run(existing.id);
    db.prepare("DELETE FROM production_work_orders WHERE id = ?").run(existing.id);
  }
  const workOrderId = Number(
    db.prepare(
      `INSERT INTO production_work_orders
       (work_order_no, product_item_id, route_id, department_id, manager_user_id,
        planned_quantity, status, priority, planned_start_date, planned_end_date, remark, created_by, released_at)
       VALUES (?, ?, ?, ?, ?, ?, 'in_progress', 'normal', date('now'), date('now', '+5 day'), ?, ?, CURRENT_TIMESTAMP)`
    ).run(
      spec.workOrderNo,
      spec.productItemId,
      spec.routeId,
      spec.departmentId,
      spec.managerUserId,
      spec.plannedQuantity,
      "演示生产工单，用于验证工序任务、报工和维修闭环",
      spec.createdBy
    ).lastInsertRowid
  );
  const insertTask = db.prepare(
    `INSERT INTO production_tasks
     (task_no, work_order_id, route_step_id, process_id, sequence_no, assigned_department_id,
      assigned_user_id, output_target, quality_gate, output_item_id, output_warehouse_id,
      planned_quantity, input_quantity, good_quantity, output_quantity, defect_quantity,
      output_lot_no, status, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertReport = db.prepare(
    `INSERT INTO production_reports
     (report_no, task_id, work_order_id, process_id, operator_user_id, report_date,
      input_quantity, good_quantity, defect_quantity, lot_no, remark)
     VALUES (?, ?, ?, ?, ?, date('now'), ?, ?, ?, 'DEMO-DDR4-LOT-001', ?)`
  );
  let abnormalReportId: number | null = null;
  let abnormalTaskId: number | null = null;
  for (const task of spec.tasks) {
    const taskId = Number(
      insertTask.run(
        task.taskNo,
        workOrderId,
        task.routeStepId,
        task.processId,
        task.sequenceNo,
        task.assignedDepartmentId,
        task.assignedUserId ?? null,
        task.outputTarget ?? "next_process",
        task.qualityGate ? 1 : 0,
        task.outputItemId ?? null,
        task.outputWarehouseId ?? null,
        task.plannedQuantity ?? spec.plannedQuantity,
        task.inputQuantity ?? 0,
        task.goodQuantity ?? 0,
        task.outputQuantity ?? 0,
        task.defectQuantity ?? 0,
        task.report ? "DEMO-DDR4-LOT-001" : "",
        task.status,
        ["completed", "abnormal", "in_progress"].includes(task.status) ? new Date().toISOString() : null,
        task.status === "completed" ? new Date().toISOString() : null
      ).lastInsertRowid
    );
    if (task.report) {
      const reportId = Number(
        insertReport.run(
          task.report.reportNo,
          taskId,
          workOrderId,
          task.processId,
          task.report.operatorUserId,
          task.report.inputQuantity,
          task.report.goodQuantity,
          task.report.defectQuantity,
          task.report.remark
        ).lastInsertRowid
      );
      if (task.report.defectQuantity > 0) {
        abnormalReportId = reportId;
        abnormalTaskId = taskId;
      }
    }
  }
  if (abnormalTaskId && abnormalReportId) {
    db.prepare(
      `INSERT OR IGNORE INTO production_repairs
       (repair_no, work_order_id, source_task_id, report_id, item_id, quantity,
        defect_code, defect_description, repair_defect_quantity, status, owner_user_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(
      "DEMO-FIX-001",
      workOrderId,
      abnormalTaskId,
      abnormalReportId,
      spec.productItemId,
       2,
       "TEST_FAIL",
       "芯片测试失败，等待维修完成",
       2,
       spec.managerUserId,
      spec.createdBy
    );
  }
  return workOrderId;
}

function ensureProductionDemoData() {
  const productionUserId = requireUserId("demo.production");
  const managerId = requireUserId("demo.manager");
  const operatorId = requireUserId("demo.operator");
  const qualityUserId = requireUserId("demo.quality");
  const warehouseUserId = requireUserId("demo.warehouse");
  const ddr4ItemId = requireItemId("DEMO-DDR4-8G-3200");
  const productionDepartmentId = requireId("departments", "PRODUCTION");
  const qualityDepartmentId = requireId("departments", "QUALITY");
  ensureWarehouse({
    code: "DEMO-WH-RAW",
    name: "演示原料仓",
    departmentCode: "WAREHOUSE",
    managerUserId: warehouseUserId,
    warehouseType: "raw_material",
    address: "广东省深圳市龙华区演示工业园 A 栋 1 楼",
    description: "用于存放内存颗粒、待生产模块和入厂物料"
  });
  const semiFinishedWarehouseId = ensureWarehouse({
    code: "DEMO-WH-SF",
    name: "演示半成品仓",
    departmentCode: "WAREHOUSE",
    managerUserId: managerId,
    warehouseType: "semi_finished",
    address: "广东省深圳市龙华区演示工业园 A 栋 2 楼",
    description: "用于存放已完成阶段工序、等待后续生产的半成品"
  });
  const finishedWarehouseId = ensureWarehouse({
    code: "DEMO-WH-FG",
    name: "演示成品仓",
    departmentCode: "WAREHOUSE",
    managerUserId: managerId,
    warehouseType: "finished_goods",
    address: "广东省深圳市龙华区演示工业园 A 栋 2 楼",
    description: "用于存放已完成测试的内存条成品"
  });
  ensureWarehouse({
    code: "DEMO-WH-QC",
    name: "演示待检仓",
    departmentCode: "QUALITY",
    managerUserId: qualityUserId,
    warehouseType: "quarantine",
    address: "广东省深圳市龙华区演示工业园 B 栋 1 楼",
    description: "用于存放待检、隔离和待放行物料"
  });

  const bgaProcessId = ensureProductionProcess({
    code: "PROC-BGA",
    name: "芯片拆卸植球",
    processType: "manufacturing",
    sortOrder: 10,
    description: "对芯片进行拆卸、植球等前处理"
  });
  const chipInitialTestProcessId = ensureProductionProcess({
    code: "PROC-CHIP-TEST",
    name: "芯片初测",
    processType: "testing",
    sortOrder: 20,
    description: "植球后测试芯片基础功能，判定可否进入委外加工"
  });
  const outsourceProcessId = ensureProductionProcess({
    code: "PROC-OUTSOURCE",
    name: "委外加工",
    processType: "outsourcing",
    sortOrder: 30,
    description: "记录委外加工流转节点"
  });
  const chipRetestProcessId = ensureProductionProcess({
    code: "PROC-CHIP-RETEST",
    name: "委外回厂复测",
    processType: "testing",
    sortOrder: 40,
    description: "委外加工回厂后进行芯片复测，合格后进入半成品仓等待贴片"
  });
  const smtProcessId = ensureProductionProcess({
    code: "PROC-SMT",
    name: "SMT贴片",
    processType: "manufacturing",
    sortOrder: 50,
    description: "将颗粒、PCB 和辅料进行贴装"
  });
  const agingProcessId = ensureProductionProcess({
    code: "PROC-AGING",
    name: "成品测试老化",
    processType: "testing",
    sortOrder: 60,
    description: "执行成品功能测试和老化验证"
  });
  ensureProductionProcess({
    code: "PROC-REPAIR",
    name: "不良品维修",
    processType: "repair",
    sortOrder: 70,
    description: "处理测试或生产中产生的不良品"
  });
  const fqcProcessId = ensureProductionProcess({
    code: "PROC-FQC",
    name: "日检合格成品入库",
    processType: "inspection",
    sortOrder: 80,
    description: "日检合格后申请成品入库"
  });
  ensureProcessRoleAuthorization(bgaProcessId, [processRoleCode("PROC-BGA", "manager"), processRoleCode("PROC-BGA", "operator")]);
  ensureProcessRoleAuthorization(chipInitialTestProcessId, [processRoleCode("PROC-CHIP-TEST", "manager"), processRoleCode("PROC-CHIP-TEST", "operator")]);
  ensureProcessRoleAuthorization(outsourceProcessId, [processRoleCode("PROC-OUTSOURCE", "manager"), processRoleCode("PROC-OUTSOURCE", "operator")]);
  ensureProcessRoleAuthorization(chipRetestProcessId, [processRoleCode("PROC-CHIP-RETEST", "manager"), processRoleCode("PROC-CHIP-RETEST", "operator")]);
  ensureProcessRoleAuthorization(smtProcessId, [processRoleCode("PROC-SMT", "manager"), processRoleCode("PROC-SMT", "operator")]);
  ensureProcessRoleAuthorization(agingProcessId, [processRoleCode("PROC-AGING", "manager"), processRoleCode("PROC-AGING", "operator")]);
  ensureProcessRoleAuthorization(fqcProcessId, [processRoleCode("PROC-FQC", "manager"), processRoleCode("PROC-FQC", "operator")]);

  const routeId = ensureProductionRoute({
    code: "ROUTE-MEMORY-STANDARD",
    name: "内存条标准生产路线",
    productItemId: ddr4ItemId,
    description: "芯片拆卸植球、初测、委外、回厂复测、贴片、老化和日检入库的完整演示路线",
    steps: [
      { processId: bgaProcessId, defaultDepartmentId: productionDepartmentId, outputTarget: "next_process", description: "前处理完成后送芯片初测" },
      { processId: chipInitialTestProcessId, defaultDepartmentId: qualityDepartmentId, outputTarget: "next_process", qualityGate: true, description: "芯片初测合格后送委外加工" },
      { processId: outsourceProcessId, defaultDepartmentId: productionDepartmentId, outputTarget: "next_process", description: "委外加工完成后回厂复测" },
      { processId: chipRetestProcessId, defaultDepartmentId: qualityDepartmentId, outputTarget: "semi_finished", outputItemId: ddr4ItemId, outputWarehouseId: semiFinishedWarehouseId, qualityGate: true, description: "回厂复测合格后进入半成品仓，等待 SMT 贴片" },
      { processId: smtProcessId, defaultDepartmentId: productionDepartmentId, outputTarget: "next_process", description: "贴片完成后进入成品测试老化" },
      { processId: agingProcessId, defaultDepartmentId: qualityDepartmentId, outputTarget: "next_process", qualityGate: true, description: "老化不良自动进入维修，合格进入日检" },
      { processId: fqcProcessId, defaultDepartmentId: qualityDepartmentId, outputTarget: "finished_goods", outputItemId: ddr4ItemId, outputWarehouseId: finishedWarehouseId, qualityGate: true, description: "日检合格后生成成品入库草稿" }
    ]
  });
  const routeSteps = db
    .prepare(
      `SELECT id, process_id AS processId, step_no AS stepNo,
              default_department_id AS defaultDepartmentId, output_target AS outputTarget,
              output_item_id AS outputItemId, output_warehouse_id AS outputWarehouseId,
              quality_gate AS qualityGate
       FROM production_route_steps
       WHERE route_id = ?
       ORDER BY step_no`
    )
    .all(routeId) as Array<{
      id: number;
      processId: number;
      stepNo: number;
      defaultDepartmentId: number;
      outputTarget: DemoOutputTarget;
      outputItemId: number | null;
      outputWarehouseId: number | null;
      qualityGate: number;
    }>;

  ensureProductionWorkOrder({
    workOrderNo: "DEMO-MO-001",
    productItemId: ddr4ItemId,
    routeId,
    departmentId: productionDepartmentId,
    managerUserId: productionUserId,
    plannedQuantity: 50,
    createdBy: productionUserId,
    tasks: routeSteps.map((step) => {
      const base = {
        taskNo: `DEMO-MO-001-${String(step.stepNo).padStart(2, "0")}`,
        routeStepId: step.id,
        processId: step.processId,
        sequenceNo: step.stepNo,
        assignedDepartmentId: step.defaultDepartmentId,
        assignedUserId: [1, 3, 5].includes(step.stepNo) ? operatorId : qualityUserId,
        outputTarget: step.outputTarget,
        outputItemId: step.outputItemId,
        outputWarehouseId: step.outputWarehouseId,
        qualityGate: Boolean(step.qualityGate)
      };
      if (step.stepNo === 1) {
        return {
          ...base,
          status: "completed" as DemoTaskStatus,
          inputQuantity: 50,
          goodQuantity: 50,
          outputQuantity: 50,
          defectQuantity: 0,
          report: {
            reportNo: "DEMO-REP-001",
            operatorUserId: operatorId,
            inputQuantity: 50,
            goodQuantity: 50,
            defectQuantity: 0,
            remark: "芯片拆卸植球演示报工"
          }
        };
      }
      if (step.stepNo === 2) {
        return {
          ...base,
          status: "abnormal" as DemoTaskStatus,
          inputQuantity: 50,
          goodQuantity: 48,
          outputQuantity: 48,
          defectQuantity: 2,
          report: {
            reportNo: "DEMO-REP-002",
            operatorUserId: qualityUserId,
            inputQuantity: 50,
            goodQuantity: 48,
            defectQuantity: 2,
            remark: "芯片初测发现 2 条不良，进入维修池"
          }
        };
      }
      if (step.stepNo === 3) {
        return { ...base, status: "ready" as DemoTaskStatus, plannedQuantity: 48 };
      }
      return { ...base, status: "pending" as DemoTaskStatus, plannedQuantity: 0 };
    })
  });
}

function ensureDocument(spec: DemoDocument) {
  const existing = db.prepare("SELECT id FROM stock_documents WHERE document_no = ?").get(spec.documentNo) as
    | IdRow
    | undefined;
  if (existing) return existing.id;

  const documentId = Number(
    db
      .prepare(
        `INSERT INTO stock_documents
         (document_no, document_type, status, business_date, department_id, warehouse_id,
          source_warehouse_id, target_warehouse_id, supplier_name, purchase_order_no,
          reference_no, reason, remark, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        spec.documentNo,
        spec.documentType,
        spec.status,
        spec.businessDate,
        spec.departmentId,
        spec.warehouseId ?? null,
        spec.sourceWarehouseId ?? null,
        spec.targetWarehouseId ?? null,
        spec.supplierName ?? "",
        spec.purchaseOrderNo ?? "",
        spec.referenceNo ?? "",
        spec.reason ?? "",
        spec.remark ?? "",
        spec.createdBy
      ).lastInsertRowid
  );

  const insertLine = db.prepare(
    `INSERT INTO stock_document_lines
     (document_id, line_no, item_id, quantity, lot_no, serial_no, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const lineIds = spec.lines.map((line, index) =>
    Number(
      insertLine.run(
        documentId,
        index + 1,
        line.itemId,
        line.quantity,
        line.lotNo ?? "",
        line.serialNo ?? "",
        line.remark ?? ""
      ).lastInsertRowid
    )
  );

  if (spec.submittedBy) {
    db.prepare(
      "UPDATE stock_documents SET submitted_by = ?, submitted_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(spec.submittedBy, documentId);
  }
  if (spec.approvedBy) {
    db.prepare(
      "UPDATE stock_documents SET approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(spec.approvedBy, documentId);
  }
  if (spec.postedBy) {
    db.prepare(
      "UPDATE stock_documents SET posted_by = ?, posted_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(spec.postedBy, documentId);
  }

  if (spec.status === "posted") {
    const insertLedger = db.prepare(
      `INSERT INTO stock_ledger_entries
       (document_id, line_id, item_id, warehouse_id, quantity_delta, lot_no, serial_no)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    spec.lines.forEach((line, index) => {
      const lotNo = line.lotNo ?? "";
      const serialNo = line.serialNo ?? "";
      if (spec.documentType === "transfer") {
        insertLedger.run(documentId, lineIds[index], line.itemId, spec.sourceWarehouseId, -line.quantity, lotNo, serialNo);
        insertLedger.run(documentId, lineIds[index], line.itemId, spec.targetWarehouseId, line.quantity, lotNo, serialNo);
        return;
      }
      if (spec.documentType === "count") return;
      const quantityDelta = spec.documentType === "receipt" ? line.quantity : -line.quantity;
      insertLedger.run(documentId, lineIds[index], line.itemId, spec.warehouseId, quantityDelta, lotNo, serialNo);
    });
  }

  return documentId;
}

export function seedDemoData() {
  const alreadySeeded = db.prepare("SELECT id FROM users WHERE username = ?").get(DEMO_SENTINEL_USERNAME);
  if (alreadySeeded) {
    db.prepare(
      `UPDATE users
       SET must_change_password = 1, token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE username IN ('demo.manager', 'demo.warehouse', 'demo.quality', 'demo.production', 'demo.operator')`
    ).run();
    ensureProductionDemoData();
    return false;
  }

  const seed = db.transaction(() => {
    const managerId = ensureUser({
      username: "demo.manager",
      password: "demo123",
      displayName: "演示工序主管",
      employeeNo: "DEMO-0001",
      position: "仓储与生产经理",
      departmentCode: "WAREHOUSE",
      roleCode: processRoleCode("PROC-BGA", "manager"),
      managedDepartmentCodes: ["PRODUCTION", "QUALITY"]
    });
    const warehouseUserId = ensureUser({
      username: DEMO_SENTINEL_USERNAME,
      password: "demo123",
      displayName: "演示仓库员",
      employeeNo: "DEMO-0002",
      position: "仓库管理员",
      departmentCode: "WAREHOUSE",
      roleCode: processRoleCode("PROC-BGA", "operator")
    });
    const qualityUserId = ensureUser({
      username: "demo.quality",
      password: "demo123",
      displayName: "演示质检员",
      employeeNo: "DEMO-0003",
      position: "来料检验员",
      departmentCode: "QUALITY",
      roleCode: processRoleCode("PROC-CHIP-TEST", "operator")
    });
    ensureUser({
      username: "demo.production",
      password: "demo123",
      displayName: "演示生产主管",
      employeeNo: "DEMO-0004",
      position: "生产主管",
      departmentCode: "PRODUCTION",
      roleCode: processRoleCode("PROC-SMT", "manager")
    });
    ensureUser({
      username: "demo.operator",
      password: "demo123",
      displayName: "演示工序操作员",
      employeeNo: "DEMO-0005",
      position: "装配工序员",
      departmentCode: "PRODUCTION",
      roleCode: processRoleCode("PROC-SMT", "operator")
    });

    const memoryCategoryId = ensureCategory("DEMO-MEMORY", "内存条", null, "内存条成品和模块");
    const ddr4CategoryId = ensureCategory("DEMO-DDR4", "DDR4 内存条", memoryCategoryId, "DDR4 代际内存模块");
    const ddr5CategoryId = ensureCategory("DEMO-DDR5", "DDR5 内存条", memoryCategoryId, "DDR5 代际内存模块");
    const chipCategoryId = ensureCategory("DEMO-CHIP", "内存颗粒", null, "内存条生产所需颗粒");

    const stripUnitId = requireId("units", "STRIP");
    const pieceUnitId = requireId("units", "PCS");
    const ddr4ItemId = ensureItem({
      itemCode: "DEMO-DDR4-8G-3200",
      name: "演示 DDR4 8GB 3200 内存条",
      categoryId: ddr4CategoryId,
      unitId: stripUnitId,
      barcode: "DEMO69000001",
      trackingMode: "lot",
      description: "用于验证批次管理、入库、出库、调拨和盘点流程"
    });
    const ddr5ItemId = ensureItem({
      itemCode: "DEMO-DDR5-16G-5600",
      name: "演示 DDR5 16GB 5600 内存条",
      categoryId: ddr5CategoryId,
      unitId: stripUnitId,
      barcode: "DEMO69000002",
      trackingMode: "serial",
      description: "用于验证序列号管理和逐条库存追溯"
    });
    const chipItemId = ensureItem({
      itemCode: "DEMO-CHIP-8G",
      name: "演示 8Gb DDR4 内存颗粒",
      categoryId: chipCategoryId,
      unitId: pieceUnitId,
      barcode: "DEMO69000003",
      trackingMode: "none",
      description: "用于验证普通数量库存"
    });

    for (const [itemId, values] of [
      [
        ddr4ItemId,
        {
          CAPACITY: "8GB",
          FREQUENCY: "3200MHz",
          GENERATION: "DDR4",
          CHIP_SPEC: "8Gb x 8",
          ECC: "不支持",
          FORM_FACTOR: "UDIMM",
          VOLTAGE: "1.2V",
          RANK: "1Rx8"
        }
      ],
      [
        ddr5ItemId,
        {
          CAPACITY: "16GB",
          FREQUENCY: "5600MHz",
          GENERATION: "DDR5",
          CHIP_SPEC: "16Gb x 8",
          ECC: "支持",
          FORM_FACTOR: "UDIMM",
          VOLTAGE: "1.1V",
          RANK: "1Rx8"
        }
      ],
      [
        chipItemId,
        {
          CAPACITY: "8Gb",
          FREQUENCY: "3200MHz",
          GENERATION: "DDR4",
          CHIP_SPEC: "8Gb",
          ECC: "不支持",
          FORM_FACTOR: "FBGA",
          VOLTAGE: "1.2V",
          RANK: "单颗粒"
        }
      ]
    ] as Array<[number, Record<string, string>]>) {
      for (const [attributeCode, value] of Object.entries(values)) {
        setAttributeValue(itemId, attributeCode, value);
      }
    }

    const rawWarehouseId = ensureWarehouse({
      code: "DEMO-WH-RAW",
      name: "演示原料仓",
      departmentCode: "WAREHOUSE",
      managerUserId: warehouseUserId,
      warehouseType: "raw_material",
      address: "广东省深圳市龙华区演示工业园 A 栋 1 楼",
      description: "用于存放内存颗粒、待生产模块和入厂物料"
    });
    const semiFinishedWarehouseId = ensureWarehouse({
      code: "DEMO-WH-SF",
      name: "演示半成品仓",
      departmentCode: "WAREHOUSE",
      managerUserId: managerId,
      warehouseType: "semi_finished",
      address: "广东省深圳市龙华区演示工业园 A 栋 2 楼",
      description: "用于存放已完成阶段工序、等待后续生产的半成品"
    });
    const finishedWarehouseId = ensureWarehouse({
      code: "DEMO-WH-FG",
      name: "演示成品仓",
      departmentCode: "WAREHOUSE",
      managerUserId: managerId,
      warehouseType: "finished_goods",
      address: "广东省深圳市龙华区演示工业园 A 栋 2 楼",
      description: "用于存放已完成测试的内存条成品"
    });
    const qualityWarehouseId = ensureWarehouse({
      code: "DEMO-WH-QC",
      name: "演示待检仓",
      departmentCode: "QUALITY",
      managerUserId: qualityUserId,
      warehouseType: "quarantine",
      address: "广东省深圳市龙华区演示工业园 B 栋 1 楼",
      description: "用于存放待检、隔离和待放行物料"
    });

    const warehouseDepartmentId = requireId("departments", "WAREHOUSE");
    const seedDate = new Date().toISOString().slice(0, 10);
    const ddr4Lot = "DEMO-DDR4-LOT-001";

    ensureDocument({
      documentNo: `DEMO-IN-${seedDate.replaceAll("-", "")}-001`,
      documentType: "receipt",
      status: "posted",
      businessDate: seedDate,
      departmentId: warehouseDepartmentId,
      warehouseId: rawWarehouseId,
      supplierName: "演示供应商 A",
      purchaseOrderNo: "DEMO-PO-0001",
      reason: "演示期初正常入库",
      remark: "用于验证入库审批和库存增加",
      createdBy: warehouseUserId,
      submittedBy: warehouseUserId,
      approvedBy: managerId,
      postedBy: managerId,
      lines: [{ itemId: ddr4ItemId, quantity: 100, lotNo: ddr4Lot }]
    });

    ensureDocument({
      documentNo: `DEMO-IN-${seedDate.replaceAll("-", "")}-002`,
      documentType: "receipt",
      status: "posted",
      businessDate: seedDate,
      departmentId: warehouseDepartmentId,
      warehouseId: finishedWarehouseId,
      supplierName: "演示供应商 B",
      purchaseOrderNo: "DEMO-PO-0002",
      reason: "演示成品入库",
      remark: "用于验证序列号库存",
      createdBy: managerId,
      submittedBy: managerId,
      approvedBy: managerId,
      postedBy: managerId,
      lines: [
        { itemId: ddr5ItemId, quantity: 1, serialNo: "DEMO-DDR5-SN-0001" },
        { itemId: ddr5ItemId, quantity: 1, serialNo: "DEMO-DDR5-SN-0002" },
        { itemId: ddr5ItemId, quantity: 1, serialNo: "DEMO-DDR5-SN-0003" }
      ]
    });

    ensureDocument({
      documentNo: `DEMO-OUT-${seedDate.replaceAll("-", "")}-001`,
      documentType: "issue",
      status: "posted",
      businessDate: seedDate,
      departmentId: warehouseDepartmentId,
      warehouseId: rawWarehouseId,
      referenceNo: "DEMO-WO-0001",
      reason: "演示生产领料",
      remark: "已完成过账的出库单",
      createdBy: warehouseUserId,
      submittedBy: warehouseUserId,
      approvedBy: managerId,
      postedBy: managerId,
      lines: [{ itemId: ddr4ItemId, quantity: 20, lotNo: ddr4Lot }]
    });

    ensureDocument({
      documentNo: `DEMO-TRF-${seedDate.replaceAll("-", "")}-001`,
      documentType: "transfer",
      status: "posted",
      businessDate: seedDate,
      departmentId: warehouseDepartmentId,
      sourceWarehouseId: rawWarehouseId,
      targetWarehouseId: finishedWarehouseId,
      reason: "演示成品转仓",
      remark: "用于验证调出和调入两条库存流水",
      createdBy: warehouseUserId,
      submittedBy: warehouseUserId,
      approvedBy: managerId,
      postedBy: managerId,
      lines: [{ itemId: ddr4ItemId, quantity: 10, lotNo: ddr4Lot }]
    });

    ensureDocument({
      documentNo: `DEMO-IN-${seedDate.replaceAll("-", "")}-003`,
      documentType: "receipt",
      status: "submitted",
      businessDate: seedDate,
      departmentId: warehouseDepartmentId,
      warehouseId: rawWarehouseId,
      supplierName: "演示供应商 C",
      purchaseOrderNo: "DEMO-PO-0003",
      reason: "待审批入库",
      remark: "用于验证待审批状态",
      createdBy: warehouseUserId,
      submittedBy: warehouseUserId,
      lines: [{ itemId: ddr4ItemId, quantity: 5, lotNo: ddr4Lot }]
    });

    ensureDocument({
      documentNo: `DEMO-OUT-${seedDate.replaceAll("-", "")}-002`,
      documentType: "issue",
      status: "draft",
      businessDate: seedDate,
      departmentId: warehouseDepartmentId,
      warehouseId: rawWarehouseId,
      referenceNo: "DEMO-WO-0002",
      reason: "待提交生产领料",
      remark: "用于验证草稿编辑和提交",
      createdBy: warehouseUserId,
      lines: [{ itemId: ddr4ItemId, quantity: 2, lotNo: ddr4Lot }]
    });

    ensureDocument({
      documentNo: `DEMO-CNT-${seedDate.replaceAll("-", "")}-001`,
      documentType: "count",
      status: "approved",
      businessDate: seedDate,
      departmentId: warehouseDepartmentId,
      warehouseId: rawWarehouseId,
      reason: "演示盘点差异",
      remark: "当前账面 70，实盘填写 68，过账后生成 -2 差异",
      createdBy: managerId,
      submittedBy: managerId,
      approvedBy: managerId,
      lines: [{ itemId: ddr4ItemId, quantity: 68, lotNo: ddr4Lot }]
    });

    ensureDocument({
      documentNo: `DEMO-SCR-${seedDate.replaceAll("-", "")}-001`,
      documentType: "scrap",
      status: "posted",
      businessDate: seedDate,
      departmentId: warehouseDepartmentId,
      warehouseId: finishedWarehouseId,
      reason: "演示外观不良报废",
      remark: "已完成过账的报废单",
      createdBy: managerId,
      submittedBy: managerId,
      approvedBy: managerId,
      postedBy: managerId,
      lines: [{ itemId: ddr4ItemId, quantity: 2, lotNo: ddr4Lot }]
    });

    ensureDocument({
      documentNo: `DEMO-CNT-${seedDate.replaceAll("-", "")}-002`,
      documentType: "count",
      status: "posted",
      businessDate: seedDate,
      departmentId: warehouseDepartmentId,
      warehouseId: finishedWarehouseId,
      reason: "演示无差异盘点",
      remark: "盘点数量与账面一致，不产生差异流水",
      createdBy: managerId,
      submittedBy: managerId,
      approvedBy: managerId,
      postedBy: managerId,
      lines: [{ itemId: ddr4ItemId, quantity: 8, lotNo: ddr4Lot }]
    });

    ensureProductionDemoData();
  });

  seed();
  return true;
}
