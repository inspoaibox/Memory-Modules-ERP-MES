import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "node:path";
import fs from "node:fs";

export type WarehouseType = "raw_material" | "semi_finished" | "finished_goods" | "quarantine" | "scrap" | "general";

export const warehouseTypeLabels: Record<WarehouseType, string> = {
  raw_material: "原料仓",
  semi_finished: "半成品仓",
  finished_goods: "成品仓",
  quarantine: "待检/隔离仓",
  scrap: "不良/报废仓",
  general: "综合仓"
};

export const warehouseTypeValues = Object.keys(warehouseTypeLabels) as WarehouseType[];

export type PermissionRow = {
  id: number;
  code: string;
  module: string;
  action: string;
  label: string;
};

export const permissionCatalog = [
  ["system.dashboard.view", "系统", "查看", "查看管理驾驶舱"],
  ["system.users.view", "系统", "查看", "查看员工账号"],
  ["system.users.manage", "系统", "管理", "新增、编辑、停用员工账号"],
  ["system.roles.view", "系统", "查看", "查看角色与权限"],
  ["system.roles.manage", "系统", "管理", "创建角色、分配权限"],
  ["system.departments.view", "工序", "查看", "查看工序流程与岗位"],
  ["system.departments.manage", "工序", "管理", "新增、编辑工序流程"],
  ["system.audit.view", "系统", "查看", "查看操作审计日志"],
  ["production.dashboard.view", "生产", "查看", "查看生产工作台"],
  ["production.processes.view", "生产", "查看", "查看工序定义"],
  ["production.processes.manage", "生产", "管理", "维护工序定义"],
  ["production.routes.view", "生产", "查看", "查看工艺路线"],
  ["production.routes.manage", "生产", "管理", "维护工艺路线"],
  ["production.workorders.view", "生产", "查看", "查看生产工单"],
  ["production.workorders.manage", "生产", "管理", "创建、下达、取消和关闭工单"],
  ["production.workorders.control", "生产", "控制", "暂停、继续、停止和终止工单"],
  ["production.workorders.delete", "生产", "删除", "删除未下达且没有业务记录的草稿工单"],
  ["production.tasks.view", "生产", "查看", "查看工序任务"],
  ["production.tasks.manage", "生产", "管理", "派工和调整工序任务"],
  ["production.reports.view", "生产", "查看", "查看工序报工记录"],
  ["production.operations.execute", "生产", "执行", "执行工序报工"],
  ["production.repairs.view", "生产", "查看", "查看不良维修记录"],
  ["production.repairs.manage", "生产", "管理", "处理不良维修记录"],
  ["production.scrap-products.view", "生产", "查看", "查看报废产品记录"],
  ["warehouse.inventory.view", "仓库", "查看", "查看库存与库位"],
  ["warehouse.inventory.manage", "仓库", "管理", "执行收发料与库存调整"],
  ["quality.inspection.view", "质量", "查看", "查看检验与不良"],
  ["quality.inspection.manage", "质量", "管理", "执行检验、隔离和放行"],
  ["report.view", "报表", "查看", "查看经营与生产报表"],
  ["inventory.dashboard.view", "库存", "查看", "查看库存工作台"],
  ["inventory.categories.view", "库存", "查看", "查看商品分类"],
  ["inventory.categories.manage", "库存", "管理", "维护商品分类"],
  ["inventory.units.view", "库存", "查看", "查看计量单位"],
  ["inventory.units.manage", "库存", "管理", "维护计量单位"],
  ["inventory.attributes.view", "库存", "查看", "查看商品参数定义"],
  ["inventory.attributes.manage", "库存", "管理", "维护商品参数定义"],
  ["inventory.items.view", "库存", "查看", "查看商品资料"],
  ["inventory.items.manage", "库存", "管理", "维护商品资料"],
  ["inventory.warehouses.view", "库存", "查看", "查看仓库"],
  ["inventory.warehouses.manage", "库存", "管理", "维护仓库"],
  ["inventory.documents.view", "库存", "查看", "查看库存单据"],
  ["inventory.receipts.create", "库存", "操作", "创建和提交入库单"],
  ["inventory.receipts.approve", "库存", "审批", "审批入库单"],
  ["inventory.receipts.post", "库存", "过账", "过账入库单"],
  ["inventory.issues.create", "库存", "操作", "创建和提交出库单"],
  ["inventory.issues.approve", "库存", "审批", "审批出库单"],
  ["inventory.issues.post", "库存", "过账", "过账出库单"],
  ["inventory.transfers.create", "库存", "操作", "创建和提交调拨单"],
  ["inventory.transfers.approve", "库存", "审批", "审批调拨单"],
  ["inventory.transfers.post", "库存", "过账", "过账调拨单"],
  ["inventory.counts.create", "库存", "操作", "创建和提交盘点单"],
  ["inventory.counts.approve", "库存", "审批", "审批盘点单"],
  ["inventory.counts.post", "库存", "过账", "过账盘点单"],
  ["inventory.scrap.create", "库存", "操作", "创建和提交报废单"],
  ["inventory.scrap.approve", "库存", "审批", "审批报废单"],
  ["inventory.scrap.post", "库存", "过账", "过账报废单"],
  ["inventory.balance.view", "库存", "查看", "查看库存余额"],
  ["inventory.ledger.view", "库存", "查看", "查看库存台账"]
] as const;

/** Role permissions must include the page-access permissions their actions depend on. */
export const permissionDependencies: Record<string, string[]> = {
  "system.users.manage": ["system.users.view", "system.departments.view", "system.roles.view"],
  "system.roles.manage": ["system.roles.view"],
  "system.departments.manage": ["system.departments.view"],
  "production.processes.manage": ["production.processes.view"],
  "production.routes.manage": ["production.routes.view", "production.processes.view", "inventory.items.view", "system.departments.view"],
  "production.workorders.control": ["production.workorders.view"],
  "production.workorders.delete": ["production.workorders.view"],
  "production.tasks.manage": ["production.tasks.view"],
  "production.operations.execute": ["production.tasks.view"],
  "production.reports.view": ["production.tasks.view"],
  "production.repairs.view": ["production.tasks.view"],
  "production.repairs.manage": ["production.repairs.view"],
  "production.scrap-products.view": ["production.repairs.view"],
  "quality.inspection.view": ["production.tasks.view"],
  "quality.inspection.manage": ["quality.inspection.view", "production.tasks.view"],
  "inventory.categories.manage": ["inventory.categories.view"],
  "inventory.units.manage": ["inventory.units.view"],
  "inventory.attributes.manage": ["inventory.attributes.view"],
  "inventory.items.manage": ["inventory.items.view"],
  "inventory.warehouses.manage": ["inventory.warehouses.view", "system.departments.view"],
  "production.workorders.manage": ["production.workorders.view", "production.routes.view", "production.tasks.view", "inventory.items.view", "system.departments.view"],
  "inventory.receipts.create": ["inventory.documents.view", "inventory.items.view", "inventory.warehouses.view"],
  "inventory.receipts.approve": ["inventory.documents.view"],
  "inventory.receipts.post": ["inventory.documents.view"],
  "inventory.issues.create": ["inventory.documents.view", "inventory.items.view", "inventory.warehouses.view"],
  "inventory.issues.approve": ["inventory.documents.view"],
  "inventory.issues.post": ["inventory.documents.view"],
  "inventory.transfers.create": ["inventory.documents.view", "inventory.items.view", "inventory.warehouses.view"],
  "inventory.transfers.approve": ["inventory.documents.view"],
  "inventory.transfers.post": ["inventory.documents.view"],
  "inventory.counts.create": ["inventory.documents.view", "inventory.items.view", "inventory.warehouses.view"],
  "inventory.counts.approve": ["inventory.documents.view"],
  "inventory.counts.post": ["inventory.documents.view"],
  "inventory.scrap.create": ["inventory.documents.view", "inventory.items.view", "inventory.warehouses.view"],
  "inventory.scrap.approve": ["inventory.documents.view"],
  "inventory.scrap.post": ["inventory.documents.view"]
};

type BuiltinProductionProcess = {
  code: string;
  name: string;
  processType: "manufacturing" | "testing" | "outsourcing" | "repair" | "warehouse" | "inspection";
  sortOrder: number;
  description: string;
};

const builtinProductionProcesses: BuiltinProductionProcess[] = [
  {
    code: "PROC-BGA",
    name: "芯片拆卸植球",
    processType: "manufacturing",
    sortOrder: 10,
    description: "对芯片进行拆卸、植球等前处理"
  },
  {
    code: "PROC-DISASSEMBLY",
    name: "生产拆解",
    processType: "manufacturing",
    sortOrder: 15,
    description: "按生产工单执行成品、半成品或物料的拆解作业"
  },
  {
    code: "PROC-ASSEMBLY",
    name: "生产组装",
    processType: "manufacturing",
    sortOrder: 16,
    description: "按生产工单执行半成品、原材料或组件的组装作业"
  },
  {
    code: "PROC-CHIP-TEST",
    name: "芯片初测",
    processType: "testing",
    sortOrder: 20,
    description: "植球后测试芯片基础功能，判定可否进入委外加工"
  },
  {
    code: "PROC-OUTSOURCE",
    name: "委外加工",
    processType: "outsourcing",
    sortOrder: 30,
    description: "记录委外加工流转节点"
  },
  {
    code: "PROC-CHIP-RETEST",
    name: "委外回厂复测",
    processType: "testing",
    sortOrder: 40,
    description: "委外加工回厂后进行芯片复测，合格后进入半成品仓等待贴片"
  },
  {
    code: "PROC-SMT",
    name: "SMT贴片",
    processType: "manufacturing",
    sortOrder: 50,
    description: "将颗粒、PCB 和辅料进行贴装"
  },
  {
    code: "PROC-AGING",
    name: "成品测试老化",
    processType: "testing",
    sortOrder: 60,
    description: "执行成品功能测试和老化验证"
  },
  {
    code: "PROC-REPAIR",
    name: "不良品维修",
    processType: "repair",
    sortOrder: 70,
    description: "处理测试或生产中产生的不良品"
  },
  {
    code: "PROC-FQC",
    name: "日检合格成品入库",
    processType: "inspection",
    sortOrder: 80,
    description: "日检合格后申请成品入库"
  }
];

type ProcessRoleKind = "manager" | "operator";

export function getProcessRoleCode(processCode: string, kind: ProcessRoleKind) {
  return `${processCode}-${kind === "manager" ? "MANAGER" : "OPERATOR"}`;
}

export function getProcessRoleName(processName: string, kind: ProcessRoleKind) {
  return `${processName}${kind === "manager" ? "主管" : "员工"}`;
}

export function getProcessRoleDescription(processName: string, kind: ProcessRoleKind) {
  return `${processName}对应的${kind === "manager" ? "主管" : "员工"}角色`;
}

function getProcessRolePermissionCodes(processType: BuiltinProductionProcess["processType"], kind: ProcessRoleKind) {
  const codes = [
    "production.tasks.view",
    "production.operations.execute",
    "production.reports.view"
  ];
  if (kind === "manager") {
    codes.push("production.routes.view");
    codes.push("production.workorders.view");
    codes.push("production.workorders.manage");
    codes.push("production.tasks.manage");
    codes.push("inventory.items.view");
    codes.push("system.departments.view");
  }
  if (processType === "testing" || processType === "inspection") {
    codes.push("quality.inspection.view");
    if (kind === "manager") codes.push("quality.inspection.manage");
  }
  if (processType === "repair") {
    codes.push("production.repairs.view");
    if (kind === "manager") {
      codes.push("production.repairs.manage");
      codes.push("production.scrap-products.view");
    }
  }
  return [...new Set(codes)];
}

export function syncProcessRoleTemplates() {
  const permissionRows = db
    .prepare("SELECT id, code FROM permissions")
    .all() as Array<{ id: number; code: string }>;
  const permissionIdByCode = new Map(permissionRows.map((item) => [item.code, item.id]));
  const processRows = db
    .prepare("SELECT id, code, name, process_type AS processType FROM production_processes WHERE status = 'active' ORDER BY sort_order, id")
    .all() as Array<{ id: number; code: string; name: string; processType: BuiltinProductionProcess["processType"] }>;

  const desiredRoleCodes = new Set<string>();
  for (const process of processRows) {
    desiredRoleCodes.add(getProcessRoleCode(process.code, "manager"));
    desiredRoleCodes.add(getProcessRoleCode(process.code, "operator"));
  }
  const desiredCodes = [...desiredRoleCodes];
  if (desiredCodes.length) {
    const placeholders = desiredCodes.map(() => "?").join(", ");
    db.prepare(`DELETE FROM roles WHERE code LIKE 'PROC-%' AND code NOT IN (${placeholders})`).run(...desiredCodes);
  } else {
    db.prepare("DELETE FROM roles WHERE code LIKE 'PROC-%'").run();
  }

  const insertRole = db.prepare("INSERT OR IGNORE INTO roles (name, code, description) VALUES (?, ?, ?)");
  const updateRole = db.prepare(
    "UPDATE roles SET name = ?, description = ?, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE code = ?"
  );
  const deleteRolePermissions = db.prepare("DELETE FROM role_permissions WHERE role_id = ?");
  const insertRolePermission = db.prepare(
    "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)"
  );
  const insertAuthorization = db.prepare(
    "INSERT OR IGNORE INTO production_process_role_authorizations (process_id, role_id) VALUES (?, ?)"
  );

  for (const process of processRows) {
    for (const kind of ["manager", "operator"] as const) {
      const code = getProcessRoleCode(process.code, kind);
      const name = getProcessRoleName(process.name, kind);
      const description = getProcessRoleDescription(process.name, kind);
      insertRole.run(name, code, description);
      updateRole.run(name, description, code);
      const role = db.prepare("SELECT id FROM roles WHERE code = ?").get(code) as { id: number } | undefined;
      if (!role) continue;
      deleteRolePermissions.run(role.id);
      for (const permissionCode of getProcessRolePermissionCodes(process.processType, kind)) {
        const permissionId = permissionIdByCode.get(permissionCode);
        if (permissionId) insertRolePermission.run(role.id, permissionId);
      }
      insertAuthorization.run(process.id, role.id);
    }
  }
}

const databaseDirectory = path.resolve(process.cwd(), "data");
fs.mkdirSync(databaseDirectory, { recursive: true });

export const db = new Database(path.join(databaseDirectory, "erp-mes.db"));
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      employee_no TEXT NOT NULL UNIQUE,
      position TEXT NOT NULL DEFAULT '',
      process_id INTEGER REFERENCES production_processes(id) ON DELETE SET NULL,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      token_version INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      module TEXT NOT NULL,
      action TEXT NOT NULL,
      label TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      resource_id TEXT,
      detail TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS system_bootstrap_flags (
      flag_key TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS department_managers (
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (department_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      precision INTEGER NOT NULL DEFAULT 0 CHECK (precision BETWEEN 0 AND 6),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS item_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER REFERENCES item_categories(id) ON DELETE SET NULL,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS item_attribute_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      value_type TEXT NOT NULL DEFAULT 'text' CHECK (value_type IN ('text', 'number', 'select')),
      options_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category_id INTEGER REFERENCES item_categories(id) ON DELETE SET NULL,
      unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
      purchase_price REAL NOT NULL DEFAULT 0,
      sales_price REAL NOT NULL DEFAULT 0,
      barcode TEXT UNIQUE,
      tracking_mode TEXT NOT NULL DEFAULT 'none' CHECK (tracking_mode IN ('none', 'lot', 'serial')),
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS item_attribute_values (
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      attribute_id INTEGER NOT NULL REFERENCES item_attribute_definitions(id) ON DELETE CASCADE,
      value TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (item_id, attribute_id)
    );

    CREATE TABLE IF NOT EXISTS warehouses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
      manager_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      warehouse_type TEXT NOT NULL DEFAULT 'general' CHECK (warehouse_type IN ('raw_material', 'semi_finished', 'finished_goods', 'quarantine', 'scrap', 'general')),
      address TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_no TEXT NOT NULL UNIQUE,
      document_type TEXT NOT NULL CHECK (document_type IN ('receipt', 'issue', 'transfer', 'count', 'scrap')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'posted', 'cancelled')),
      business_date TEXT NOT NULL,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
      warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE RESTRICT,
      source_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE RESTRICT,
      target_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE RESTRICT,
      supplier_name TEXT NOT NULL DEFAULT '',
      purchase_order_no TEXT NOT NULL DEFAULT '',
      reference_no TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      posted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      submitted_at TEXT,
      approved_at TEXT,
      posted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_document_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES stock_documents(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      quantity REAL NOT NULL CHECK (quantity >= 0),
      lot_no TEXT NOT NULL DEFAULT '',
      serial_no TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      UNIQUE (document_id, line_no)
    );

    CREATE TABLE IF NOT EXISTS stock_ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES stock_documents(id) ON DELETE RESTRICT,
      line_id INTEGER NOT NULL REFERENCES stock_document_lines(id) ON DELETE RESTRICT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      quantity_delta REAL NOT NULL,
      lot_no TEXT NOT NULL DEFAULT '',
      serial_no TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_processes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      process_type TEXT NOT NULL DEFAULT 'manufacturing' CHECK (process_type IN ('manufacturing', 'testing', 'outsourcing', 'repair', 'warehouse', 'inspection')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      product_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_route_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL REFERENCES production_routes(id) ON DELETE CASCADE,
      process_id INTEGER NOT NULL REFERENCES production_processes(id) ON DELETE RESTRICT,
      step_no INTEGER NOT NULL,
      default_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      output_target TEXT NOT NULL DEFAULT 'next_process' CHECK (output_target IN ('next_process', 'semi_finished', 'finished_goods', 'repair')),
      output_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
      output_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
      quality_gate INTEGER NOT NULL DEFAULT 0 CHECK (quality_gate IN (0, 1)),
      description TEXT NOT NULL DEFAULT '',
      UNIQUE (route_id, step_no)
    );

    CREATE TABLE IF NOT EXISTS production_work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_no TEXT NOT NULL UNIQUE,
      product_item_id INTEGER REFERENCES items(id) ON DELETE RESTRICT,
      route_id INTEGER REFERENCES production_routes(id) ON DELETE RESTRICT,
      start_process_id INTEGER REFERENCES production_processes(id) ON DELETE RESTRICT,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
      manager_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      planned_quantity REAL NOT NULL DEFAULT 0 CHECK (planned_quantity >= 0),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'released', 'in_progress', 'completed', 'closed', 'cancelled')),
      execution_status TEXT NOT NULL DEFAULT 'normal' CHECK (execution_status IN ('normal', 'paused', 'terminated')),
      termination_type TEXT NOT NULL DEFAULT '' CHECK (termination_type IN ('', 'stop', 'terminate')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'urgent')),
      planned_start_date TEXT NOT NULL DEFAULT '',
      planned_end_date TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      released_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_work_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL REFERENCES production_work_orders(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      product_item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      route_id INTEGER NOT NULL REFERENCES production_routes(id) ON DELETE RESTRICT,
      planned_quantity REAL NOT NULL CHECK (planned_quantity > 0),
      good_quantity REAL NOT NULL DEFAULT 0 CHECK (good_quantity >= 0),
      defect_quantity REAL NOT NULL DEFAULT 0 CHECK (defect_quantity >= 0),
      scrap_quantity REAL NOT NULL DEFAULT 0 CHECK (scrap_quantity >= 0),
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (work_order_id, line_no),
      UNIQUE (work_order_id, product_item_id, route_id)
    );

    CREATE TABLE IF NOT EXISTS production_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_no TEXT NOT NULL UNIQUE,
      work_order_id INTEGER NOT NULL REFERENCES production_work_orders(id) ON DELETE CASCADE,
      work_order_item_id INTEGER REFERENCES production_work_order_items(id) ON DELETE CASCADE,
      route_step_id INTEGER REFERENCES production_route_steps(id) ON DELETE SET NULL,
      process_id INTEGER NOT NULL REFERENCES production_processes(id) ON DELETE RESTRICT,
      sequence_no INTEGER NOT NULL,
      assigned_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      output_target TEXT NOT NULL DEFAULT 'next_process',
      quality_gate INTEGER NOT NULL DEFAULT 0 CHECK (quality_gate IN (0, 1)),
      output_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
      output_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
      output_document_id INTEGER REFERENCES stock_documents(id) ON DELETE SET NULL,
      flow_status TEXT NOT NULL DEFAULT 'active' CHECK (flow_status IN ('active', 'awaiting_quality', 'awaiting_inventory')),
      planned_quantity REAL NOT NULL CHECK (planned_quantity >= 0),
      input_quantity REAL NOT NULL DEFAULT 0 CHECK (input_quantity >= 0),
      good_quantity REAL NOT NULL DEFAULT 0 CHECK (good_quantity >= 0),
      output_quantity REAL NOT NULL DEFAULT 0 CHECK (output_quantity >= 0),
      defect_quantity REAL NOT NULL DEFAULT 0 CHECK (defect_quantity >= 0),
      rework_quantity REAL NOT NULL DEFAULT 0 CHECK (rework_quantity >= 0),
      scrap_quantity REAL NOT NULL DEFAULT 0 CHECK (scrap_quantity >= 0),
      output_lot_no TEXT NOT NULL DEFAULT '',
      output_serial_no TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'in_progress', 'completed', 'abnormal', 'cancelled')),
      remark TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (work_order_item_id, sequence_no)
    );

    CREATE TABLE IF NOT EXISTS production_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_no TEXT NOT NULL UNIQUE,
      task_id INTEGER NOT NULL REFERENCES production_tasks(id) ON DELETE CASCADE,
      work_order_id INTEGER NOT NULL REFERENCES production_work_orders(id) ON DELETE CASCADE,
      process_id INTEGER NOT NULL REFERENCES production_processes(id) ON DELETE RESTRICT,
      operator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      report_date TEXT NOT NULL,
      input_quantity REAL NOT NULL CHECK (input_quantity >= 0),
      good_quantity REAL NOT NULL CHECK (good_quantity >= 0),
      defect_quantity REAL NOT NULL CHECK (defect_quantity >= 0),
      rework_quantity REAL NOT NULL DEFAULT 0 CHECK (rework_quantity >= 0),
      scrap_quantity REAL NOT NULL DEFAULT 0 CHECK (scrap_quantity >= 0),
      lot_no TEXT NOT NULL DEFAULT '',
      serial_no TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      operation_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_disassembly_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL UNIQUE REFERENCES production_reports(id) ON DELETE CASCADE,
      task_id INTEGER NOT NULL REFERENCES production_tasks(id) ON DELETE CASCADE,
      source_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      source_lot_no TEXT NOT NULL DEFAULT '',
      source_serial_no TEXT NOT NULL DEFAULT '',
      source_quantity REAL NOT NULL CHECK (source_quantity > 0),
      issue_document_id INTEGER NOT NULL UNIQUE REFERENCES stock_documents(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_disassembly_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      disassembly_report_id INTEGER NOT NULL REFERENCES production_disassembly_reports(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      quantity REAL NOT NULL CHECK (quantity > 0),
      destination_type TEXT NOT NULL CHECK (destination_type IN ('warehouse', 'process')),
      warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE RESTRICT,
      route_id INTEGER REFERENCES production_routes(id) ON DELETE RESTRICT,
      start_process_id INTEGER REFERENCES production_processes(id) ON DELETE RESTRICT,
      receipt_document_id INTEGER REFERENCES stock_documents(id) ON DELETE RESTRICT,
      child_work_order_id INTEGER REFERENCES production_work_orders(id) ON DELETE RESTRICT,
      lot_no TEXT NOT NULL DEFAULT '',
      serial_no TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (disassembly_report_id, line_no)
    );

    CREATE TABLE IF NOT EXISTS production_assembly_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL UNIQUE REFERENCES production_reports(id) ON DELETE CASCADE,
      task_id INTEGER NOT NULL REFERENCES production_tasks(id) ON DELETE CASCADE,
      output_quantity REAL NOT NULL CHECK (output_quantity > 0),
      output_document_id INTEGER REFERENCES stock_documents(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_assembly_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assembly_report_id INTEGER NOT NULL REFERENCES production_assembly_reports(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      source_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      unit_quantity REAL NOT NULL CHECK (unit_quantity > 0),
      quantity REAL NOT NULL CHECK (quantity > 0),
      lot_no TEXT NOT NULL DEFAULT '',
      serial_no TEXT NOT NULL DEFAULT '',
      issue_document_id INTEGER NOT NULL REFERENCES stock_documents(id) ON DELETE RESTRICT,
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (assembly_report_id, line_no)
    );

    CREATE TABLE IF NOT EXISTS production_repairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repair_no TEXT NOT NULL UNIQUE,
      work_order_id INTEGER REFERENCES production_work_orders(id) ON DELETE SET NULL,
      source_task_id INTEGER REFERENCES production_tasks(id) ON DELETE SET NULL,
      report_id INTEGER REFERENCES production_reports(id) ON DELETE SET NULL,
      item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      defect_code TEXT NOT NULL DEFAULT '',
      defect_description TEXT NOT NULL DEFAULT '',
      item_specification TEXT NOT NULL DEFAULT '',
      chip_model TEXT NOT NULL DEFAULT '',
      chip_name TEXT NOT NULL DEFAULT '',
      chip_spec TEXT NOT NULL DEFAULT '',
      source_lot_no TEXT NOT NULL DEFAULT '',
      source_serial_no TEXT NOT NULL DEFAULT '',
      repaired_good_quantity REAL NOT NULL DEFAULT 0 CHECK (repaired_good_quantity >= 0),
      repair_defect_quantity REAL NOT NULL DEFAULT 0 CHECK (repair_defect_quantity >= 0),
      scrapped_quantity REAL NOT NULL DEFAULT 0 CHECK (scrapped_quantity >= 0),
      scrap_reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'repairing', 'retested', 'returned', 'scrapped', 'closed')),
      repair_action TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_repair_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repair_id INTEGER NOT NULL REFERENCES production_repairs(id) ON DELETE CASCADE,
      repair_good_quantity REAL NOT NULL DEFAULT 0 CHECK (repair_good_quantity >= 0),
      repair_defect_quantity REAL NOT NULL DEFAULT 0 CHECK (repair_defect_quantity >= 0),
      scrap_quantity REAL NOT NULL DEFAULT 0 CHECK (scrap_quantity >= 0),
      scrap_reason TEXT NOT NULL DEFAULT '',
      repair_action TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      operator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_process_role_authorizations (
      process_id INTEGER NOT NULL REFERENCES production_processes(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (process_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS production_process_user_authorizations (
      process_id INTEGER NOT NULL REFERENCES production_processes(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (process_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS production_process_supervisors (
      process_id INTEGER NOT NULL REFERENCES production_processes(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (process_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS production_quality_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      check_no TEXT NOT NULL UNIQUE,
      task_id INTEGER NOT NULL REFERENCES production_tasks(id) ON DELETE CASCADE,
      work_order_id INTEGER NOT NULL REFERENCES production_work_orders(id) ON DELETE CASCADE,
      process_id INTEGER NOT NULL REFERENCES production_processes(id) ON DELETE RESTRICT,
      quantity REAL NOT NULL CHECK (quantity > 0),
      passed_quantity REAL NOT NULL DEFAULT 0 CHECK (passed_quantity >= 0),
      failed_quantity REAL NOT NULL DEFAULT 0 CHECK (failed_quantity >= 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed')),
      check_result TEXT NOT NULL DEFAULT '',
      inspector_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      checked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_inventory_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES production_tasks(id) ON DELETE CASCADE,
      document_id INTEGER NOT NULL UNIQUE REFERENCES stock_documents(id) ON DELETE RESTRICT,
      link_type TEXT NOT NULL CHECK (link_type IN ('semi_finished_receipt', 'finished_goods_receipt')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      posted_at TEXT
    );
  `);

  const warehouseColumns = db.prepare("PRAGMA table_info(warehouses)").all() as Array<{ name: string }>;
  if (!warehouseColumns.some((column) => column.name === "address")) {
    db.exec("ALTER TABLE warehouses ADD COLUMN address TEXT NOT NULL DEFAULT ''");
  }
  if (!warehouseColumns.some((column) => column.name === "warehouse_type")) {
    db.exec("ALTER TABLE warehouses ADD COLUMN warehouse_type TEXT NOT NULL DEFAULT 'general'");
  }
  const itemColumns = db.prepare("PRAGMA table_info(items)").all() as Array<{ name: string }>;
  if (!itemColumns.some((column) => column.name === "purchase_price")) {
    db.exec("ALTER TABLE items ADD COLUMN purchase_price REAL NOT NULL DEFAULT 0");
  }
  if (!itemColumns.some((column) => column.name === "sales_price")) {
    db.exec("ALTER TABLE items ADD COLUMN sales_price REAL NOT NULL DEFAULT 0");
  }
  const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "token_version")) {
    db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
  }
  if (!userColumns.some((column) => column.name === "must_change_password")) {
    db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
  }
  if (!userColumns.some((column) => column.name === "process_id")) {
    db.exec("ALTER TABLE users ADD COLUMN process_id INTEGER REFERENCES production_processes(id) ON DELETE SET NULL");
  }
  const routeStepColumns = db.prepare("PRAGMA table_info(production_route_steps)").all() as Array<{ name: string }>;
  if (!routeStepColumns.some((column) => column.name === "default_department_id")) {
    db.exec("ALTER TABLE production_route_steps ADD COLUMN default_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL");
  }
  if (!routeStepColumns.some((column) => column.name === "output_item_id")) {
    db.exec("ALTER TABLE production_route_steps ADD COLUMN output_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL");
  }
  if (!routeStepColumns.some((column) => column.name === "output_warehouse_id")) {
    db.exec("ALTER TABLE production_route_steps ADD COLUMN output_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL");
  }
  const workOrderColumns = db.prepare("PRAGMA table_info(production_work_orders)").all() as Array<{ name: string }>;
  if (!workOrderColumns.some((column) => column.name === "product_item_id")) {
    db.exec("ALTER TABLE production_work_orders ADD COLUMN product_item_id INTEGER REFERENCES items(id) ON DELETE RESTRICT");
  }
  if (!workOrderColumns.some((column) => column.name === "route_id")) {
    db.exec("ALTER TABLE production_work_orders ADD COLUMN route_id INTEGER REFERENCES production_routes(id) ON DELETE RESTRICT");
  }
  if (!workOrderColumns.some((column) => column.name === "start_process_id")) {
    db.exec("ALTER TABLE production_work_orders ADD COLUMN start_process_id INTEGER REFERENCES production_processes(id) ON DELETE RESTRICT");
  }
  if (!workOrderColumns.some((column) => column.name === "planned_quantity")) {
    db.exec("ALTER TABLE production_work_orders ADD COLUMN planned_quantity REAL NOT NULL DEFAULT 0");
  }
  if (!workOrderColumns.some((column) => column.name === "execution_status")) {
    db.exec("ALTER TABLE production_work_orders ADD COLUMN execution_status TEXT NOT NULL DEFAULT 'normal'");
  }
  if (!workOrderColumns.some((column) => column.name === "termination_type")) {
    db.exec("ALTER TABLE production_work_orders ADD COLUMN termination_type TEXT NOT NULL DEFAULT ''");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_work_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL REFERENCES production_work_orders(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      product_item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      route_id INTEGER NOT NULL REFERENCES production_routes(id) ON DELETE RESTRICT,
      planned_quantity REAL NOT NULL CHECK (planned_quantity > 0),
      good_quantity REAL NOT NULL DEFAULT 0 CHECK (good_quantity >= 0),
      defect_quantity REAL NOT NULL DEFAULT 0 CHECK (defect_quantity >= 0),
      scrap_quantity REAL NOT NULL DEFAULT 0 CHECK (scrap_quantity >= 0),
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (work_order_id, line_no),
      UNIQUE (work_order_id, product_item_id, route_id)
    );
  `);
  db.exec(`
    INSERT OR IGNORE INTO production_work_order_items
      (work_order_id, line_no, product_item_id, route_id, planned_quantity)
    SELECT wo.id, 1, wo.product_item_id, wo.route_id, wo.planned_quantity
    FROM production_work_orders wo
    WHERE wo.product_item_id IS NOT NULL
      AND wo.route_id IS NOT NULL
      AND wo.planned_quantity > 0
      AND NOT EXISTS (
        SELECT 1
        FROM production_work_order_items woi
        WHERE woi.work_order_id = wo.id
      );
  `);
  const taskColumns = db.prepare("PRAGMA table_info(production_tasks)").all() as Array<{ name: string }>;
  if (!taskColumns.some((column) => column.name === "work_order_item_id")) {
    db.exec("ALTER TABLE production_tasks ADD COLUMN work_order_item_id INTEGER REFERENCES production_work_order_items(id) ON DELETE CASCADE");
  }
  db.exec(`
    UPDATE production_tasks
    SET work_order_item_id = (
      SELECT woi.id
      FROM production_work_order_items woi
      WHERE woi.work_order_id = production_tasks.work_order_id
      ORDER BY woi.line_no
      LIMIT 1
    )
    WHERE work_order_item_id IS NULL;
  `);
  if (!taskColumns.some((column) => column.name === "output_target")) {
    db.exec("ALTER TABLE production_tasks ADD COLUMN output_target TEXT NOT NULL DEFAULT 'next_process'");
  }
  if (!taskColumns.some((column) => column.name === "quality_gate")) {
    db.exec("ALTER TABLE production_tasks ADD COLUMN quality_gate INTEGER NOT NULL DEFAULT 0");
  }
  if (!taskColumns.some((column) => column.name === "output_item_id")) {
    db.exec("ALTER TABLE production_tasks ADD COLUMN output_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL");
  }
  if (!taskColumns.some((column) => column.name === "output_warehouse_id")) {
    db.exec("ALTER TABLE production_tasks ADD COLUMN output_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL");
  }
  if (!taskColumns.some((column) => column.name === "output_document_id")) {
    db.exec("ALTER TABLE production_tasks ADD COLUMN output_document_id INTEGER REFERENCES stock_documents(id) ON DELETE SET NULL");
  }
  if (!taskColumns.some((column) => column.name === "flow_status")) {
    db.exec("ALTER TABLE production_tasks ADD COLUMN flow_status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!taskColumns.some((column) => column.name === "output_quantity")) {
    db.exec("ALTER TABLE production_tasks ADD COLUMN output_quantity REAL NOT NULL DEFAULT 0");
  }
  if (!taskColumns.some((column) => column.name === "rework_quantity")) {
    db.exec("ALTER TABLE production_tasks ADD COLUMN rework_quantity REAL NOT NULL DEFAULT 0");
  }
  if (!taskColumns.some((column) => column.name === "scrap_quantity")) {
    db.exec("ALTER TABLE production_tasks ADD COLUMN scrap_quantity REAL NOT NULL DEFAULT 0");
  }
  if (!taskColumns.some((column) => column.name === "output_lot_no")) {
    db.exec("ALTER TABLE production_tasks ADD COLUMN output_lot_no TEXT NOT NULL DEFAULT ''");
  }
  if (!taskColumns.some((column) => column.name === "output_serial_no")) {
    db.exec("ALTER TABLE production_tasks ADD COLUMN output_serial_no TEXT NOT NULL DEFAULT ''");
  }
  db.exec(`
    UPDATE production_tasks
    SET output_quantity = COALESCE((
      SELECT SUM(line_sum.quantity)
      FROM production_inventory_links link
      INNER JOIN (
        SELECT document_id, SUM(quantity) AS quantity
        FROM stock_document_lines
        GROUP BY document_id
      ) line_sum ON line_sum.document_id = link.document_id
      WHERE link.task_id = production_tasks.id
    ), 0)
    WHERE output_quantity = 0
      AND EXISTS (
        SELECT 1
        FROM production_inventory_links link
        WHERE link.task_id = production_tasks.id
      );

    UPDATE production_tasks
    SET output_quantity = good_quantity
    WHERE output_quantity = 0
      AND status = 'completed'
      AND good_quantity > 0;
  `);
  const taskIndexes = db.prepare("PRAGMA index_list(production_tasks)").all() as Array<{ name: string; unique: number }>;
  const hasLegacyTaskSequenceIndex = taskIndexes.some((index) => {
    if (!index.unique) return false;
    const columns = db.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{ name: string }>;
    return columns.map((column) => column.name).join(",") === "work_order_id,sequence_no";
  });
  if (hasLegacyTaskSequenceIndex) {
    db.exec(`
      PRAGMA foreign_keys = OFF;

      CREATE TABLE production_tasks_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_no TEXT NOT NULL UNIQUE,
        work_order_id INTEGER NOT NULL REFERENCES production_work_orders(id) ON DELETE CASCADE,
        work_order_item_id INTEGER REFERENCES production_work_order_items(id) ON DELETE CASCADE,
        route_step_id INTEGER REFERENCES production_route_steps(id) ON DELETE SET NULL,
        process_id INTEGER NOT NULL REFERENCES production_processes(id) ON DELETE RESTRICT,
        sequence_no INTEGER NOT NULL,
        assigned_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        output_target TEXT NOT NULL DEFAULT 'next_process',
        quality_gate INTEGER NOT NULL DEFAULT 0 CHECK (quality_gate IN (0, 1)),
        output_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
        output_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
        output_document_id INTEGER REFERENCES stock_documents(id) ON DELETE SET NULL,
        flow_status TEXT NOT NULL DEFAULT 'active' CHECK (flow_status IN ('active', 'awaiting_quality', 'awaiting_inventory')),
        planned_quantity REAL NOT NULL CHECK (planned_quantity >= 0),
        input_quantity REAL NOT NULL DEFAULT 0 CHECK (input_quantity >= 0),
        good_quantity REAL NOT NULL DEFAULT 0 CHECK (good_quantity >= 0),
        output_quantity REAL NOT NULL DEFAULT 0 CHECK (output_quantity >= 0),
        defect_quantity REAL NOT NULL DEFAULT 0 CHECK (defect_quantity >= 0),
        rework_quantity REAL NOT NULL DEFAULT 0 CHECK (rework_quantity >= 0),
        scrap_quantity REAL NOT NULL DEFAULT 0 CHECK (scrap_quantity >= 0),
        output_lot_no TEXT NOT NULL DEFAULT '',
        output_serial_no TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'in_progress', 'completed', 'abnormal', 'cancelled')),
        remark TEXT NOT NULL DEFAULT '',
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (work_order_item_id, sequence_no)
      );

      INSERT INTO production_tasks_new
        (id, task_no, work_order_id, work_order_item_id, route_step_id, process_id, sequence_no,
         assigned_department_id, assigned_user_id, output_target, quality_gate, output_item_id,
         output_warehouse_id, output_document_id, flow_status, planned_quantity, input_quantity,
         good_quantity, output_quantity, defect_quantity, rework_quantity, scrap_quantity,
         output_lot_no, output_serial_no, status, remark, started_at, completed_at, created_at, updated_at)
      SELECT id, task_no, work_order_id, work_order_item_id, route_step_id, process_id, sequence_no,
             assigned_department_id, assigned_user_id, output_target, quality_gate, output_item_id,
             output_warehouse_id, output_document_id, flow_status, planned_quantity, input_quantity,
             good_quantity, output_quantity, defect_quantity, rework_quantity, scrap_quantity,
             output_lot_no, output_serial_no, status, remark, started_at, completed_at, created_at, updated_at
      FROM production_tasks;

      DROP TABLE production_tasks;
      ALTER TABLE production_tasks_new RENAME TO production_tasks;
      PRAGMA foreign_keys = ON;
    `);
  }

  const reportColumns = db.prepare("PRAGMA table_info(production_reports)").all() as Array<{ name: string }>;
  if (!reportColumns.some((column) => column.name === "operation_data")) {
    db.exec("ALTER TABLE production_reports ADD COLUMN operation_data TEXT NOT NULL DEFAULT '{}'");
  }
  const disassemblyReportColumns = db.prepare("PRAGMA table_info(production_disassembly_reports)").all() as Array<{ name: string }>;
  if (!disassemblyReportColumns.some((column) => column.name === "status")) {
    db.exec("ALTER TABLE production_disassembly_reports ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
  }
  const assemblyReportColumns = db.prepare("PRAGMA table_info(production_assembly_reports)").all() as Array<{ name: string }>;
  if (!assemblyReportColumns.some((column) => column.name === "output_document_id")) {
    db.exec("ALTER TABLE production_assembly_reports ADD COLUMN output_document_id INTEGER REFERENCES stock_documents(id) ON DELETE SET NULL");
  }
  const repairColumns = db.prepare("PRAGMA table_info(production_repairs)").all() as Array<{ name: string }>;
  const repairColumnMigrations: Array<[string, string]> = [
    ["item_specification", "TEXT NOT NULL DEFAULT ''"],
    ["chip_model", "TEXT NOT NULL DEFAULT ''"],
    ["chip_name", "TEXT NOT NULL DEFAULT ''"],
    ["chip_spec", "TEXT NOT NULL DEFAULT ''"],
    ["source_lot_no", "TEXT NOT NULL DEFAULT ''"],
    ["source_serial_no", "TEXT NOT NULL DEFAULT ''"],
    ["repaired_good_quantity", "REAL NOT NULL DEFAULT 0"],
    ["repair_defect_quantity", "REAL NOT NULL DEFAULT 0"],
    ["scrapped_quantity", "REAL NOT NULL DEFAULT 0"],
    ["scrap_reason", "TEXT NOT NULL DEFAULT ''"]
  ];
  for (const [name, definition] of repairColumnMigrations) {
    if (!repairColumns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE production_repairs ADD COLUMN ${name} ${definition}`);
    }
  }
  db.exec(`
    UPDATE production_repairs
    SET repaired_good_quantity = CASE WHEN status = 'returned' THEN quantity ELSE repaired_good_quantity END,
        scrapped_quantity = CASE WHEN status = 'scrapped' THEN quantity ELSE scrapped_quantity END,
        repair_defect_quantity = CASE
          WHEN status IN ('returned', 'scrapped', 'closed') THEN 0
          ELSE quantity
        END
    WHERE repaired_good_quantity = 0
      AND repair_defect_quantity = 0
      AND scrapped_quantity = 0;
  `);

  const insertPermission = db.prepare(
    "INSERT OR IGNORE INTO permissions (code, module, action, label) VALUES (?, ?, ?, ?)"
  );
  const insertPermissions = db.transaction(() => {
    for (const [code, module, action, label] of permissionCatalog) {
      insertPermission.run(code, module, action, label);
    }
  });
  insertPermissions();

  const departmentCount = db
    .prepare("SELECT COUNT(*) AS count FROM departments")
    .get() as { count: number };
  if (departmentCount.count === 0) {
    const insertDepartment = db.prepare(
      "INSERT INTO departments (name, code, description) VALUES (?, ?, ?)"
    );
    insertDepartment.run("生产工序部", "PRODUCTION", "负责生产计划、工序执行与现场管理");
    insertDepartment.run("质量工序部", "QUALITY", "负责测试、质检、不良与放行");
    insertDepartment.run("仓储工序部", "WAREHOUSE", "负责原料、半成品、成品与委外收发");
    insertDepartment.run("工程工序部", "ENGINEERING", "负责 BOM、工艺路线和测试规范");
    insertDepartment.run("系统管理工序部", "IT", "负责账号、角色和系统运行维护");
  }

  db.prepare("UPDATE departments SET name = ?, description = ? WHERE code = ?").run(
    "生产工序部",
    "负责生产计划、工序执行与现场管理",
    "PRODUCTION"
  );
  db.prepare("UPDATE departments SET name = ?, description = ? WHERE code = ?").run(
    "质量工序部",
    "负责测试、质检、不良与放行",
    "QUALITY"
  );
  db.prepare("UPDATE departments SET name = ?, description = ? WHERE code = ?").run(
    "仓储工序部",
    "负责原料、半成品、成品与委外收发",
    "WAREHOUSE"
  );
  db.prepare("UPDATE departments SET name = ?, description = ? WHERE code = ?").run(
    "工程工序部",
    "负责 BOM、工艺路线和测试规范",
    "ENGINEERING"
  );
  db.prepare("UPDATE departments SET name = ?, description = ? WHERE code = ?").run(
    "系统管理工序部",
    "负责账号、角色和系统运行维护",
    "IT"
  );

  const processBootstrapFlag = db
    .prepare("SELECT flag_key FROM system_bootstrap_flags WHERE flag_key = ?")
    .get("builtin-production-processes") as { flag_key: string } | undefined;
  if (!processBootstrapFlag) {
    const initializeBuiltinProcesses = db.transaction(() => {
      const insertProcess = db.prepare(
        `INSERT OR IGNORE INTO production_processes
         (code, name, process_type, sort_order, description)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const process of builtinProductionProcesses) {
        insertProcess.run(
          process.code,
          process.name,
          process.processType,
          process.sortOrder,
          process.description
        );
        const row = db
          .prepare("SELECT id FROM production_processes WHERE code = ?")
          .get(process.code) as { id: number } | undefined;
        if (!row) continue;
      }
      db
        .prepare("INSERT INTO system_bootstrap_flags (flag_key) VALUES (?)")
        .run("builtin-production-processes");
    });
    initializeBuiltinProcesses();
  }

  // Existing databases already have the original bootstrap flag, so new built-in
  // stations are applied through a one-time compatibility migration.
  const assemblyDisassemblyProcessMigration = db
    .prepare("SELECT flag_key FROM system_bootstrap_flags WHERE flag_key = ?")
    .get("builtin-production-processes-assembly-disassembly") as { flag_key: string } | undefined;
  if (!assemblyDisassemblyProcessMigration) {
    const addAssemblyDisassemblyProcesses = db.transaction(() => {
      const insertProcess = db.prepare(
        `INSERT OR IGNORE INTO production_processes
         (code, name, process_type, sort_order, description)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const process of builtinProductionProcesses.filter((item) => ["PROC-DISASSEMBLY", "PROC-ASSEMBLY"].includes(item.code))) {
        insertProcess.run(
          process.code,
          process.name,
          process.processType,
          process.sortOrder,
          process.description
        );
        const row = db
          .prepare("SELECT id FROM production_processes WHERE code = ?")
          .get(process.code) as { id: number } | undefined;
        if (!row) continue;
      }
      db
        .prepare("INSERT INTO system_bootstrap_flags (flag_key) VALUES (?)")
        .run("builtin-production-processes-assembly-disassembly");
    });
    addAssemblyDisassemblyProcesses();
  }

  const routeBootstrapFlag = db
    .prepare("SELECT flag_key FROM system_bootstrap_flags WHERE flag_key = ?")
    .get("builtin-production-route") as { flag_key: string } | undefined;
  if (!routeBootstrapFlag) {
    const initializeBuiltinRoute = db.transaction(() => {
      const productionDepartment = db
        .prepare("SELECT id FROM departments WHERE code = 'PRODUCTION' AND status = 'active'")
        .get() as { id: number } | undefined;
      const qualityDepartment = db
        .prepare("SELECT id FROM departments WHERE code = 'QUALITY' AND status = 'active'")
        .get() as { id: number } | undefined;
      const processRows = db
        .prepare("SELECT id, code FROM production_processes WHERE code IN (?, ?, ?, ?, ?, ?, ?)")
        .all(
          "PROC-BGA",
          "PROC-CHIP-TEST",
          "PROC-OUTSOURCE",
          "PROC-CHIP-RETEST",
          "PROC-SMT",
          "PROC-AGING",
          "PROC-FQC"
        ) as Array<{ id: number; code: string }>;
      const processIdByCode = new Map(processRows.map((process) => [process.code, process.id]));
      const requiredProcessCodes = [
        "PROC-BGA",
        "PROC-CHIP-TEST",
        "PROC-OUTSOURCE",
        "PROC-CHIP-RETEST",
        "PROC-SMT",
        "PROC-AGING",
        "PROC-FQC"
      ];
      if (!productionDepartment || !qualityDepartment || requiredProcessCodes.some((code) => !processIdByCode.has(code))) {
        throw new Error("内置工艺路线依赖的部门或工序不存在");
      }

      db.prepare(
        `INSERT OR IGNORE INTO production_routes
         (code, name, product_item_id, description)
         VALUES ('ROUTE-MEMORY-STANDARD', '内存条标准生产路线', NULL, '内置标准路线模板；新建商品和仓库后可编辑配置输出商品、半成品仓和成品仓')`
      ).run();
      const route = db
        .prepare("SELECT id FROM production_routes WHERE code = 'ROUTE-MEMORY-STANDARD'")
        .get() as { id: number } | undefined;
      if (!route) throw new Error("内置工艺路线创建失败");
      const stepCount = (
        db.prepare("SELECT COUNT(*) AS count FROM production_route_steps WHERE route_id = ?").get(route.id) as {
          count: number;
        }
      ).count;
      if (stepCount === 0) {
        const insertStep = db.prepare(
          `INSERT INTO production_route_steps
           (route_id, process_id, step_no, default_department_id, output_target,
            output_item_id, output_warehouse_id, quality_gate, description)
           VALUES (?, ?, ?, ?, 'next_process', NULL, NULL, ?, ?)`
        );
        const steps = [
          ["PROC-BGA", productionDepartment.id, 0, "芯片拆卸植球完成后进入芯片初测"],
          ["PROC-CHIP-TEST", qualityDepartment.id, 1, "芯片初测合格后进入委外加工，不良自动进入维修"],
          ["PROC-OUTSOURCE", productionDepartment.id, 0, "委外加工完成后回厂复测"],
          ["PROC-CHIP-RETEST", qualityDepartment.id, 1, "委外回厂复测合格后进入 SMT 贴片"],
          ["PROC-SMT", productionDepartment.id, 0, "SMT 贴片完成后进入成品测试老化"],
          ["PROC-AGING", qualityDepartment.id, 1, "成品测试老化合格后进入日检"],
          ["PROC-FQC", qualityDepartment.id, 1, "日检合格后配置成品仓并完成成品入库"]
        ] as Array<[string, number, number, string]>;
        steps.forEach(([processCode, departmentId, qualityGate, description], index) => {
          insertStep.run(route.id, processIdByCode.get(processCode), index + 1, departmentId, qualityGate, description);
        });
      }
      db.prepare("INSERT INTO system_bootstrap_flags (flag_key) VALUES (?)").run("builtin-production-route");
    });
    initializeBuiltinRoute();
  }

  const extraRouteBootstrapFlag = db
    .prepare("SELECT flag_key FROM system_bootstrap_flags WHERE flag_key = ?")
    .get("builtin-production-route-disassembly-assembly") as { flag_key: string } | undefined;
  if (!extraRouteBootstrapFlag) {
    const initializeExtraRoutes = db.transaction(() => {
      const productionDepartment = db
        .prepare("SELECT id FROM departments WHERE code = 'PRODUCTION' AND status = 'active'")
        .get() as { id: number } | undefined;
      const processRows = db
        .prepare("SELECT id, code FROM production_processes WHERE code IN (?, ?)")
        .all("PROC-DISASSEMBLY", "PROC-ASSEMBLY") as Array<{ id: number; code: string }>;
      const processIdByCode = new Map(processRows.map((process) => [process.code, process.id]));
      if (!productionDepartment || !processIdByCode.has("PROC-DISASSEMBLY") || !processIdByCode.has("PROC-ASSEMBLY")) {
        throw new Error("内置拆解/组装路线依赖的部门或工序不存在");
      }

      const routes = [
        {
          code: "ROUTE-MEMORY-DISASSEMBLY",
          name: "生产拆解路线",
          description: "内置生产拆解模板；按工单发起拆解后可继续流转元器件或入库",
          steps: [
            ["PROC-DISASSEMBLY", productionDepartment.id, "拆解完成后按元器件去向流转", 0]
          ] as Array<[string, number, string, number]>
        },
        {
          code: "ROUTE-MEMORY-ASSEMBLY",
          name: "生产组装路线",
          description: "内置生产组装模板；按工单发起组装后继续常规流转",
          steps: [
            ["PROC-ASSEMBLY", productionDepartment.id, "组装完成后进入下一道工序", 0]
          ] as Array<[string, number, string, number]>
        }
      ];
      const insertRoute = db.prepare(
        `INSERT OR IGNORE INTO production_routes
         (code, name, product_item_id, description)
         VALUES (?, ?, NULL, ?)`
      );
      const updateRoute = db.prepare(
        "UPDATE production_routes SET name = ?, product_item_id = NULL, description = ?, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE code = ?"
      );
      const insertStep = db.prepare(
        `INSERT INTO production_route_steps
         (route_id, process_id, step_no, default_department_id, output_target,
          output_item_id, output_warehouse_id, quality_gate, description)
         VALUES (?, ?, ?, ?, 'next_process', NULL, NULL, 0, ?)`
      );
      for (const routeSpec of routes) {
        insertRoute.run(routeSpec.code, routeSpec.name, routeSpec.description);
        updateRoute.run(routeSpec.name, routeSpec.description, routeSpec.code);
        const route = db
          .prepare("SELECT id FROM production_routes WHERE code = ?")
          .get(routeSpec.code) as { id: number } | undefined;
        if (!route) continue;
        const stepCount = (
          db.prepare("SELECT COUNT(*) AS count FROM production_route_steps WHERE route_id = ?").get(route.id) as { count: number }
        ).count;
        if (stepCount > 0) continue;
        routeSpec.steps.forEach(([processCode, departmentId, description], index) => {
          insertStep.run(route.id, processIdByCode.get(processCode), index + 1, departmentId, description);
        });
      }
      db.prepare("INSERT INTO system_bootstrap_flags (flag_key) VALUES (?)").run("builtin-production-route-disassembly-assembly");
    });
    initializeExtraRoutes();
  }

  const insertUnit = db.prepare(
    "INSERT OR IGNORE INTO units (code, name, precision) VALUES (?, ?, ?)"
  );
  for (const unit of [
    ["PCS", "个", 0],
    ["STRIP", "条", 0],
    ["SET", "套", 0],
    ["TRAY", "盘", 0],
    ["BOX", "箱", 0]
  ]) {
    insertUnit.run(...unit);
  }

  const insertAttribute = db.prepare(
    "INSERT OR IGNORE INTO item_attribute_definitions (code, name, value_type, options_text) VALUES (?, ?, ?, ?)"
  );
  for (const attribute of [
    ["CAPACITY", "容量", "text", ""],
    ["FREQUENCY", "频率", "text", ""],
    ["GENERATION", "代际", "text", ""],
    ["CHIP_SPEC", "颗粒规格", "text", ""],
    ["ECC", "ECC", "select", "支持,不支持"],
    ["FORM_FACTOR", "外形规格", "text", ""],
    ["VOLTAGE", "工作电压", "text", ""],
    ["RANK", "Rank", "text", ""]
  ]) {
    insertAttribute.run(...attribute);
  }

  const permissionIds = db
    .prepare("SELECT id, code FROM permissions")
    .all() as Array<{ id: number; code: string }>;
  const permissionIdByCode = new Map(permissionIds.map((item) => [item.code, item.id]));

  db.prepare("UPDATE permissions SET module = ?, label = ? WHERE code = ?").run(
    "工序",
    "查看工序流程与岗位",
    "system.departments.view"
  );
  db.prepare("UPDATE permissions SET module = ?, label = ? WHERE code = ?").run(
    "工序",
    "新增、编辑工序流程",
    "system.departments.manage"
  );

  const ensureSpecialRoles = db.transaction(() => {
    const insertRole = db.prepare("INSERT OR IGNORE INTO roles (name, code, description) VALUES (?, ?, ?)");
    insertRole.run("系统管理员", "SYSTEM_ADMIN", "管理系统账号、角色、权限和基础配置");
  });
  ensureSpecialRoles();
  syncProcessRoleTemplates();
  db.prepare("DELETE FROM roles WHERE code IN (?, ?, ?, ?, ?, ?)").run(
    "PRODUCTION_MANAGER",
    "WAREHOUSE_OPERATOR",
    "QUALITY_INSPECTOR",
    "OPERATOR",
    "PROCESS_MANAGER",
    "DEPARTMENT_MANAGER"
  );

  const roleRows = db.prepare("SELECT id, code FROM roles").all() as Array<{
    id: number;
    code: string;
  }>;
  const insertRolePermission = db.prepare(
    "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)"
  );
  const systemAdminRole = roleRows.find((role) => role.code === "SYSTEM_ADMIN");
  if (systemAdminRole) {
    for (const permission of permissionIds) insertRolePermission.run(systemAdminRole.id, permission.id);
  }

  const permissionDependencyMigration = db
    .prepare("SELECT flag_key FROM system_bootstrap_flags WHERE flag_key = ?")
    .get("permission-dependency-closure-v2") as { flag_key: string } | undefined;
  if (!permissionDependencyMigration) {
    const permissionDependenciesByCode = new Map(permissionIds.map((permission) => [permission.code, permissionDependencies[permission.code] ?? []]));
    for (const role of roleRows) {
      const grantedCodes = new Set(
        (db
          .prepare(
            `SELECT p.code
             FROM permissions p
             INNER JOIN role_permissions rp ON rp.permission_id = p.id
             WHERE rp.role_id = ?`
          )
          .all(role.id) as Array<{ code: string }>).map((permission) => permission.code)
      );
      const pendingCodes = [...grantedCodes];
      while (pendingCodes.length) {
        const code = pendingCodes.pop();
        if (!code) continue;
        for (const dependency of permissionDependenciesByCode.get(code) ?? []) {
          if (grantedCodes.has(dependency)) continue;
          grantedCodes.add(dependency);
          pendingCodes.push(dependency);
          const permissionId = permissionIdByCode.get(dependency);
          if (permissionId) insertRolePermission.run(role.id, permissionId);
        }
      }
    }
    db.prepare("INSERT INTO system_bootstrap_flags (flag_key) VALUES (?)").run("permission-dependency-closure-v2");
  }

  const admin = db
    .prepare("SELECT id, password_hash AS passwordHash FROM users WHERE username = ?")
    .get("admin") as { id: number; passwordHash: string } | undefined;
  if (!admin) {
    const initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;
    if (process.env.NODE_ENV === "production" && !initialAdminPassword) {
      throw new Error("生产环境必须设置 INITIAL_ADMIN_PASSWORD");
    }
    const adminDepartment = db
      .prepare("SELECT id FROM departments WHERE code = ?")
      .get("IT") as { id: number };
    const result = db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, employee_no, position, department_id, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)"
      )
      .run(
        "admin",
        bcrypt.hashSync(initialAdminPassword ?? "ChangeMe123!", 10),
        "系统管理员",
        "SYS-0001",
        "系统管理员",
        adminDepartment.id
      );
    const systemAdmin = db
      .prepare("SELECT id FROM roles WHERE code = ?")
      .get("SYSTEM_ADMIN") as { id: number };
    db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").run(
      result.lastInsertRowid,
      systemAdmin.id
    );
  } else if (bcrypt.compareSync("admin123", admin.passwordHash)) {
    db.prepare(
      "UPDATE users SET must_change_password = 1, token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(admin.id);
  }
}

export function getUserPermissions(userId: number): PermissionRow[] {
  return db
    .prepare(
      `
        SELECT DISTINCT p.id, p.code, p.module, p.action, p.label
        FROM permissions p
        INNER JOIN role_permissions rp ON rp.permission_id = p.id
        INNER JOIN user_roles ur ON ur.role_id = rp.role_id
        INNER JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ? AND r.status = 'active'
        ORDER BY p.module, p.id
      `
    )
    .all(userId) as PermissionRow[];
}

export function hasPermission(userId: number, code: string) {
  return getUserPermissions(userId).some((permission) => permission.code === code);
}

export function getUserRoleCodes(userId: number): string[] {
  return (
    db
      .prepare(
        `
          SELECT r.code
          FROM roles r
          INNER JOIN user_roles ur ON ur.role_id = r.id
          WHERE ur.user_id = ? AND r.status = 'active'
        `
      )
      .all(userId) as Array<{ code: string }>
  ).map((role) => role.code);
}

export function isSystemAdmin(userId: number) {
  return getUserRoleCodes(userId).includes("SYSTEM_ADMIN");
}

export function getUserAuthorizedProcessCodes(userId: number): string[] {
  if (isSystemAdmin(userId)) {
    return (db.prepare("SELECT code FROM production_processes WHERE status = 'active' ORDER BY sort_order, id").all() as Array<{ code: string }>).map(
      (process) => process.code
    );
  }
  return (
    db
      .prepare(
        `SELECT DISTINCT p.code
         FROM production_processes p
         WHERE p.status = 'active'
           AND (
             EXISTS (
               SELECT 1 FROM production_process_user_authorizations pua
               WHERE pua.process_id = p.id AND pua.user_id = ?
             )
             OR EXISTS (
               SELECT 1 FROM production_process_supervisors pps
               WHERE pps.process_id = p.id AND pps.user_id = ?
             )
             OR EXISTS (
               SELECT 1
               FROM production_process_role_authorizations pra
               INNER JOIN user_roles ur ON ur.role_id = pra.role_id
               INNER JOIN roles r ON r.id = ur.role_id
               WHERE pra.process_id = p.id AND ur.user_id = ? AND r.status = 'active'
             )
           )
         ORDER BY p.sort_order, p.id`
      )
      .all(userId, userId, userId) as Array<{ code: string }>
  ).map((process) => process.code);
}

export function getUserDepartmentIds(userId: number): number[] {
  const user = db
    .prepare("SELECT department_id AS departmentId FROM users WHERE id = ?")
    .get(userId) as { departmentId: number | null } | undefined;
  const managed = db
    .prepare("SELECT department_id AS departmentId FROM department_managers WHERE user_id = ?")
    .all(userId) as Array<{ departmentId: number }>;
  return [...new Set([user?.departmentId, ...managed.map((item) => item.departmentId)].filter((id): id is number => id != null))];
}

export function canAccessDepartment(userId: number, departmentId: number) {
  return isSystemAdmin(userId) || getUserDepartmentIds(userId).includes(departmentId);
}

export function recordAudit(
  userId: number | null,
  action: string,
  resource: string,
  resourceId: string | number | null,
  detail: string,
  ipAddress = ""
) {
  db.prepare(
    "INSERT INTO audit_logs (user_id, action, resource, resource_id, detail, ip_address) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(userId, action, resource, resourceId?.toString() ?? null, detail, ipAddress);
}
