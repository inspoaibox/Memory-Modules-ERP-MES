import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  canAccessDepartment,
  db,
  getUserDepartmentIds,
  hasPermission,
  isSystemAdmin,
  recordAudit
} from "./db.js";

type PermissionGuard = (code: string) => (request: FastifyRequest) => Promise<void>;
type ClientIp = (request: FastifyRequest) => string;
type SalesStatus = "draft" | "submitted" | "approved" | "partial_shipped" | "completed" | "cancelled";
type SalesOutputAction = "preview" | "print" | "download";

type SalesLineInput = {
  itemId?: unknown;
  warehouseId?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  lotNo?: unknown;
  serialNo?: unknown;
  remark?: unknown;
};

type SalesOrderBody = {
  businessDate?: string;
  customerName?: string;
  customerContact?: string;
  customerPhone?: string;
  customerAddress?: string;
  salesUserId?: unknown;
  remark?: string;
  lines?: SalesLineInput[];
};

type SalesLine = {
  id: number;
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  unitName: string | null;
  trackingMode: "none" | "lot" | "serial";
  warehouseId: number;
  warehouseName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  shippedQuantity: number;
  lotNo: string;
  serialNo: string;
  remark: string;
};

type SalesOrder = {
  id: number;
  salesOrderNo: string;
  status: SalesStatus;
  businessDate: string;
  customerName: string;
  customerContact: string;
  customerPhone: string;
  customerAddress: string;
  salesUserId: number | null;
  salesUserName: string | null;
  totalQuantity: number;
  totalAmount: number;
  totalShippedQuantity: number;
  remark: string;
  createdBy: number;
  createdByName: string;
  submittedBy: number | null;
  approvedBy: number | null;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: SalesLine[];
  issueDocuments: Array<{
    id: number;
    documentNo: string;
    status: string;
    warehouseId: number | null;
    warehouseName: string | null;
  }>;
};

const salesStatusLabels: Record<SalesStatus, string> = {
  draft: "草稿",
  submitted: "待审批",
  approved: "待发货",
  partial_shipped: "部分发货",
  completed: "已完成",
  cancelled: "已取消"
};

function requestError(message: string, statusCode = 400) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function throwRouteError(app: FastifyInstance, error: unknown): never {
  const message = error instanceof Error ? error.message : "销售单操作失败";
  const statusCode = error instanceof Error && "statusCode" in error
    ? Number((error as Error & { statusCode: number }).statusCode)
    : 400;
  if (statusCode === 403) throw app.httpErrors.forbidden(message);
  if (statusCode === 404) throw app.httpErrors.notFound(message);
  if (statusCode === 409) throw app.httpErrors.conflict(message);
  throw app.httpErrors.badRequest(message);
}

function parseId(value: unknown, label: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw requestError(`${label}不合法`);
  return id;
}

function parseQuantity(value: unknown, label: string) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) throw requestError(`${label}必须大于 0`);
  return quantity;
}

function parsePrice(value: unknown, label: string) {
  const price = Number(value ?? 0);
  if (!Number.isFinite(price) || price < 0) throw requestError(`${label}不能小于 0`);
  return price;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nextSalesOrderNo() {
  const date = today().replaceAll("-", "");
  const last = db
    .prepare("SELECT sales_order_no AS salesOrderNo FROM sales_orders WHERE sales_order_no LIKE ? ORDER BY id DESC LIMIT 1")
    .get(`SO-${date}-%`) as { salesOrderNo: string } | undefined;
  const lastNumber = last?.salesOrderNo.match(/-(\d+)$/)?.[1];
  return `SO-${date}-${String(Number(lastNumber ?? 0) + 1).padStart(4, "0")}`;
}

function nextIssueDocumentNo() {
  const date = today().replaceAll("-", "");
  const last = db
    .prepare("SELECT document_no AS documentNo FROM stock_documents WHERE document_no LIKE ? ORDER BY id DESC LIMIT 1")
    .get(`OUT-${date}-%`) as { documentNo: string } | undefined;
  const lastNumber = last?.documentNo.match(/-(\d+)$/)?.[1];
  return `OUT-${date}-${String(Number(lastNumber ?? 0) + 1).padStart(4, "0")}`;
}

function getActiveItem(itemId: number) {
  return db
    .prepare(
      `SELECT i.id, i.item_code AS itemCode, i.name, i.sales_price AS salesPrice,
              i.tracking_mode AS trackingMode, u.name AS unitName
       FROM items i
       LEFT JOIN units u ON u.id = i.unit_id
       WHERE i.id = ? AND i.status = 'active'`
    )
    .get(itemId) as
    | {
        id: number;
        itemCode: string;
        name: string;
        salesPrice: number;
        trackingMode: "none" | "lot" | "serial";
        unitName: string | null;
      }
    | undefined;
}

function getActiveWarehouse(warehouseId: number) {
  return db
    .prepare(
      `SELECT w.id, w.name, w.department_id AS departmentId, d.name AS departmentName
       FROM warehouses w
       INNER JOIN departments d ON d.id = w.department_id
       WHERE w.id = ? AND w.status = 'active'`
    )
    .get(warehouseId) as
    | { id: number; name: string; departmentId: number; departmentName: string }
    | undefined;
}

function parseLines(userId: number, lines: SalesLineInput[] | undefined) {
  if (!Array.isArray(lines) || !lines.length) throw requestError("请先选择至少一个销售商品");
  return lines.map((line, index) => {
    const itemId = parseId(line.itemId, `第 ${index + 1} 行商品`);
    const warehouseId = parseId(line.warehouseId, `第 ${index + 1} 行仓库`);
    const item = getActiveItem(itemId);
    if (!item) throw requestError(`第 ${index + 1} 行商品不存在或已停用`);
    const warehouse = getActiveWarehouse(warehouseId);
    if (!warehouse) throw requestError(`第 ${index + 1} 行仓库不存在或已停用`);
    if (!isSystemAdmin(userId) && !canAccessDepartment(userId, warehouse.departmentId)) {
      throw requestError(`第 ${index + 1} 行仓库不在当前账号数据范围内`, 403);
    }
    const quantity = parseQuantity(line.quantity, `第 ${index + 1} 行数量`);
    const lotNo = String(line.lotNo ?? "").trim();
    const serialNo = String(line.serialNo ?? "").trim();
    if (item.trackingMode === "lot" && !lotNo) throw requestError(`${item.name}必须填写批次号`);
    if (item.trackingMode === "serial" && (!serialNo || quantity !== 1)) {
      throw requestError(`${item.name}按序列号管理时，每行数量必须为 1 且填写序列号`);
    }
    const unitPrice = parsePrice(line.unitPrice ?? item.salesPrice, `第 ${index + 1} 行销售单价`);
    return {
      itemId,
      itemCode: item.itemCode,
      itemName: item.name,
      warehouseId,
      warehouseName: warehouse.name,
      departmentId: warehouse.departmentId,
      quantity,
      unitPrice,
      amount: quantity * unitPrice,
      lotNo,
      serialNo,
      remark: String(line.remark ?? "").trim()
    };
  });
}

function validateSalesUser(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const id = parseId(value, "销售负责人");
  const user = db
    .prepare("SELECT id FROM users WHERE id = ? AND status = 'active'")
    .get(id) as { id: number } | undefined;
  if (!user) throw requestError("销售负责人不存在或已停用");
  return user.id;
}

function getSalesOrder(id: number) {
  const order = db
    .prepare(
      `SELECT so.id, so.sales_order_no AS salesOrderNo, so.status,
              so.business_date AS businessDate, so.customer_name AS customerName,
              so.customer_contact AS customerContact, so.customer_phone AS customerPhone,
              so.customer_address AS customerAddress, so.sales_user_id AS salesUserId,
              seller.display_name AS salesUserName, so.total_quantity AS totalQuantity,
              so.total_amount AS totalAmount,
              COALESCE((SELECT SUM(shipped_quantity) FROM sales_order_lines WHERE sales_order_id = so.id), 0) AS totalShippedQuantity,
              so.remark, so.created_by AS createdBy, creator.display_name AS createdByName,
              so.submitted_by AS submittedBy, so.approved_by AS approvedBy,
              so.submitted_at AS submittedAt, so.approved_at AS approvedAt,
              so.created_at AS createdAt, so.updated_at AS updatedAt
       FROM sales_orders so
       INNER JOIN users creator ON creator.id = so.created_by
       LEFT JOIN users seller ON seller.id = so.sales_user_id
       WHERE so.id = ?`
    )
    .get(id) as SalesOrder | undefined;
  if (!order) return null;
  const lines = db
    .prepare(
      `SELECT sol.id, sol.line_no AS lineNo, sol.item_id AS itemId,
              i.item_code AS itemCode, i.name AS itemName, u.name AS unitName,
              i.tracking_mode AS trackingMode, sol.warehouse_id AS warehouseId,
              w.name AS warehouseName, sol.quantity, sol.unit_price AS unitPrice,
              sol.amount, sol.shipped_quantity AS shippedQuantity,
              sol.lot_no AS lotNo, sol.serial_no AS serialNo, sol.remark
       FROM sales_order_lines sol
       INNER JOIN items i ON i.id = sol.item_id
       LEFT JOIN units u ON u.id = i.unit_id
       INNER JOIN warehouses w ON w.id = sol.warehouse_id
       WHERE sol.sales_order_id = ?
       ORDER BY sol.line_no`
    )
    .all(id) as SalesLine[];
  const issueDocuments = db
    .prepare(
      `SELECT d.id, d.document_no AS documentNo, d.status,
              d.warehouse_id AS warehouseId, w.name AS warehouseName
       FROM stock_documents d
       LEFT JOIN warehouses w ON w.id = d.warehouse_id
       WHERE d.sales_order_id = ?
       ORDER BY d.id`
    )
    .all(id) as SalesOrder["issueDocuments"];
  return { ...order, lines, issueDocuments };
}

function canViewSalesOrder(userId: number, orderId: number) {
  if (isSystemAdmin(userId)) return true;
  const departmentIds = getUserDepartmentIds(userId);
  if (!departmentIds.length) return false;
  const placeholders = departmentIds.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT 1
       FROM sales_order_lines sol
       INNER JOIN warehouses w ON w.id = sol.warehouse_id
       WHERE sol.sales_order_id = ? AND w.department_id IN (${placeholders})
       LIMIT 1`
    )
    .get(orderId, ...departmentIds);
  return Boolean(row);
}

function assertSalesOrderView(userId: number, orderId: number) {
  if (!canViewSalesOrder(userId, orderId)) {
    throw requestError("当前账号没有该销售单的数据范围", 403);
  }
}

function assertCustomerName(value: unknown) {
  const name = String(value ?? "").trim();
  if (!name) throw requestError("销售方名称不能为空");
  return name;
}

function saveSalesOrder(userId: number, body: SalesOrderBody, orderId?: number) {
  const customerName = assertCustomerName(body.customerName);
  const lines = parseLines(userId, body.lines);
  const salesUserId = validateSalesUser(body.salesUserId);
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const totalAmount = lines.reduce((sum, line) => sum + line.amount, 0);
  const businessDate = String(body.businessDate ?? today()).trim() || today();
  const customerContact = String(body.customerContact ?? "").trim();
  const customerPhone = String(body.customerPhone ?? "").trim();
  const customerAddress = String(body.customerAddress ?? "").trim();
  const remark = String(body.remark ?? "").trim();

  const transaction = db.transaction(() => {
    let id = orderId;
    if (id === undefined) {
      const result = db
        .prepare(
          `INSERT INTO sales_orders
           (sales_order_no, status, business_date, customer_name, customer_contact,
            customer_phone, customer_address, sales_user_id, total_quantity,
            total_amount, remark, created_by)
           VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          nextSalesOrderNo(),
          businessDate,
          customerName,
          customerContact,
          customerPhone,
          customerAddress,
          salesUserId,
          totalQuantity,
          totalAmount,
          remark,
          userId
        );
      id = Number(result.lastInsertRowid);
    } else {
      const result = db
        .prepare(
          `UPDATE sales_orders
           SET business_date = ?, customer_name = ?, customer_contact = ?,
               customer_phone = ?, customer_address = ?, sales_user_id = ?,
               total_quantity = ?, total_amount = ?, remark = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'draft'`
        )
        .run(
          businessDate,
          customerName,
          customerContact,
          customerPhone,
          customerAddress,
          salesUserId,
          totalQuantity,
          totalAmount,
          remark,
          id
        );
      if (!result.changes) throw requestError("只有草稿销售单可以编辑", 409);
      db.prepare("DELETE FROM sales_order_lines WHERE sales_order_id = ?").run(id);
    }

    const insertLine = db.prepare(
      `INSERT INTO sales_order_lines
       (sales_order_id, line_no, item_id, warehouse_id, quantity, unit_price,
        amount, lot_no, serial_no, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    lines.forEach((line, index) => {
      insertLine.run(
        id,
        index + 1,
        line.itemId,
        line.warehouseId,
        line.quantity,
        line.unitPrice,
        line.amount,
        line.lotNo,
        line.serialNo,
        line.remark
      );
    });
    return id;
  });
  return transaction();
}

function updateOrderShippingProgress(orderId: number) {
  const lines = db
    .prepare(
      `SELECT quantity, shipped_quantity AS shippedQuantity
       FROM sales_order_lines
       WHERE sales_order_id = ?`
    )
    .all(orderId) as Array<{ quantity: number; shippedQuantity: number }>;
  if (!lines.length) return;
  const shipped = lines.reduce((sum, line) => sum + line.shippedQuantity, 0);
  const complete = lines.every((line) => line.shippedQuantity >= line.quantity - 0.000001);
  const status: SalesStatus = complete ? "completed" : shipped > 0 ? "partial_shipped" : "approved";
  db.prepare("UPDATE sales_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status <> 'cancelled'").run(
    status,
    orderId
  );
}

export function finalizeSalesOrderForPostedDocument(documentId: number) {
  const linked = db
    .prepare(
      `SELECT id, sales_order_id AS salesOrderId
       FROM stock_documents
       WHERE id = ? AND document_type = 'issue' AND sales_order_id IS NOT NULL`
    )
    .get(documentId) as { id: number; salesOrderId: number } | undefined;
  if (!linked) return;

  const orderLines = db
    .prepare(
      `SELECT sol.id, sol.quantity,
              COALESCE((
                SELECT SUM(sdl.quantity)
                FROM stock_document_lines sdl
                INNER JOIN stock_documents sd ON sd.id = sdl.document_id
                WHERE sdl.sales_order_line_id = sol.id
                  AND sd.document_type = 'issue'
                  AND sd.status = 'posted'
              ), 0) AS shippedQuantity
       FROM sales_order_lines sol
       WHERE sol.sales_order_id = ?`
    )
    .all(linked.salesOrderId) as Array<{ id: number; quantity: number; shippedQuantity: number }>;
  const updateLine = db.prepare(
    "UPDATE sales_order_lines SET shipped_quantity = ? WHERE id = ?"
  );
  for (const line of orderLines) {
    updateLine.run(Math.min(line.quantity, line.shippedQuantity), line.id);
  }
  updateOrderShippingProgress(linked.salesOrderId);
}

export async function registerSalesRoutes(
  app: FastifyInstance,
  dependencies: { requirePermission: PermissionGuard; clientIp: ClientIp }
) {
  const { requirePermission, clientIp } = dependencies;

  app.get<{
    Querystring: { status?: SalesStatus; keyword?: string };
  }>("/api/sales/orders", { preHandler: requirePermission("sales.orders.view") }, async (request) => {
    const clauses = ["1 = 1"];
    const params: Array<string | number> = [];
    if (request.query.status && Object.keys(salesStatusLabels).includes(request.query.status)) {
      clauses.push("so.status = ?");
      params.push(request.query.status);
    }
    if (request.query.keyword?.trim()) {
      clauses.push("(so.sales_order_no LIKE ? OR so.customer_name LIKE ? OR so.customer_phone LIKE ?)");
      const keyword = `%${request.query.keyword.trim()}%`;
      params.push(keyword, keyword, keyword);
    }
    if (!isSystemAdmin(request.user.id)) {
      const departmentIds = getUserDepartmentIds(request.user.id);
      if (!departmentIds.length) return { items: [] };
      const placeholders = departmentIds.map(() => "?").join(",");
      clauses.push(
        `EXISTS (
           SELECT 1
           FROM sales_order_lines scopedLine
           INNER JOIN warehouses scopedWarehouse ON scopedWarehouse.id = scopedLine.warehouse_id
           WHERE scopedLine.sales_order_id = so.id
             AND scopedWarehouse.department_id IN (${placeholders})
         )`
      );
      params.push(...departmentIds);
    }
    return {
      items: db
        .prepare(
          `SELECT so.id, so.sales_order_no AS salesOrderNo, so.status,
                  so.business_date AS businessDate, so.customer_name AS customerName,
                  so.customer_contact AS customerContact, so.customer_phone AS customerPhone,
                  so.total_quantity AS totalQuantity, so.total_amount AS totalAmount,
                  COALESCE((SELECT SUM(shipped_quantity) FROM sales_order_lines WHERE sales_order_id = so.id), 0) AS totalShippedQuantity,
                  so.created_by AS createdBy, creator.display_name AS createdByName,
                  seller.display_name AS salesUserName, so.created_at AS createdAt,
                  COUNT(sol.id) AS lineCount
           FROM sales_orders so
           INNER JOIN users creator ON creator.id = so.created_by
           LEFT JOIN users seller ON seller.id = so.sales_user_id
           LEFT JOIN sales_order_lines sol ON sol.sales_order_id = so.id
           WHERE ${clauses.join(" AND ")}
           GROUP BY so.id
           ORDER BY so.id DESC
           LIMIT 500`
        )
        .all(...params)
    };
  });

  app.get("/api/sales/options", { preHandler: requirePermission("sales.orders.view") }, async () => ({
    users: db
      .prepare("SELECT id, display_name AS displayName, employee_no AS employeeNo FROM users WHERE status = 'active' ORDER BY display_name, id")
      .all(),
    statusLabels: salesStatusLabels
  }));

  app.get<{
    Params: { id: string };
  }>("/api/sales/orders/:id", { preHandler: requirePermission("sales.orders.view") }, async (request) => {
    const id = parseId(request.params.id, "销售单");
    const order = getSalesOrder(id);
    if (!order) throw app.httpErrors.notFound("销售单不存在");
    assertSalesOrderView(request.user.id, id);
    return { order };
  });

  app.post<{
    Body: SalesOrderBody;
  }>("/api/sales/orders", { preHandler: requirePermission("sales.orders.manage") }, async (request) => {
    try {
      const id = saveSalesOrder(request.user.id, request.body);
      recordAudit(request.user.id, "CREATE", "sales_order", id, "创建销售单", clientIp(request));
      return { order: getSalesOrder(id) };
    } catch (error) {
      if (error instanceof Error && "statusCode" in error) {
        throwRouteError(app, error);
      }
      app.log.error({ err: error, userId: request.user.id }, "销售单创建失败");
      throw app.httpErrors.conflict("销售单创建失败，请检查客户、商品、仓库和数量");
    }
  });

  app.put<{
    Params: { id: string };
    Body: SalesOrderBody;
  }>("/api/sales/orders/:id", { preHandler: requirePermission("sales.orders.manage") }, async (request) => {
    const id = parseId(request.params.id, "销售单");
    const order = getSalesOrder(id);
    if (!order) throw app.httpErrors.notFound("销售单不存在");
    assertSalesOrderView(request.user.id, id);
    if (order.status !== "draft") throw app.httpErrors.conflict("只有草稿销售单可以编辑");
    try {
      saveSalesOrder(request.user.id, request.body, id);
      recordAudit(request.user.id, "UPDATE", "sales_order", id, `编辑销售单 ${order.salesOrderNo}`, clientIp(request));
      return { order: getSalesOrder(id) };
    } catch (error) {
      if (error instanceof Error && "statusCode" in error) {
        throwRouteError(app, error);
      }
      throw app.httpErrors.conflict("销售单更新失败，请检查客户、商品、仓库和数量");
    }
  });

  app.post<{
    Params: { id: string };
  }>("/api/sales/orders/:id/submit", { preHandler: requirePermission("sales.orders.manage") }, async (request) => {
    const id = parseId(request.params.id, "销售单");
    const order = getSalesOrder(id);
    if (!order) throw app.httpErrors.notFound("销售单不存在");
    assertSalesOrderView(request.user.id, id);
    if (order.status !== "draft") throw app.httpErrors.conflict("只有草稿销售单可以提交");
    db.prepare("UPDATE sales_orders SET status = 'submitted', submitted_by = ?, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      request.user.id,
      id
    );
    recordAudit(request.user.id, "SUBMIT", "sales_order", id, `提交销售单 ${order.salesOrderNo}`, clientIp(request));
    return { order: getSalesOrder(id) };
  });

  app.post<{
    Params: { id: string };
  }>("/api/sales/orders/:id/approve", { preHandler: requirePermission("sales.orders.approve") }, async (request) => {
    const id = parseId(request.params.id, "销售单");
    const order = getSalesOrder(id);
    if (!order) throw app.httpErrors.notFound("销售单不存在");
    assertSalesOrderView(request.user.id, id);
    if (order.status !== "submitted") throw app.httpErrors.conflict("只有待审批销售单可以审批");
    if (order.createdBy === request.user.id && !isSystemAdmin(request.user.id)) {
      throw app.httpErrors.forbidden("制单人不能审批本人创建的销售单");
    }
    try {
      db.transaction(() => {
        const existing = (
          db.prepare("SELECT COUNT(*) AS count FROM stock_documents WHERE sales_order_id = ? AND status <> 'cancelled'").get(id) as {
            count: number;
          }
        ).count;
        if (existing > 0) throw requestError("该销售单已经生成销售出库单", 409);
        const insertDocument = db.prepare(
          `INSERT INTO stock_documents
           (document_no, document_type, status, business_date, department_id,
            warehouse_id, reference_no, reason, remark, created_by, sales_order_id)
           VALUES (?, 'issue', 'draft', ?, ?, ?, ?, '销售出库', ?, ?, ?)`
        );
        const insertLine = db.prepare(
          `INSERT INTO stock_document_lines
           (document_id, line_no, item_id, quantity, lot_no, serial_no, remark, sales_order_line_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const linesByWarehouse = new Map<number, SalesLine[]>();
        for (const line of order.lines) {
          const lines = linesByWarehouse.get(line.warehouseId) ?? [];
          lines.push(line);
          linesByWarehouse.set(line.warehouseId, lines);
        }
        for (const [warehouseId, lines] of linesByWarehouse) {
          const warehouse = getActiveWarehouse(warehouseId);
          if (!warehouse) throw requestError("销售单中的仓库已停用，无法生成出库单", 409);
          const documentResult = insertDocument.run(
            nextIssueDocumentNo(),
            order.businessDate,
            warehouse.departmentId,
            warehouseId,
            order.salesOrderNo,
            `销售跟单 ${order.salesOrderNo}`,
            order.remark,
            request.user.id,
            id
          );
          const documentId = Number(documentResult.lastInsertRowid);
          lines.forEach((line, index) => {
            insertLine.run(
              documentId,
              index + 1,
              line.itemId,
              line.quantity,
              line.lotNo,
              line.serialNo,
              line.remark,
              line.id
            );
          });
        }
        db.prepare("UPDATE sales_orders SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
          request.user.id,
          id
        );
      })();
    } catch (error) {
      if (error instanceof Error && "statusCode" in error) {
        throwRouteError(app, error);
      }
      app.log.error({ err: error, salesOrderId: id }, "销售单审批失败");
      throw app.httpErrors.conflict("销售单审批失败，无法生成销售出库单");
    }
    recordAudit(request.user.id, "APPROVE", "sales_order", id, `审批销售单 ${order.salesOrderNo} 并生成出库单`, clientIp(request));
    return { order: getSalesOrder(id) };
  });

  app.post<{
    Params: { id: string };
  }>("/api/sales/orders/:id/cancel", { preHandler: requirePermission("sales.orders.manage") }, async (request) => {
    const id = parseId(request.params.id, "销售单");
    const order = getSalesOrder(id);
    if (!order) throw app.httpErrors.notFound("销售单不存在");
    assertSalesOrderView(request.user.id, id);
    if (!["draft", "submitted"].includes(order.status)) throw app.httpErrors.conflict("当前状态不可取消");
    db.prepare("UPDATE sales_orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    recordAudit(request.user.id, "CANCEL", "sales_order", id, `取消销售单 ${order.salesOrderNo}`, clientIp(request));
    return { order: getSalesOrder(id) };
  });

  app.post<{
    Params: { id: string };
    Body: { action?: SalesOutputAction };
  }>("/api/sales/orders/:id/output-actions", { preHandler: requirePermission("sales.orders.view") }, async (request) => {
    const id = parseId(request.params.id, "销售单");
    const action = request.body.action;
    if (!action || !["preview", "print", "download"].includes(action)) {
      throw app.httpErrors.badRequest("销售单输出操作不合法");
    }
    const order = getSalesOrder(id);
    if (!order) throw app.httpErrors.notFound("销售单不存在");
    assertSalesOrderView(request.user.id, id);
    const actionLabels: Record<SalesOutputAction, string> = { preview: "预览", print: "打印", download: "下载" };
    recordAudit(request.user.id, action.toUpperCase(), "sales_order", id, `${actionLabels[action]}销售单 ${order.salesOrderNo}`, clientIp(request));
    return { ok: true };
  });
}
