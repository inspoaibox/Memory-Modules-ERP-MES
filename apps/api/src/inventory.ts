import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  canAccessDepartment,
  db,
  getUserDepartmentIds,
  hasPermission,
  isSystemAdmin,
  recordAudit,
  type WarehouseType,
  warehouseTypeValues
} from "./db.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    user: {
      id: number;
      username: string;
      displayName: string;
      tokenVersion: number;
    };
  }
}

type PermissionGuard = (code: string) => (request: FastifyRequest) => Promise<void>;
type ClientIp = (request: FastifyRequest) => string;
type InventoryDocumentType = "receipt" | "issue" | "transfer" | "count" | "scrap";
type DocumentStatus = "draft" | "submitted" | "approved" | "posted" | "cancelled";
type DocumentOutputAction = "preview" | "print" | "download";

type WarehouseRow = {
  id: number;
  code: string;
  name: string;
  departmentId: number;
  departmentName: string;
  managerUserId: number | null;
  managerName: string | null;
  warehouseType: WarehouseType;
  address: string;
  description: string;
  status: "active" | "inactive";
};

type DocumentRow = {
  id: number;
  documentNo: string;
  documentType: InventoryDocumentType;
  status: DocumentStatus;
  businessDate: string;
  departmentId: number;
  departmentName: string;
  warehouseId: number | null;
  warehouseName: string | null;
  sourceWarehouseId: number | null;
  sourceWarehouseName: string | null;
  targetWarehouseId: number | null;
  targetWarehouseName: string | null;
  supplierName: string;
  purchaseOrderNo: string;
  referenceNo: string;
  reason: string;
  remark: string;
  createdBy: number;
  createdByName: string;
  lineCount: number;
  createdAt: string;
};

const documentLabels: Record<InventoryDocumentType, string> = {
  receipt: "入库单",
  issue: "出库单",
  transfer: "调拨单",
  count: "盘点单",
  scrap: "报废单"
};

const actionPermission = (type: InventoryDocumentType, action: "create" | "approve" | "post") =>
  `inventory.${type === "receipt" ? "receipts" : type === "issue" ? "issues" : type === "transfer" ? "transfers" : type === "count" ? "counts" : "scrap"}.${action}`;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nextCode(prefix: string, table: string, column: string) {
  const rows = db
    .prepare(`SELECT ${column} AS code FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1`)
    .all(`${prefix}-%`) as Array<{ code: string }>;
  const lastNumber = rows[0]?.code.match(/-(\d+)$/)?.[1];
  return `${prefix}-${String(Number(lastNumber ?? 0) + 1).padStart(4, "0")}`;
}

function nextDocumentNo(type: InventoryDocumentType) {
  const prefix: Record<InventoryDocumentType, string> = {
    receipt: "IN",
    issue: "OUT",
    transfer: "TRF",
    count: "CNT",
    scrap: "SCR"
  };
  const date = today().replaceAll("-", "");
  const last = db
    .prepare("SELECT document_no AS documentNo FROM stock_documents WHERE document_no LIKE ? ORDER BY id DESC LIMIT 1")
    .get(`${prefix[type]}-${date}-%`) as { documentNo: string } | undefined;
  const lastNumber = last?.documentNo.match(/-(\d+)$/)?.[1];
  return `${prefix[type]}-${date}-${String(Number(lastNumber ?? 0) + 1).padStart(4, "0")}`;
}

function requestError(message: string, statusCode = 400) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function parseId(value: unknown, label: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw requestError(`${label}不合法`);
  return id;
}

function parseQuantity(value: unknown, allowZero = false) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0 || (!allowZero && quantity <= 0)) {
    throw requestError(allowZero ? "数量不能小于 0" : "数量必须大于 0");
  }
  return quantity;
}

function parsePrice(value: unknown, label: string) {
  const price = Number(value ?? 0);
  if (!Number.isFinite(price) || price < 0) throw requestError(`${label}不能小于 0`);
  return price;
}

function parseWarehouseType(value: unknown, label = "仓库类型") {
  if (typeof value !== "string" || !warehouseTypeValues.includes(value as WarehouseType)) {
    throw requestError(`${label}不合法`);
  }
  return value as WarehouseType;
}

function getWarehouse(id: number) {
  return db
    .prepare(
      `
        SELECT w.id, w.code, w.name, w.department_id AS departmentId,
               d.name AS departmentName, w.manager_user_id AS managerUserId,
               u.display_name AS managerName, w.warehouse_type AS warehouseType,
               w.address, w.description, w.status
        FROM warehouses w
        INNER JOIN departments d ON d.id = w.department_id
        LEFT JOIN users u ON u.id = w.manager_user_id
        WHERE w.id = ?
      `
    )
    .get(id) as WarehouseRow | undefined;
}

function assertWarehouseAccess(userId: number, id: number) {
  const warehouse = getWarehouse(id);
  if (!warehouse) throw requestError("仓库不存在", 404);
  if (warehouse.status !== "active") throw requestError("仓库已停用");
  if (!canAccessDepartment(userId, warehouse.departmentId)) {
    throw requestError("当前账号没有该仓库的数据范围", 403);
  }
  return warehouse;
}

function getItem(id: number) {
  return db
    .prepare(
      `
        SELECT i.id, i.item_code AS itemCode, i.name,
               i.category_id AS categoryId, c.name AS categoryName,
               i.unit_id AS unitId, u.name AS unitName,
               i.purchase_price AS purchasePrice, i.sales_price AS salesPrice,
               i.barcode, i.tracking_mode AS trackingMode,
               i.description, i.status
        FROM items i
        LEFT JOIN item_categories c ON c.id = i.category_id
        LEFT JOIN units u ON u.id = i.unit_id
        WHERE i.id = ?
      `
    )
    .get(id) as
    | {
        id: number;
        itemCode: string;
        name: string;
        categoryId: number | null;
        categoryName: string | null;
        unitId: number | null;
        unitName: string | null;
        purchasePrice: number;
        salesPrice: number;
        barcode: string | null;
        trackingMode: "none" | "lot" | "serial";
        description: string;
        status: "active" | "inactive";
      }
    | undefined;
}

function assertItemLines(lines: Array<Record<string, unknown>>) {
  if (!Array.isArray(lines) || !lines.length) throw requestError("请先选择至少一个商品");
  return lines.map((line, index) => {
    const itemId = parseId(line.itemId, `第 ${index + 1} 行商品`);
    const item = getItem(itemId);
    if (!item || item.status !== "active") throw requestError(`第 ${index + 1} 行商品不存在或已停用`);
    const quantity = parseQuantity(line.quantity);
    const lotNo = String(line.lotNo ?? "").trim();
    const serialNo = String(line.serialNo ?? "").trim();
    if (item.trackingMode === "lot" && !lotNo) throw requestError(`${item.name}必须填写批次号`);
    if (item.trackingMode === "serial" && (!serialNo || quantity !== 1)) {
      throw requestError(`${item.name}按序列号管理时，每行数量必须为 1 且填写序列号`);
    }
    return {
      itemId,
      quantity,
      lotNo,
      serialNo,
      remark: String(line.remark ?? "").trim()
    };
  });
}

function getBalance(itemId: number, warehouseId: number, lotNo = "", serialNo = "") {
  const row = db
    .prepare(
      `
        SELECT COALESCE(SUM(quantity_delta), 0) AS quantity
        FROM stock_ledger_entries
        WHERE item_id = ? AND warehouse_id = ? AND lot_no = ? AND serial_no = ?
      `
    )
    .get(itemId, warehouseId, lotNo, serialNo) as { quantity: number };
  return Number(row.quantity);
}

function getScopedWarehouseIds(userId: number) {
  if (isSystemAdmin(userId)) {
    return (db.prepare("SELECT id FROM warehouses WHERE status = 'active'").all() as Array<{ id: number }>).map(
      (item) => item.id
    );
  }
  const departmentIds = getUserDepartmentIds(userId);
  if (!departmentIds.length) return [];
  const placeholders = departmentIds.map(() => "?").join(",");
  return (
    db
      .prepare(`SELECT id FROM warehouses WHERE status = 'active' AND department_id IN (${placeholders})`)
      .all(...departmentIds) as Array<{ id: number }>
  ).map((item) => item.id);
}

function getDocument(id: number) {
  const document = db
    .prepare(
      `
        SELECT d.id, d.document_no AS documentNo, d.document_type AS documentType,
               d.status, d.business_date AS businessDate,
               d.department_id AS departmentId, dep.name AS departmentName,
               d.warehouse_id AS warehouseId, w.name AS warehouseName,
               d.source_warehouse_id AS sourceWarehouseId, sw.name AS sourceWarehouseName,
               d.target_warehouse_id AS targetWarehouseId, tw.name AS targetWarehouseName,
               d.supplier_name AS supplierName, d.purchase_order_no AS purchaseOrderNo,
               d.reference_no AS referenceNo, d.reason, d.remark,
               d.created_by AS createdBy, creator.display_name AS createdByName,
               d.submitted_by AS submittedBy, d.approved_by AS approvedBy,
               d.posted_by AS postedBy, d.submitted_at AS submittedAt,
               d.approved_at AS approvedAt, d.posted_at AS postedAt,
               d.created_at AS createdAt, d.updated_at AS updatedAt
        FROM stock_documents d
        INNER JOIN departments dep ON dep.id = d.department_id
        LEFT JOIN warehouses w ON w.id = d.warehouse_id
        LEFT JOIN warehouses sw ON sw.id = d.source_warehouse_id
        LEFT JOIN warehouses tw ON tw.id = d.target_warehouse_id
        INNER JOIN users creator ON creator.id = d.created_by
        WHERE d.id = ?
      `
    )
    .get(id) as DocumentRow & {
    submittedBy: number | null;
    approvedBy: number | null;
    postedBy: number | null;
    submittedAt: string | null;
    approvedAt: string | null;
    postedAt: string | null;
    updatedAt: string;
  } | undefined;
  if (!document) return null;
  const lines = db
    .prepare(
      `
        SELECT l.id, l.line_no AS lineNo, l.item_id AS itemId, i.item_code AS itemCode,
               i.name AS itemName, u.name AS unitName, i.tracking_mode AS trackingMode,
               l.quantity, l.lot_no AS lotNo, l.serial_no AS serialNo, l.remark
        FROM stock_document_lines l
        INNER JOIN items i ON i.id = l.item_id
        LEFT JOIN units u ON u.id = i.unit_id
        WHERE l.document_id = ?
        ORDER BY l.line_no
      `
    )
    .all(id);
  return { ...document, lines };
}

function getDocumentPermission(type: InventoryDocumentType, action: "create" | "approve" | "post") {
  return actionPermission(type, action);
}

function canViewDocument(userId: number, document: DocumentRow) {
  return (
    isSystemAdmin(userId) ||
    canAccessDepartment(userId, document.departmentId) ||
    (document.sourceWarehouseId !== null && isWarehouseInUserScope(userId, document.sourceWarehouseId)) ||
    (document.targetWarehouseId !== null && isWarehouseInUserScope(userId, document.targetWarehouseId))
  );
}

function isWarehouseInUserScope(userId: number, warehouseId: number) {
  const warehouse = getWarehouse(warehouseId);
  return Boolean(warehouse && canAccessDepartment(userId, warehouse.departmentId));
}

function canManageDocumentLifecycle(userId: number, document: DocumentRow) {
  return isSystemAdmin(userId) || canAccessDepartment(userId, document.departmentId);
}

function assertDocumentLifecycleScope(userId: number, document: DocumentRow) {
  if (!canManageDocumentLifecycle(userId, document)) {
    throw requestError("当前账号没有该库存单据的流程操作范围", 403);
  }
}

function assertDocumentPostingScope(userId: number, document: DocumentRow) {
  const warehouseId = document.documentType === "transfer" ? document.sourceWarehouseId : document.warehouseId;
  if (warehouseId === null || !isWarehouseInUserScope(userId, warehouseId)) {
    throw requestError("当前账号没有该库存单据的过账仓库范围", 403);
  }
}

function assertDocumentApprovalSeparation(userId: number, document: DocumentRow, action: "approve" | "post") {
  if (document.createdBy === userId) {
    const actionLabel = action === "approve" ? "审批" : "过账";
    throw requestError(`制单人不能${actionLabel}本人创建的库存单据`, 403);
  }
}

function assertWarehouseManager(managerUserId: number | null | undefined, departmentId: number) {
  if (!managerUserId) return null;
  const manager = db
    .prepare("SELECT id, status FROM users WHERE id = ?")
    .get(managerUserId) as { id: number; status: "active" | "inactive" } | undefined;
  if (!manager || manager.status !== "active") throw requestError("仓库负责人不存在或已停用");
  if (!canAccessDepartment(managerUserId, departmentId)) {
    throw requestError("仓库负责人必须属于或管理该仓库所属部门");
  }
  return manager.id;
}

const QUANTITY_EPSILON = 0.000001;

function positiveQuantity(quantity: number) {
  return quantity > QUANTITY_EPSILON ? quantity : 0;
}

function getDocumentLineQuantity(documentId: number) {
  const result = db
    .prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM stock_document_lines WHERE document_id = ?")
    .get(documentId) as { quantity: number };
  return positiveQuantity(result.quantity);
}

function hasOpenProductionRepairs(taskId: number) {
  const result = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM production_repairs
       WHERE source_task_id = ? AND status IN ('pending', 'repairing', 'retested')`
    )
    .get(taskId) as { count: number };
  return result.count > 0;
}

function getPendingProductionInventoryDocumentId(taskId: number) {
  const result = db
    .prepare(
      `SELECT document_id AS documentId
       FROM production_inventory_links
       WHERE task_id = ? AND status = 'pending'
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(taskId) as { documentId: number } | undefined;
  return result?.documentId ?? null;
}

function releaseNextProductionTask(workOrderId: number, workOrderItemId: number | null, sequenceNo: number, quantity: number) {
  const outputQuantity = positiveQuantity(quantity);
  if (outputQuantity <= 0) return;
  const itemScopeColumn = workOrderItemId === null ? "work_order_item_id IS NULL" : "work_order_item_id = ?";
  const itemScopeParams = workOrderItemId === null ? [] : [workOrderItemId];
  const nextTask = db
    .prepare(
      `SELECT id, status, planned_quantity AS plannedQuantity,
              input_quantity AS inputQuantity, good_quantity AS goodQuantity,
              output_quantity AS outputQuantity
       FROM production_tasks
       WHERE work_order_id = ?
         AND ${itemScopeColumn}
         AND sequence_no > ?
         AND status IN ('pending', 'ready', 'in_progress', 'completed', 'abnormal', 'cancelled')
       ORDER BY sequence_no
       LIMIT 1`
    )
    .get(workOrderId, ...itemScopeParams, sequenceNo) as
    | {
        id: number;
        status: string;
        plannedQuantity: number;
        inputQuantity: number;
        goodQuantity: number;
        outputQuantity: number;
      }
    | undefined;
  if (!nextTask) return;
  const shouldInitializePlan =
    (nextTask.status === "pending" || nextTask.status === "cancelled") &&
    nextTask.inputQuantity <= 0 &&
    nextTask.goodQuantity <= 0 &&
    nextTask.outputQuantity <= 0;
  const nextPlannedQuantity = shouldInitializePlan ? outputQuantity : nextTask.plannedQuantity + outputQuantity;
  db.prepare(
    `UPDATE production_tasks
     SET planned_quantity = ?,
         status = CASE WHEN status IN ('pending', 'completed', 'cancelled') THEN 'ready' ELSE status END,
         flow_status = CASE WHEN status IN ('pending', 'completed', 'cancelled') THEN 'active' ELSE flow_status END,
         completed_at = CASE WHEN status = 'completed' THEN NULL ELSE completed_at END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(nextPlannedQuantity, nextTask.id);
}

function updateProductionWorkOrderProgress(workOrderId: number) {
  const summary = db
    .prepare(
      `SELECT COUNT(*) AS taskCount,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedCount,
              SUM(CASE WHEN status = 'in_progress' OR status = 'abnormal' THEN 1 ELSE 0 END) AS activeCount
       FROM production_tasks
       INNER JOIN production_work_orders wo ON wo.id = production_tasks.work_order_id
       WHERE production_tasks.work_order_id = ?
         AND production_tasks.status <> 'cancelled'
         AND wo.execution_status = 'normal'`
    )
    .get(workOrderId) as { taskCount: number; completedCount: number | null; activeCount: number | null };
  if (summary.taskCount > 0 && summary.completedCount === summary.taskCount) {
    db.prepare(
      `UPDATE production_work_orders
       SET status = 'completed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(workOrderId);
    return;
  }
  if ((summary.activeCount ?? 0) > 0) {
    db.prepare(
      `UPDATE production_work_orders
       SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('released', 'in_progress') AND execution_status = 'normal'`
    ).run(workOrderId);
  }
}

function finalizeProductionTaskForPostedDocument(documentId: number) {
  const postedQuantity = getDocumentLineQuantity(documentId);
  const links = db
    .prepare(
      `SELECT l.id, l.task_id AS taskId
       FROM production_inventory_links l
       WHERE l.document_id = ? AND l.status = 'pending'`
    )
    .all(documentId) as Array<{ id: number; taskId: number }>;
  for (const link of links) {
    const task = db
      .prepare(
        `SELECT t.id, t.work_order_id AS workOrderId, t.work_order_item_id AS workOrderItemId,
                t.sequence_no AS sequenceNo,
                t.good_quantity AS goodQuantity, t.output_quantity AS outputQuantity,
                t.flow_status AS flowStatus
         FROM production_tasks t
         WHERE t.id = ?`
      )
      .get(link.taskId) as
      | {
          id: number;
          workOrderId: number;
          workOrderItemId: number | null;
          sequenceNo: number;
          goodQuantity: number;
          outputQuantity: number;
          flowStatus: string;
        }
      | undefined;
    const workOrder = task
      ? db.prepare("SELECT execution_status AS executionStatus FROM production_work_orders WHERE id = ?").get(task.workOrderId) as
        | { executionStatus: "normal" | "paused" | "terminated" }
        | undefined
      : undefined;
    if (!task || task.flowStatus !== "awaiting_inventory") {
      throw requestError("生产任务与入库单据状态不一致，不能过账", 409);
    }
    if (!workOrder || workOrder.executionStatus !== "normal") {
      throw requestError("生产工单已暂停或终止，不能完成生产入库过账", 409);
    }
    db.prepare(
      `UPDATE production_inventory_links
       SET status = 'posted', posted_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(link.id);
    if (task.outputQuantity < postedQuantity) {
      db.prepare(
        `UPDATE production_tasks
         SET output_quantity = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(postedQuantity, task.id);
    }
    releaseNextProductionTask(task.workOrderId, task.workOrderItemId, task.sequenceNo, postedQuantity);
    const pendingDocumentId = getPendingProductionInventoryDocumentId(task.id);
    if (pendingDocumentId) {
      db.prepare(
        `UPDATE production_tasks
         SET status = 'in_progress', flow_status = 'awaiting_inventory',
             output_document_id = ?, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(pendingDocumentId, task.id);
    } else if (hasOpenProductionRepairs(task.id)) {
      db.prepare(
        `UPDATE production_tasks
         SET status = 'abnormal', flow_status = 'active', output_document_id = NULL,
             completed_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(task.id);
    } else {
      db.prepare(
        `UPDATE production_tasks
         SET status = 'completed', flow_status = 'active', output_document_id = NULL,
             completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(task.id);
    }
    updateProductionWorkOrderProgress(task.workOrderId);
  }
}

export async function registerInventoryRoutes(
  app: FastifyInstance,
  dependencies: { requirePermission: PermissionGuard; clientIp: ClientIp }
) {
  const { requirePermission, clientIp } = dependencies;

  app.get("/api/inventory/dashboard", { preHandler: requirePermission("inventory.dashboard.view") }, async (request) => {
    const warehouseIds = getScopedWarehouseIds(request.user.id);
    const warehouseCount = warehouseIds.length;
    const itemCount = (db.prepare("SELECT COUNT(*) AS count FROM items WHERE status = 'active'").get() as { count: number }).count;
    const documentCount = (
      db
        .prepare("SELECT COUNT(*) AS count FROM stock_documents WHERE date(created_at) = date('now') AND status <> 'cancelled'")
        .get() as { count: number }
    ).count;
    const quantity = warehouseIds.length
      ? (
          db
            .prepare(
              `SELECT COALESCE(SUM(quantity_delta), 0) AS quantity
               FROM stock_ledger_entries
               WHERE warehouse_id IN (${warehouseIds.map(() => "?").join(",")})`
            )
            .get(...warehouseIds) as { quantity: number }
        ).quantity
      : 0;
    return {
      cards: [
        { key: "items", label: "启用商品", value: itemCount, tone: "blue" },
        { key: "warehouses", label: "授权仓库", value: warehouseCount, tone: "green" },
        { key: "quantity", label: "库存数量", value: Number(quantity), tone: "amber" },
        { key: "documents", label: "今日库存单据", value: documentCount, tone: "red" }
      ]
    };
  });

  app.get("/api/inventory/categories", { preHandler: requirePermission("inventory.categories.view") }, async () => ({
    items: db
      .prepare(
        `
          SELECT c.id, c.parent_id AS parentId, p.name AS parentName,
                 c.code, c.name, c.description, c.status,
                 COUNT(i.id) AS itemCount
          FROM item_categories c
          LEFT JOIN item_categories p ON p.id = c.parent_id
          LEFT JOIN items i ON i.category_id = c.id
          GROUP BY c.id
          ORDER BY c.id DESC
        `
      )
      .all()
  }));

  app.post<{
    Body: { code?: string; name?: string; parentId?: number | null; description?: string };
  }>("/api/inventory/categories", { preHandler: requirePermission("inventory.categories.manage") }, async (request) => {
    const name = request.body.name?.trim();
    if (!name) throw app.httpErrors.badRequest("分类名称不能为空");
    const code = request.body.code?.trim().toUpperCase() || nextCode("CAT", "item_categories", "code");
    try {
      const result = db
        .prepare("INSERT INTO item_categories (parent_id, code, name, description) VALUES (?, ?, ?, ?)")
        .run(request.body.parentId ?? null, code, name, request.body.description?.trim() ?? "");
      const id = Number(result.lastInsertRowid);
      recordAudit(request.user.id, "CREATE", "item_category", id, `创建商品分类 ${name}`, clientIp(request));
      return { item: db.prepare("SELECT * FROM item_categories WHERE id = ?").get(id) };
    } catch {
      throw app.httpErrors.conflict("分类名称或编码已存在");
    }
  });

  app.put<{
    Params: { id: string };
    Body: { code?: string; name?: string; parentId?: number | null; description?: string; status?: "active" | "inactive" };
  }>("/api/inventory/categories/:id", { preHandler: requirePermission("inventory.categories.manage") }, async (request) => {
    const id = parseId(request.params.id, "分类");
    const existing = db.prepare("SELECT id FROM item_categories WHERE id = ?").get(id);
    if (!existing) throw app.httpErrors.notFound("商品分类不存在");
    try {
      db.prepare(
        `UPDATE item_categories
         SET code = COALESCE(?, code), name = COALESCE(?, name), parent_id = ?,
             description = COALESCE(?, description), status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        request.body.code?.trim().toUpperCase() || null,
        request.body.name?.trim() || null,
        request.body.parentId === undefined ? null : request.body.parentId,
        request.body.description?.trim() ?? null,
        request.body.status ?? null,
        id
      );
      recordAudit(request.user.id, "UPDATE", "item_category", id, `更新商品分类 ${id}`, clientIp(request));
      return { item: db.prepare("SELECT * FROM item_categories WHERE id = ?").get(id) };
    } catch {
      throw app.httpErrors.conflict("分类名称或编码已存在");
    }
  });

  app.get("/api/inventory/units", { preHandler: requirePermission("inventory.units.view") }, async () => ({
    items: db.prepare("SELECT id, code, name, precision, status FROM units ORDER BY id").all()
  }));

  app.post<{
    Body: { code?: string; name?: string; precision?: number };
  }>("/api/inventory/units", { preHandler: requirePermission("inventory.units.manage") }, async (request) => {
    const name = request.body.name?.trim();
    if (!name) throw app.httpErrors.badRequest("单位名称不能为空");
    const code = request.body.code?.trim().toUpperCase() || nextCode("U", "units", "code");
    try {
      const result = db
        .prepare("INSERT INTO units (code, name, precision) VALUES (?, ?, ?)")
        .run(code, name, Math.max(0, Math.min(6, Number(request.body.precision ?? 0))));
      const id = Number(result.lastInsertRowid);
      recordAudit(request.user.id, "CREATE", "unit", id, `创建单位 ${name}`, clientIp(request));
      return { item: db.prepare("SELECT * FROM units WHERE id = ?").get(id) };
    } catch {
      throw app.httpErrors.conflict("单位名称或编码已存在");
    }
  });

  app.put<{
    Params: { id: string };
    Body: { code?: string; name?: string; precision?: number; status?: "active" | "inactive" };
  }>("/api/inventory/units/:id", { preHandler: requirePermission("inventory.units.manage") }, async (request) => {
    const id = parseId(request.params.id, "单位");
    if (!db.prepare("SELECT id FROM units WHERE id = ?").get(id)) throw app.httpErrors.notFound("单位不存在");
    try {
      db.prepare(
        `UPDATE units SET code = COALESCE(?, code), name = COALESCE(?, name),
         precision = COALESCE(?, precision), status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        request.body.code?.trim().toUpperCase() || null,
        request.body.name?.trim() || null,
        request.body.precision == null ? null : Math.max(0, Math.min(6, Number(request.body.precision))),
        request.body.status ?? null,
        id
      );
      recordAudit(request.user.id, "UPDATE", "unit", id, `更新单位 ${id}`, clientIp(request));
      return { item: db.prepare("SELECT * FROM units WHERE id = ?").get(id) };
    } catch {
      throw app.httpErrors.conflict("单位名称或编码已存在");
    }
  });

  app.get("/api/inventory/attributes", { preHandler: requirePermission("inventory.attributes.view") }, async () => ({
    items: db
      .prepare(
        "SELECT id, code, name, value_type AS valueType, options_text AS optionsText, status FROM item_attribute_definitions ORDER BY id"
      )
      .all()
  }));

  app.post<{
    Body: { code?: string; name?: string; valueType?: "text" | "number" | "select"; optionsText?: string };
  }>("/api/inventory/attributes", { preHandler: requirePermission("inventory.attributes.manage") }, async (request) => {
    const name = request.body.name?.trim();
    if (!name) throw app.httpErrors.badRequest("参数名称不能为空");
    const code = request.body.code?.trim().toUpperCase() || nextCode("ATTR", "item_attribute_definitions", "code");
    try {
      const result = db
        .prepare(
          "INSERT INTO item_attribute_definitions (code, name, value_type, options_text) VALUES (?, ?, ?, ?)"
        )
        .run(code, name, request.body.valueType ?? "text", request.body.optionsText?.trim() ?? "");
      const id = Number(result.lastInsertRowid);
      recordAudit(request.user.id, "CREATE", "item_attribute", id, `创建商品参数 ${name}`, clientIp(request));
      return { item: db.prepare("SELECT * FROM item_attribute_definitions WHERE id = ?").get(id) };
    } catch {
      throw app.httpErrors.conflict("参数名称或编码已存在");
    }
  });

  app.put<{
    Params: { id: string };
    Body: { code?: string; name?: string; valueType?: "text" | "number" | "select"; optionsText?: string; status?: "active" | "inactive" };
  }>("/api/inventory/attributes/:id", { preHandler: requirePermission("inventory.attributes.manage") }, async (request) => {
    const id = parseId(request.params.id, "商品参数");
    if (!db.prepare("SELECT id FROM item_attribute_definitions WHERE id = ?").get(id)) throw app.httpErrors.notFound("商品参数不存在");
    try {
      db.prepare(
        `UPDATE item_attribute_definitions
         SET code = COALESCE(?, code), name = COALESCE(?, name), value_type = COALESCE(?, value_type),
             options_text = COALESCE(?, options_text), status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        request.body.code?.trim().toUpperCase() || null,
        request.body.name?.trim() || null,
        request.body.valueType ?? null,
        request.body.optionsText?.trim() ?? null,
        request.body.status ?? null,
        id
      );
      recordAudit(request.user.id, "UPDATE", "item_attribute", id, `更新商品参数 ${id}`, clientIp(request));
      return { item: db.prepare("SELECT * FROM item_attribute_definitions WHERE id = ?").get(id) };
    } catch {
      throw app.httpErrors.conflict("参数名称或编码已存在");
    }
  });

  app.get<{
    Querystring: {
      categoryId?: string;
      warehouseId?: string;
      status?: "all" | "active" | "inactive";
      trackingMode?: "all" | "none" | "lot" | "serial";
      stockStatus?: "all" | "in_stock" | "out_of_stock";
    };
  }>("/api/inventory/items", { preHandler: requirePermission("inventory.items.view") }, async (request) => {
    const scopedWarehouseIds = getScopedWarehouseIds(request.user.id);
    let stockWarehouseIds = scopedWarehouseIds;
    if (request.query.warehouseId) {
      const warehouseId = parseId(request.query.warehouseId, "仓库");
      if (!scopedWarehouseIds.includes(warehouseId)) {
        throw app.httpErrors.forbidden("当前账号没有该仓库的数据范围");
      }
      stockWarehouseIds = [warehouseId];
    }
    const stockQuery = stockWarehouseIds.length
      ? `SELECT item_id, SUM(quantity_delta) AS stockQuantity
         FROM stock_ledger_entries
         WHERE warehouse_id IN (${stockWarehouseIds.map(() => "?").join(",")})
         GROUP BY item_id`
      : "SELECT NULL AS item_id, 0 AS stockQuantity WHERE 0";
    const conditions = ["1 = 1"];
    const filterParams: Array<string | number> = [];
    if (request.query.categoryId) {
      conditions.push("i.category_id = ?");
      filterParams.push(parseId(request.query.categoryId, "商品分类"));
    }
    if (request.query.status && request.query.status !== "all") {
      conditions.push("i.status = ?");
      filterParams.push(request.query.status);
    }
    if (request.query.trackingMode && request.query.trackingMode !== "all") {
      conditions.push("i.tracking_mode = ?");
      filterParams.push(request.query.trackingMode);
    }
    if (request.query.stockStatus === "in_stock") {
      conditions.push("COALESCE(stock.stockQuantity, 0) > 0");
    } else if (request.query.stockStatus === "out_of_stock") {
      conditions.push("COALESCE(stock.stockQuantity, 0) = 0");
    }
    return {
      items: db
        .prepare(
          `
            SELECT i.id, i.item_code AS itemCode, i.name, i.category_id AS categoryId,
                   c.name AS categoryName, i.unit_id AS unitId, u.name AS unitName,
                   i.purchase_price AS purchasePrice, i.sales_price AS salesPrice,
                   i.barcode, i.tracking_mode AS trackingMode, i.description, i.status,
                   COUNT(av.attribute_id) AS attributeCount,
                   COALESCE(stock.stockQuantity, 0) AS stockQuantity
            FROM items i
            LEFT JOIN item_categories c ON c.id = i.category_id
            LEFT JOIN units u ON u.id = i.unit_id
            LEFT JOIN item_attribute_values av ON av.item_id = i.id
            LEFT JOIN (${stockQuery}) stock ON stock.item_id = i.id
            WHERE ${conditions.join(" AND ")}
            GROUP BY i.id, stock.stockQuantity
            ORDER BY i.id DESC
          `
        )
        .all(...stockWarehouseIds, ...filterParams)
    };
  });

  app.get<{
    Params: { id: string };
  }>("/api/inventory/items/:id/balances", { preHandler: requirePermission("inventory.items.view") }, async (request) => {
    const id = parseId(request.params.id, "商品");
    const item = getItem(id);
    if (!item) throw app.httpErrors.notFound("商品不存在");
    const warehouseIds = getScopedWarehouseIds(request.user.id);
    if (!warehouseIds.length) return { items: [] };
    return {
      items: db
        .prepare(
          `
            SELECT w.id AS warehouseId, w.code AS warehouseCode, w.name AS warehouseName,
                   w.warehouse_type AS warehouseType,
                   d.name AS departmentName,
                   COALESCE(SUM(ledger.quantity_delta), 0) AS quantity
            FROM warehouses w
            INNER JOIN departments d ON d.id = w.department_id
            LEFT JOIN stock_ledger_entries ledger
              ON ledger.warehouse_id = w.id
             AND ledger.item_id = ?
            WHERE w.id IN (${warehouseIds.map(() => "?").join(",")})
            GROUP BY w.id
            ORDER BY w.id
          `
        )
        .all(id, ...warehouseIds)
    };
  });

  app.get<{
    Params: { id: string };
  }>("/api/inventory/items/:id", { preHandler: requirePermission("inventory.items.view") }, async (request) => {
    const id = parseId(request.params.id, "商品");
    const item = getItem(id);
    if (!item) throw app.httpErrors.notFound("商品不存在");
    const attributes = db
      .prepare(
        `
          SELECT d.id, d.code, d.name, d.value_type AS valueType,
                 d.options_text AS optionsText, COALESCE(v.value, '') AS value
          FROM item_attribute_definitions d
          LEFT JOIN item_attribute_values v ON v.attribute_id = d.id AND v.item_id = ?
          WHERE d.status = 'active'
          ORDER BY d.id
        `
      )
      .all(id);
    return { item, attributes };
  });

  app.post<{
    Body: {
      itemCode?: string;
      name?: string;
      categoryId?: number | null;
      unitId?: number | null;
      purchasePrice?: number;
      salesPrice?: number;
      barcode?: string;
      trackingMode?: "none" | "lot" | "serial";
      description?: string;
      attributes?: Array<{ attributeId: number; value: string }>;
    };
  }>("/api/inventory/items", { preHandler: requirePermission("inventory.items.manage") }, async (request) => {
    const name = request.body.name?.trim();
    if (!name || !request.body.categoryId || !request.body.unitId) {
      throw app.httpErrors.badRequest("商品名称、分类和库存单位不能为空");
    }
    const itemCode = request.body.itemCode?.trim().toUpperCase() || nextCode("ITEM", "items", "item_code");
    const attributes = request.body.attributes ?? [];
    try {
      const purchasePrice = parsePrice(request.body.purchasePrice, "采购价格");
      const salesPrice = parsePrice(request.body.salesPrice, "销售价格");
      const insert = db.transaction(() => {
        const result = db
          .prepare(
            `INSERT INTO items
             (item_code, name, category_id, unit_id, purchase_price, sales_price, barcode, tracking_mode, description)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            itemCode,
            name,
            request.body.categoryId,
            request.body.unitId,
            purchasePrice,
            salesPrice,
            request.body.barcode?.trim() || null,
            request.body.trackingMode ?? "none",
            request.body.description?.trim() ?? ""
          );
        const id = Number(result.lastInsertRowid);
        const insertAttribute = db.prepare(
          "INSERT OR REPLACE INTO item_attribute_values (item_id, attribute_id, value) VALUES (?, ?, ?)"
        );
        for (const attribute of attributes) {
          if (attribute.value?.trim()) insertAttribute.run(id, attribute.attributeId, attribute.value.trim());
        }
        return id;
      });
      const id = insert();
      recordAudit(request.user.id, "CREATE", "item", id, `创建商品 ${itemCode}`, clientIp(request));
      return { item: getItem(id) };
    } catch {
      throw app.httpErrors.conflict("商品编码或条码已存在，或商品数据不合法");
    }
  });

  app.put<{
    Params: { id: string };
    Body: {
      itemCode?: string;
      name?: string;
      categoryId?: number | null;
      unitId?: number | null;
      purchasePrice?: number;
      salesPrice?: number;
      barcode?: string | null;
      trackingMode?: "none" | "lot" | "serial";
      description?: string;
      status?: "active" | "inactive";
      attributes?: Array<{ attributeId: number; value: string }>;
    };
  }>("/api/inventory/items/:id", { preHandler: requirePermission("inventory.items.manage") }, async (request) => {
    const id = parseId(request.params.id, "商品");
    if (!getItem(id)) throw app.httpErrors.notFound("商品不存在");
    try {
      const purchasePrice = request.body.purchasePrice === undefined ? null : parsePrice(request.body.purchasePrice, "采购价格");
      const salesPrice = request.body.salesPrice === undefined ? null : parsePrice(request.body.salesPrice, "销售价格");
      const update = db.transaction(() => {
        db.prepare(
          `UPDATE items SET item_code = COALESCE(?, item_code), name = COALESCE(?, name),
           category_id = COALESCE(?, category_id), unit_id = COALESCE(?, unit_id),
           purchase_price = COALESCE(?, purchase_price), sales_price = COALESCE(?, sales_price),
           barcode = ?, tracking_mode = COALESCE(?, tracking_mode),
           description = COALESCE(?, description), status = COALESCE(?, status),
           updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(
          request.body.itemCode?.trim().toUpperCase() || null,
          request.body.name?.trim() || null,
          request.body.categoryId ?? null,
          request.body.unitId ?? null,
          purchasePrice,
          salesPrice,
          request.body.barcode?.trim() || null,
          request.body.trackingMode ?? null,
          request.body.description?.trim() ?? null,
          request.body.status ?? null,
          id
        );
        if (request.body.attributes) {
          const insertAttribute = db.prepare(
            "INSERT OR REPLACE INTO item_attribute_values (item_id, attribute_id, value) VALUES (?, ?, ?)"
          );
          const clearAttribute = db.prepare(
            "DELETE FROM item_attribute_values WHERE item_id = ? AND attribute_id = ?"
          );
          for (const attribute of request.body.attributes) {
            if (attribute.value?.trim()) insertAttribute.run(id, attribute.attributeId, attribute.value.trim());
            else clearAttribute.run(id, attribute.attributeId);
          }
        }
      });
      update();
      recordAudit(request.user.id, "UPDATE", "item", id, `更新商品 ${id}`, clientIp(request));
      return { item: getItem(id) };
    } catch {
      throw app.httpErrors.conflict("商品编码或条码已存在，或商品数据不合法");
    }
  });

  app.get("/api/inventory/warehouses", { preHandler: requirePermission("inventory.warehouses.view") }, async (request) => {
    const scopedIds = getScopedWarehouseIds(request.user.id);
    if (!scopedIds.length) return { items: [] };
    return {
      items: db
        .prepare(
          `
            SELECT w.id, w.code, w.name, w.department_id AS departmentId,
                   d.name AS departmentName, w.manager_user_id AS managerUserId,
                   u.display_name AS managerName, w.warehouse_type AS warehouseType,
                   w.address, w.description, w.status
            FROM warehouses w
            INNER JOIN departments d ON d.id = w.department_id
            LEFT JOIN users u ON u.id = w.manager_user_id
            WHERE w.id IN (${scopedIds.map(() => "?").join(",")})
            ORDER BY w.id DESC
          `
        )
        .all(...scopedIds)
    };
  });

  app.post<{
    Body: {
      code?: string;
      name?: string;
      departmentId?: number;
      managerUserId?: number | null;
      warehouseType?: WarehouseType;
      address?: string;
      description?: string;
    };
  }>("/api/inventory/warehouses", { preHandler: requirePermission("inventory.warehouses.manage") }, async (request) => {
    const name = request.body.name?.trim();
    const address = request.body.address?.trim();
    if (!name || !request.body.departmentId || !address) throw app.httpErrors.badRequest("仓库名称、所属部门和仓库地址不能为空");
    const departmentId = parseId(request.body.departmentId, "所属部门");
    const warehouseType = parseWarehouseType(request.body.warehouseType ?? "general");
    if (!canAccessDepartment(request.user.id, departmentId)) throw app.httpErrors.forbidden("当前账号没有该部门的数据范围");
    const managerUserId = assertWarehouseManager(request.body.managerUserId, departmentId);
    const code = request.body.code?.trim().toUpperCase() || nextCode("WH", "warehouses", "code");
    try {
      const result = db
        .prepare(
          "INSERT INTO warehouses (code, name, department_id, manager_user_id, warehouse_type, address, description) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .run(code, name, departmentId, managerUserId, warehouseType, address, request.body.description?.trim() ?? "");
      const id = Number(result.lastInsertRowid);
      recordAudit(request.user.id, "CREATE", "warehouse", id, `创建仓库 ${name}`, clientIp(request));
      return { item: getWarehouse(id) };
    } catch {
      throw app.httpErrors.conflict("仓库名称或编码已存在，或仓库数据不合法");
    }
  });

  app.put<{
    Params: { id: string };
    Body: {
      code?: string;
      name?: string;
      departmentId?: number;
      managerUserId?: number | null;
      warehouseType?: WarehouseType;
      address?: string;
      description?: string;
      status?: "active" | "inactive";
    };
  }>("/api/inventory/warehouses/:id", { preHandler: requirePermission("inventory.warehouses.manage") }, async (request) => {
    const id = parseId(request.params.id, "仓库");
    const existing = getWarehouse(id);
    if (!existing) throw app.httpErrors.notFound("仓库不存在");
    const departmentId = request.body.departmentId ?? existing.departmentId;
    const warehouseType = request.body.warehouseType === undefined ? existing.warehouseType : parseWarehouseType(request.body.warehouseType);
    if (!canAccessDepartment(request.user.id, departmentId)) throw app.httpErrors.forbidden("当前账号没有该部门的数据范围");
    const managerUserId = assertWarehouseManager(request.body.managerUserId ?? existing.managerUserId, departmentId);
    try {
      db.prepare(
        `UPDATE warehouses SET code = COALESCE(?, code), name = COALESCE(?, name),
         department_id = ?, manager_user_id = ?, warehouse_type = ?, address = COALESCE(?, address), description = COALESCE(?, description),
         status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(
        request.body.code?.trim().toUpperCase() || null,
        request.body.name?.trim() || null,
        departmentId,
        managerUserId,
        warehouseType,
        request.body.address?.trim() || null,
        request.body.description?.trim() ?? null,
        request.body.status ?? null,
        id
      );
      recordAudit(request.user.id, "UPDATE", "warehouse", id, `更新仓库 ${id}`, clientIp(request));
      return { item: getWarehouse(id) };
    } catch {
      throw app.httpErrors.conflict("仓库名称或编码已存在，或仓库数据不合法");
    }
  });

  app.get("/api/inventory/balances", { preHandler: requirePermission("inventory.balance.view") }, async (request) => {
    const warehouseIds = getScopedWarehouseIds(request.user.id);
    if (!warehouseIds.length) return { items: [] };
    return {
      items: db
        .prepare(
          `
            SELECT l.item_id AS itemId, i.item_code AS itemCode, i.name AS itemName,
                   u.name AS unitName, l.warehouse_id AS warehouseId, w.name AS warehouseName,
                   w.warehouse_type AS warehouseType,
                   l.lot_no AS lotNo, l.serial_no AS serialNo,
                   SUM(l.quantity_delta) AS quantity
            FROM stock_ledger_entries l
            INNER JOIN items i ON i.id = l.item_id
            LEFT JOIN units u ON u.id = i.unit_id
            INNER JOIN warehouses w ON w.id = l.warehouse_id
            WHERE l.warehouse_id IN (${warehouseIds.map(() => "?").join(",")})
            GROUP BY l.item_id, l.warehouse_id, l.lot_no, l.serial_no
            HAVING SUM(l.quantity_delta) <> 0
            ORDER BY l.warehouse_id, l.item_id, l.lot_no, l.serial_no
          `
        )
        .all(...warehouseIds)
    };
  });

  app.get("/api/inventory/ledger", { preHandler: requirePermission("inventory.ledger.view") }, async (request) => {
    const warehouseIds = getScopedWarehouseIds(request.user.id);
    if (!warehouseIds.length) return { items: [] };
    return {
      items: db
        .prepare(
          `
            SELECT l.id, l.created_at AS createdAt, d.document_no AS documentNo,
                   d.document_type AS documentType, i.item_code AS itemCode,
                   i.name AS itemName, w.name AS warehouseName,
                   w.warehouse_type AS warehouseType,
                   l.quantity_delta AS quantityDelta, l.lot_no AS lotNo, l.serial_no AS serialNo
            FROM stock_ledger_entries l
            INNER JOIN stock_documents d ON d.id = l.document_id
            INNER JOIN items i ON i.id = l.item_id
            INNER JOIN warehouses w ON w.id = l.warehouse_id
            WHERE l.warehouse_id IN (${warehouseIds.map(() => "?").join(",")})
            ORDER BY l.id DESC
            LIMIT 500
          `
        )
        .all(...warehouseIds)
    };
  });

  app.get<{
    Querystring: { type?: InventoryDocumentType; status?: DocumentStatus };
  }>("/api/inventory/documents", { preHandler: requirePermission("inventory.documents.view") }, async (request) => {
    const departmentIds = isSystemAdmin(request.user.id) ? null : getUserDepartmentIds(request.user.id);
    const clauses = ["1 = 1"];
    const params: Array<string | number> = [];
    if (request.query.type) {
      clauses.push("d.document_type = ?");
      params.push(request.query.type);
    }
    if (request.query.status) {
      clauses.push("d.status = ?");
      params.push(request.query.status);
    }
    if (departmentIds) {
      if (!departmentIds.length) return { items: [] };
      const placeholders = departmentIds.map(() => "?").join(",");
      clauses.push(
        `(d.department_id IN (${placeholders})
          OR EXISTS (
            SELECT 1 FROM warehouses scoped_source
            WHERE scoped_source.id = d.source_warehouse_id AND scoped_source.department_id IN (${placeholders})
          )
          OR EXISTS (
            SELECT 1 FROM warehouses scoped_target
            WHERE scoped_target.id = d.target_warehouse_id AND scoped_target.department_id IN (${placeholders})
          ))`
      );
      params.push(...departmentIds, ...departmentIds, ...departmentIds);
    }
    return {
      items: db
        .prepare(
          `
            SELECT d.id, d.document_no AS documentNo, d.document_type AS documentType,
                   d.status, d.business_date AS businessDate,
                   d.department_id AS departmentId, dep.name AS departmentName,
                   d.warehouse_id AS warehouseId, w.name AS warehouseName,
                   d.source_warehouse_id AS sourceWarehouseId, sw.name AS sourceWarehouseName,
                   d.target_warehouse_id AS targetWarehouseId, tw.name AS targetWarehouseName,
                   d.supplier_name AS supplierName, d.purchase_order_no AS purchaseOrderNo,
                   d.reference_no AS referenceNo, d.reason, d.remark,
                   d.created_by AS createdBy, u.display_name AS createdByName,
                   COUNT(l.id) AS lineCount, d.created_at AS createdAt
            FROM stock_documents d
            INNER JOIN departments dep ON dep.id = d.department_id
            LEFT JOIN warehouses w ON w.id = d.warehouse_id
            LEFT JOIN warehouses sw ON sw.id = d.source_warehouse_id
            LEFT JOIN warehouses tw ON tw.id = d.target_warehouse_id
            INNER JOIN users u ON u.id = d.created_by
            LEFT JOIN stock_document_lines l ON l.document_id = d.id
            WHERE ${clauses.join(" AND ")}
            GROUP BY d.id
            ORDER BY d.id DESC
            LIMIT 500
          `
        )
        .all(...params)
    };
  });

  app.get<{
    Params: { id: string };
  }>("/api/inventory/documents/:id", { preHandler: requirePermission("inventory.documents.view") }, async (request) => {
    const id = parseId(request.params.id, "库存单据");
    const document = getDocument(id);
    if (!document) throw app.httpErrors.notFound("库存单据不存在");
    if (!canViewDocument(request.user.id, document)) throw app.httpErrors.forbidden("当前账号没有该单据的数据范围");
    return { document };
  });

  app.post<{
    Params: { id: string };
    Body: { action?: DocumentOutputAction };
  }>("/api/inventory/documents/:id/output-actions", { preHandler: requirePermission("inventory.documents.view") }, async (request) => {
    const id = parseId(request.params.id, "库存单据");
    const action = request.body.action;
    if (!action || !["preview", "print", "download"].includes(action)) {
      throw app.httpErrors.badRequest("单据输出操作不合法");
    }
    const document = getDocument(id);
    if (!document) throw app.httpErrors.notFound("库存单据不存在");
    if (!canViewDocument(request.user.id, document)) throw app.httpErrors.forbidden("当前账号没有该单据的数据范围");
    const actionLabels: Record<DocumentOutputAction, string> = {
      preview: "预览",
      print: "打印",
      download: "下载"
    };
    recordAudit(
      request.user.id,
      action.toUpperCase(),
      "stock_document",
      id,
      `${actionLabels[action]}${documentLabels[document.documentType]} ${document.documentNo}`,
      clientIp(request)
    );
    return { ok: true };
  });

  app.post<{
    Body: {
      documentType?: InventoryDocumentType;
      businessDate?: string;
      warehouseId?: number;
      sourceWarehouseId?: number;
      targetWarehouseId?: number;
      supplierName?: string;
      purchaseOrderNo?: string;
      referenceNo?: string;
      reason?: string;
      remark?: string;
      lines?: Array<Record<string, unknown>>;
    };
  }>("/api/inventory/documents", { preHandler: requirePermission("inventory.documents.view") }, async (request) => {
    const type = request.body.documentType;
    if (!type || !documentLabels[type]) throw app.httpErrors.badRequest("库存单据类型不合法");
    if (!hasPermissionForCreate(request.user.id, type)) {
      throw app.httpErrors.forbidden("当前账号没有创建该库存单据的权限");
    }
    const lines = assertItemLines(request.body.lines ?? []);
    let departmentId: number;
    let warehouseId: number | null = null;
    let sourceWarehouseId: number | null = null;
    let targetWarehouseId: number | null = null;
    if (type === "transfer") {
      sourceWarehouseId = parseId(request.body.sourceWarehouseId, "调出仓库");
      targetWarehouseId = parseId(request.body.targetWarehouseId, "调入仓库");
      const source = assertWarehouseAccess(request.user.id, sourceWarehouseId);
      const target = assertWarehouseAccess(request.user.id, targetWarehouseId);
      departmentId = source.departmentId;
      if (sourceWarehouseId === targetWarehouseId) throw new Error("调出仓库和调入仓库不能相同");
      if (!canAccessDepartment(request.user.id, target.departmentId)) throw new Error("当前账号没有调入仓库的数据范围");
    } else {
      warehouseId = parseId(request.body.warehouseId, "仓库");
      const warehouse = assertWarehouseAccess(request.user.id, warehouseId);
      departmentId = warehouse.departmentId;
    }
    const insert = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO stock_documents
           (document_no, document_type, business_date, department_id, warehouse_id,
            source_warehouse_id, target_warehouse_id, supplier_name, purchase_order_no,
            reference_no, reason, remark, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          nextDocumentNo(type),
          type,
          request.body.businessDate || today(),
          departmentId,
          warehouseId,
          sourceWarehouseId,
          targetWarehouseId,
          request.body.supplierName?.trim() ?? "",
          request.body.purchaseOrderNo?.trim() ?? "",
          request.body.referenceNo?.trim() ?? "",
          request.body.reason?.trim() ?? "",
          request.body.remark?.trim() ?? "",
          request.user.id
        );
      const documentId = Number(result.lastInsertRowid);
      const insertLine = db.prepare(
        "INSERT INTO stock_document_lines (document_id, line_no, item_id, quantity, lot_no, serial_no, remark) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      lines.forEach((line, index) => {
        insertLine.run(documentId, index + 1, line.itemId, line.quantity, line.lotNo, line.serialNo, line.remark);
      });
      return documentId;
    });
    try {
      const id = insert();
      recordAudit(request.user.id, "CREATE", "stock_document", id, `创建${documentLabels[type]}`, clientIp(request));
      return { document: getDocument(id) };
    } catch (error) {
      app.log.error({ err: error, documentType: type, userId: request.user.id }, "库存单据创建失败");
      throw app.httpErrors.conflict("库存单据创建失败，请检查商品、数量和必填字段");
    }
  });

  app.post<{
    Params: { id: string };
  }>("/api/inventory/documents/:id/submit", { preHandler: requirePermission("inventory.documents.view") }, async (request) => {
    const id = parseId(request.params.id, "库存单据");
    const document = getDocument(id);
    if (!document) throw app.httpErrors.notFound("库存单据不存在");
    if (!canViewDocument(request.user.id, document)) throw app.httpErrors.forbidden("当前账号没有该单据的数据范围");
    assertDocumentLifecycleScope(request.user.id, document);
    if (!hasPermissionForCreate(request.user.id, document.documentType)) throw app.httpErrors.forbidden("当前账号没有提交该单据的权限");
    if (document.status !== "draft") throw app.httpErrors.conflict("只有草稿单据可以提交");
    db.prepare(
      "UPDATE stock_documents SET status = 'submitted', submitted_by = ?, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(request.user.id, id);
    recordAudit(request.user.id, "SUBMIT", "stock_document", id, `提交${documentLabels[document.documentType]}`, clientIp(request));
    return { document: getDocument(id) };
  });

  app.post<{
    Params: { id: string };
  }>("/api/inventory/documents/:id/approve", { preHandler: requirePermission("inventory.documents.view") }, async (request) => {
    const id = parseId(request.params.id, "库存单据");
    const document = getDocument(id);
    if (!document) throw app.httpErrors.notFound("库存单据不存在");
    if (!canViewDocument(request.user.id, document)) throw app.httpErrors.forbidden("当前账号没有该单据的数据范围");
    assertDocumentLifecycleScope(request.user.id, document);
    if (!hasPermission(request.user.id, getDocumentPermission(document.documentType, "approve"))) {
      throw app.httpErrors.forbidden("当前账号没有审批该单据的权限");
    }
    assertDocumentApprovalSeparation(request.user.id, document, "approve");
    if (document.status !== "submitted") throw app.httpErrors.conflict("只有已提交单据可以审批");
    db.prepare(
      "UPDATE stock_documents SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(request.user.id, id);
    recordAudit(request.user.id, "APPROVE", "stock_document", id, `审批${documentLabels[document.documentType]}`, clientIp(request));
    return { document: getDocument(id) };
  });

  app.post<{
    Params: { id: string };
  }>("/api/inventory/documents/:id/post", { preHandler: requirePermission("inventory.documents.view") }, async (request) => {
    const id = parseId(request.params.id, "库存单据");
    const document = getDocument(id);
    if (!document) throw app.httpErrors.notFound("库存单据不存在");
    if (!canViewDocument(request.user.id, document)) throw app.httpErrors.forbidden("当前账号没有该单据的数据范围");
    if (!hasPermission(request.user.id, getDocumentPermission(document.documentType, "post"))) {
      throw app.httpErrors.forbidden("当前账号没有过账该单据的权限");
    }
    assertDocumentPostingScope(request.user.id, document);
    assertDocumentApprovalSeparation(request.user.id, document, "post");
    if (document.approvedBy === request.user.id) {
      throw app.httpErrors.forbidden("审批人不能过账本人审批的库存单据", 403);
    }
    if (document.status !== "approved") throw app.httpErrors.conflict("只有已审批单据可以过账");
    try {
      const post = db.transaction(() => {
        for (const line of document.lines as Array<{
          id: number;
          itemId: number;
          quantity: number;
          lotNo: string;
          serialNo: string;
        }>) {
          if (document.documentType === "receipt") {
            db.prepare(
              "INSERT INTO stock_ledger_entries (document_id, line_id, item_id, warehouse_id, quantity_delta, lot_no, serial_no) VALUES (?, ?, ?, ?, ?, ?, ?)"
            ).run(id, line.id, line.itemId, document.warehouseId, line.quantity, line.lotNo, line.serialNo);
          } else if (document.documentType === "issue" || document.documentType === "scrap") {
            const balance = getBalance(line.itemId, document.warehouseId!, line.lotNo, line.serialNo);
            if (balance < line.quantity) throw new Error(`商品 ${line.itemId} 可用库存不足，禁止负库存`);
            db.prepare(
              "INSERT INTO stock_ledger_entries (document_id, line_id, item_id, warehouse_id, quantity_delta, lot_no, serial_no) VALUES (?, ?, ?, ?, ?, ?, ?)"
            ).run(id, line.id, line.itemId, document.warehouseId, -line.quantity, line.lotNo, line.serialNo);
          } else if (document.documentType === "transfer") {
            const balance = getBalance(line.itemId, document.sourceWarehouseId!, line.lotNo, line.serialNo);
            if (balance < line.quantity) throw new Error(`商品 ${line.itemId} 调出库存不足，禁止负库存`);
            const insertLedger = db.prepare(
              "INSERT INTO stock_ledger_entries (document_id, line_id, item_id, warehouse_id, quantity_delta, lot_no, serial_no) VALUES (?, ?, ?, ?, ?, ?, ?)"
            );
            insertLedger.run(id, line.id, line.itemId, document.sourceWarehouseId, -line.quantity, line.lotNo, line.serialNo);
            insertLedger.run(id, line.id, line.itemId, document.targetWarehouseId, line.quantity, line.lotNo, line.serialNo);
          } else {
            const current = getBalance(line.itemId, document.warehouseId!, line.lotNo, line.serialNo);
            const delta = line.quantity - current;
            if (delta !== 0) {
              db.prepare(
                "INSERT INTO stock_ledger_entries (document_id, line_id, item_id, warehouse_id, quantity_delta, lot_no, serial_no) VALUES (?, ?, ?, ?, ?, ?, ?)"
              ).run(id, line.id, line.itemId, document.warehouseId, delta, line.lotNo, line.serialNo);
            }
          }
          }
          finalizeProductionTaskForPostedDocument(id);
          db.prepare(
            "UPDATE stock_documents SET status = 'posted', posted_by = ?, posted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(request.user.id, id);
      });
      post();
    } catch (error) {
      throw app.httpErrors.conflict(error instanceof Error ? error.message : "库存过账失败");
    }
    recordAudit(request.user.id, "POST", "stock_document", id, `过账${documentLabels[document.documentType]}`, clientIp(request));
    return { document: getDocument(id) };
  });

  app.post<{
    Params: { id: string };
  }>("/api/inventory/documents/:id/cancel", { preHandler: requirePermission("inventory.documents.view") }, async (request) => {
    const id = parseId(request.params.id, "库存单据");
    const document = getDocument(id);
    if (!document) throw app.httpErrors.notFound("库存单据不存在");
    if (!canViewDocument(request.user.id, document)) throw app.httpErrors.forbidden("当前账号没有该单据的数据范围");
    assertDocumentLifecycleScope(request.user.id, document);
    if (!hasPermissionForCreate(request.user.id, document.documentType)) throw app.httpErrors.forbidden("当前账号没有取消该单据的权限");
    if (!["draft", "submitted"].includes(document.status)) throw app.httpErrors.conflict("当前状态不可取消");
    db.prepare("UPDATE stock_documents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    recordAudit(request.user.id, "CANCEL", "stock_document", id, `取消${documentLabels[document.documentType]}`, clientIp(request));
    return { document: getDocument(id) };
  });
}

function hasPermissionForCreate(userId: number, type: InventoryDocumentType) {
  return hasPermission(userId, getDocumentPermission(type, "create"));
}
