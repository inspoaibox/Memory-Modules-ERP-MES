import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  canAccessDepartment,
  db,
  getUserDepartmentIds,
  hasPermission,
  isSystemAdmin,
  recordAudit,
  type WarehouseType,
  warehouseTypeLabels
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
type TaskOutputAction = "preview" | "print" | "download";

type ProcessRow = {
  id: number;
  code: string;
  name: string;
  processType: ProcessType;
  status: "active" | "inactive";
};

type ItemRow = {
  id: number;
  itemCode: string;
  name: string;
  trackingMode: "none" | "lot" | "serial";
  status: "active" | "inactive";
};

type WarehouseRow = {
  id: number;
  code: string;
  name: string;
  departmentId: number;
  warehouseType: WarehouseType;
  status: "active" | "inactive";
};

type RouteStepRow = {
  id: number;
  routeId: number;
  processId: number;
  processCode: string;
  processName: string;
  processType: ProcessType;
  stepNo: number;
  defaultDepartmentId: number | null;
  defaultDepartmentName: string | null;
  outputTarget: OutputTarget;
  outputItemId: number | null;
  outputItemCode: string | null;
  outputItemName: string | null;
  outputWarehouseId: number | null;
  outputWarehouseName: string | null;
  qualityGate: number;
  description: string;
};

type WorkOrderRow = {
  id: number;
  workOrderNo: string;
  productItemId: number;
  productItemCode: string;
  productItemName: string;
  routeId: number;
  routeName: string;
  routeProductItemId: number | null;
  startProcessId: number | null;
  startProcessCode: string | null;
  startProcessName: string | null;
  departmentId: number;
  departmentName: string;
  managerUserId: number | null;
  managerName: string | null;
  plannedQuantity: number;
  status: WorkOrderStatus;
  executionStatus: WorkOrderExecutionStatus;
  terminationType: WorkOrderTerminationType;
  priority: WorkOrderPriority;
  plannedStartDate: string;
  plannedEndDate: string;
  remark: string;
  createdBy: number;
  createdByName: string;
  releasedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: WorkOrderItemRow[];
};

type WorkOrderItemRow = {
  id: number;
  workOrderId: number;
  lineNo: number;
  productItemId: number;
  productItemCode: string;
  productItemName: string;
  productTrackingMode: "none" | "lot" | "serial";
  routeId: number;
  routeCode: string;
  routeName: string;
  routeProductItemId: number | null;
  plannedQuantity: number;
  goodQuantity: number;
  defectQuantity: number;
  scrapQuantity: number;
  remark: string;
};

type TaskRow = {
  id: number;
  taskNo: string;
  workOrderId: number;
  workOrderItemId: number | null;
  workOrderItemLineNo: number;
  workOrderNo: string;
  workOrderDepartmentId: number;
  executionStatus: WorkOrderExecutionStatus;
  terminationType: WorkOrderTerminationType;
  productItemId: number;
  productItemCode: string;
  productItemName: string;
  productTrackingMode: "none" | "lot" | "serial";
  itemRouteId: number | null;
  itemRouteName: string | null;
  routeStepId: number | null;
  processId: number;
  processCode: string;
  processName: string;
  processType: ProcessType;
  sequenceNo: number;
  assignedDepartmentId: number | null;
  assignedDepartmentName: string | null;
  assignedUserId: number | null;
  assignedUserName: string | null;
  outputTarget: OutputTarget;
  outputItemId: number | null;
  outputItemCode: string | null;
  outputItemName: string | null;
  outputWarehouseId: number | null;
  outputWarehouseName: string | null;
  outputDocumentId: number | null;
  outputDocumentNo: string | null;
  qualityGate: number;
  flowStatus: TaskFlowStatus;
  plannedQuantity: number;
  inputQuantity: number;
  goodQuantity: number;
  outputQuantity: number;
  defectQuantity: number;
  reworkQuantity: number;
  scrapQuantity: number;
  outputLotNo: string;
  outputSerialNo: string;
  status: TaskStatus;
  remark: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

function businessError(message: string, statusCode = 400) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nextDailyCode(prefix: string, table: string, column: string) {
  const date = today().replaceAll("-", "");
  const last = db
    .prepare(`SELECT ${column} AS code FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(`${prefix}-${date}-%`) as { code: string } | undefined;
  const lastNumber = last?.code.match(/-(\d+)$/)?.[1];
  return `${prefix}-${date}-${String(Number(lastNumber ?? 0) + 1).padStart(4, "0")}`;
}

function nextPlainCode(prefix: string, table: string, column: string) {
  const last = db
    .prepare(`SELECT ${column} AS code FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(`${prefix}-%`) as { code: string } | undefined;
  const lastNumber = last?.code.match(/-(\d+)$/)?.[1];
  return `${prefix}-${String(Number(lastNumber ?? 0) + 1).padStart(4, "0")}`;
}

function parseId(value: unknown, label: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw businessError(`${label}不合法`);
  return id;
}

function parseOptionalId(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  return parseId(value, label);
}

function parseQuantity(value: unknown, label: string, allowZero = false) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0 || (!allowZero && quantity <= 0)) {
    throw businessError(allowZero ? `${label}不能小于 0` : `${label}必须大于 0`);
  }
  return quantity;
}

type OperationValue = string | number | boolean | string[];
type OperationRow = Record<string, OperationValue>;
type OperationData = Record<string, OperationValue | OperationRow[]>;

function normalizeOperationData(value: unknown) {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "object" || Array.isArray(value)) throw businessError("工序作业项数据格式不合法");
  const normalized: OperationData = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
    const fieldKey = key.trim();
    if (!fieldKey) continue;
    const normalizedValue = normalizeOperationValue(entry);
    if (normalizedValue !== undefined) normalized[fieldKey] = normalizedValue;
  }
  return normalized;
}

function normalizeOperationValue(value: unknown): OperationValue | OperationRow[] | undefined {
  if (typeof value === "string") return value.trim().slice(0, 500);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (!Array.isArray(value)) return undefined;
  if (value.every((item) => typeof item === "string")) {
    return value
      .map((item) => item.trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 30);
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    .slice(0, 100)
    .map((item) => {
      const row: OperationRow = {};
      for (const [key, entry] of Object.entries(item).slice(0, 30)) {
        const fieldKey = key.trim();
        const normalizedEntry = normalizeOperationValue(entry);
        if (!fieldKey || normalizedEntry === undefined || Array.isArray(normalizedEntry) && normalizedEntry.some((part) => typeof part === "object")) continue;
        row[fieldKey] = normalizedEntry as OperationValue;
      }
      return row;
    });
}

function parseOperationData(value: string | null | undefined): OperationData {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return normalizeOperationData(parsed);
  } catch {
    return {};
  }
}

function getItem(id: number) {
  return db
    .prepare("SELECT id, item_code AS itemCode, name, tracking_mode AS trackingMode, status FROM items WHERE id = ?")
    .get(id) as ItemRow | undefined;
}

function getWarehouse(id: number) {
  return db
    .prepare("SELECT id, code, name, department_id AS departmentId, warehouse_type AS warehouseType, status FROM warehouses WHERE id = ?")
    .get(id) as WarehouseRow | undefined;
}

function ensureProductionOutputWarehouse(outputTarget: "semi_finished" | "finished_goods", warehouse: WarehouseRow, label = "输出仓库") {
  const expectedType = outputTarget === "semi_finished" ? "semi_finished" : "finished_goods";
  if (warehouse.warehouseType !== expectedType) {
    throw businessError(`${label}必须是${warehouseTypeLabels[expectedType]}`);
  }
}

function getActiveDepartment(id: number, label = "部门") {
  const department = db
    .prepare("SELECT id, name FROM departments WHERE id = ? AND status = 'active'")
    .get(id) as { id: number; name: string } | undefined;
  if (!department) throw businessError(`${label}不存在或已停用`);
  return department;
}

function getActiveUser(id: number) {
  return db
    .prepare(
      `SELECT u.id, u.display_name AS displayName, u.department_id AS departmentId, u.status,
              d.name AS departmentName
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = ?`
    )
    .get(id) as
    | { id: number; displayName: string; departmentId: number | null; departmentName: string | null; status: "active" | "inactive" }
    | undefined;
}

function getProcess(id: number) {
  return db
    .prepare(
      "SELECT id, code, name, process_type AS processType, status FROM production_processes WHERE id = ?"
    )
    .get(id) as ProcessRow | undefined;
}

function getProcessAuthorization(processId: number) {
  const roleIds = (
    db
      .prepare("SELECT role_id AS id FROM production_process_role_authorizations WHERE process_id = ? ORDER BY role_id")
      .all(processId) as Array<{ id: number }>
  ).map((row) => row.id);
  const userIds = (
    db
      .prepare("SELECT user_id AS id FROM production_process_user_authorizations WHERE process_id = ? ORDER BY user_id")
      .all(processId) as Array<{ id: number }>
  ).map((row) => row.id);
  return { roleIds, userIds };
}

function isUserAuthorizedForProcess(userId: number, processId: number) {
  if (isSystemAdmin(userId)) return true;
  const authorized = db
    .prepare(
      `SELECT 1
       WHERE EXISTS (
         SELECT 1 FROM production_process_user_authorizations
         WHERE process_id = ? AND user_id = ?
       )
       OR EXISTS (
         SELECT 1
         FROM production_process_role_authorizations pra
         INNER JOIN user_roles ur ON ur.role_id = pra.role_id
         INNER JOIN roles r ON r.id = ur.role_id
         WHERE pra.process_id = ? AND ur.user_id = ? AND r.status = 'active'
       )`
    )
    .get(processId, userId, processId, userId);
  return Boolean(authorized);
}

function assertRepairProcessAuthorization(userId: number) {
  if (isSystemAdmin(userId)) return;
  const repairProcess = db
    .prepare("SELECT id FROM production_processes WHERE code = 'PROC-REPAIR' AND status = 'active'")
    .get() as { id: number } | undefined;
  if (!repairProcess || !isUserAuthorizedForProcess(userId, repairProcess.id)) {
    throw businessError("当前账号没有不良维修工序授权", 403);
  }
}

function assertRepairOwnerEligibility(userId: number, task: TaskRow) {
  const owner = getActiveUser(userId);
  if (!owner || owner.status !== "active") throw businessError("维修负责人不存在或已停用");
  if (!hasPermission(userId, "production.repairs.manage")) {
    throw businessError("维修负责人没有不良维修处理权限");
  }
  assertRepairProcessAuthorization(userId);
  if (
    !canAccessDepartment(userId, task.workOrderDepartmentId) &&
    (task.assignedDepartmentId === null || !canAccessDepartment(userId, task.assignedDepartmentId))
  ) {
    throw businessError("维修负责人必须属于来源工单或工序执行部门范围");
  }
  return owner;
}

function assertProcessCodeAuthorization(userId: number, processCode: string) {
  const process = db
    .prepare(
      `SELECT id, code, name, process_type AS processType, status
       FROM production_processes
       WHERE code = ? AND status = 'active'`
    )
    .get(processCode) as ProcessRow | undefined;
  if (!process) throw businessError("工序不存在或已停用", 404);
  if (!isSystemAdmin(userId) && !isUserAuthorizedForProcess(userId, process.id)) {
    throw businessError("当前账号没有该工序授权", 403);
  }
  return process;
}

function isUserAuthorizedForRepairProcess(userId: number) {
  const repairProcess = db
    .prepare("SELECT id FROM production_processes WHERE code = 'PROC-REPAIR' AND status = 'active'")
    .get() as { id: number } | undefined;
  return Boolean(repairProcess && isUserAuthorizedForProcess(userId, repairProcess.id));
}

function hasDepartmentManagementAuthority(userId: number) {
  return (
    isSystemAdmin(userId) ||
    hasPermission(userId, "production.workorders.manage") ||
    hasPermission(userId, "production.tasks.manage")
  );
}

function getRoute(id: number) {
  return db
    .prepare(
      `SELECT r.id, r.code, r.name, r.product_item_id AS productItemId,
              i.item_code AS productItemCode, i.name AS productItemName,
              r.description, r.status
       FROM production_routes r
       LEFT JOIN items i ON i.id = r.product_item_id
       WHERE r.id = ?`
    )
    .get(id) as
    | {
        id: number;
        code: string;
        name: string;
        productItemId: number | null;
        productItemCode: string | null;
        productItemName: string | null;
        description: string;
        status: "active" | "inactive";
      }
    | undefined;
}

function getRouteSteps(routeId: number) {
  return db
    .prepare(
      `SELECT s.id, s.route_id AS routeId, s.process_id AS processId, p.code AS processCode,
              p.name AS processName, p.process_type AS processType, s.step_no AS stepNo,
              s.default_department_id AS defaultDepartmentId, d.name AS defaultDepartmentName,
              s.output_target AS outputTarget, s.output_item_id AS outputItemId,
              oi.item_code AS outputItemCode, oi.name AS outputItemName,
              s.output_warehouse_id AS outputWarehouseId, ow.name AS outputWarehouseName,
              s.quality_gate AS qualityGate, s.description
       FROM production_route_steps s
       INNER JOIN production_processes p ON p.id = s.process_id
       LEFT JOIN departments d ON d.id = s.default_department_id
       LEFT JOIN items oi ON oi.id = s.output_item_id
       LEFT JOIN warehouses ow ON ow.id = s.output_warehouse_id
       WHERE s.route_id = ?
       ORDER BY s.step_no`
    )
    .all(routeId) as RouteStepRow[];
}

function getWorkOrder(id: number) {
  const workOrder = db
    .prepare(
      `SELECT wo.id, wo.work_order_no AS workOrderNo, wo.product_item_id AS productItemId,
              i.item_code AS productItemCode, i.name AS productItemName,
              wo.route_id AS routeId, r.name AS routeName, r.product_item_id AS routeProductItemId,
              wo.start_process_id AS startProcessId, start_process.code AS startProcessCode,
              start_process.name AS startProcessName,
              wo.department_id AS departmentId, d.name AS departmentName,
              wo.manager_user_id AS managerUserId, manager.display_name AS managerName,
              wo.planned_quantity AS plannedQuantity, wo.status,
              wo.execution_status AS executionStatus, wo.termination_type AS terminationType,
              wo.priority,
              wo.planned_start_date AS plannedStartDate, wo.planned_end_date AS plannedEndDate,
              wo.remark, wo.created_by AS createdBy, creator.display_name AS createdByName,
              wo.released_at AS releasedAt, wo.completed_at AS completedAt,
              wo.created_at AS createdAt, wo.updated_at AS updatedAt
       FROM production_work_orders wo
       INNER JOIN items i ON i.id = wo.product_item_id
       INNER JOIN production_routes r ON r.id = wo.route_id
       LEFT JOIN production_processes start_process ON start_process.id = wo.start_process_id
       INNER JOIN departments d ON d.id = wo.department_id
       LEFT JOIN users manager ON manager.id = wo.manager_user_id
       INNER JOIN users creator ON creator.id = wo.created_by
       WHERE wo.id = ?`
    )
    .get(id) as WorkOrderRow | undefined;
  return workOrder ? { ...workOrder, items: getWorkOrderItems(id) } : undefined;
}

function getWorkOrderItems(workOrderId: number) {
  return db
    .prepare(
      `SELECT woi.id, woi.work_order_id AS workOrderId, woi.line_no AS lineNo,
              woi.product_item_id AS productItemId, i.item_code AS productItemCode,
              i.name AS productItemName, i.tracking_mode AS productTrackingMode,
              woi.route_id AS routeId, r.code AS routeCode, r.name AS routeName,
              r.product_item_id AS routeProductItemId,
              woi.planned_quantity AS plannedQuantity, woi.good_quantity AS goodQuantity,
              woi.defect_quantity AS defectQuantity, woi.scrap_quantity AS scrapQuantity,
              woi.remark
       FROM production_work_order_items woi
       INNER JOIN items i ON i.id = woi.product_item_id
       INNER JOIN production_routes r ON r.id = woi.route_id
       WHERE woi.work_order_id = ?
       ORDER BY woi.line_no`
    )
    .all(workOrderId) as WorkOrderItemRow[];
}

function assertWorkOrderAccess(userId: number, workOrder: WorkOrderRow) {
  if (!canAccessDepartment(userId, workOrder.departmentId)) {
    throw businessError("当前账号没有该生产工单的数据范围", 403);
  }
}

function assertWorkOrderExecutionAvailable(executionStatus: WorkOrderExecutionStatus) {
  if (executionStatus === "paused") throw businessError("生产工单已暂停，当前不能执行该操作", 409);
  if (executionStatus === "terminated") throw businessError("生产工单已终止，不能继续执行", 409);
}

function getTask(id: number) {
  return db
    .prepare(
      `SELECT t.id, t.task_no AS taskNo, t.work_order_id AS workOrderId,
              t.work_order_item_id AS workOrderItemId, COALESCE(woi.line_no, 1) AS workOrderItemLineNo,
              wo.work_order_no AS workOrderNo, wo.department_id AS workOrderDepartmentId,
              COALESCE(woi.product_item_id, wo.product_item_id) AS productItemId, i.item_code AS productItemCode,
              i.name AS productItemName, i.tracking_mode AS productTrackingMode,
              woi.route_id AS itemRouteId, item_route.name AS itemRouteName,
              t.route_step_id AS routeStepId, t.process_id AS processId,
              p.code AS processCode, p.name AS processName, p.process_type AS processType, t.sequence_no AS sequenceNo,
              t.assigned_department_id AS assignedDepartmentId, ad.name AS assignedDepartmentName,
              t.assigned_user_id AS assignedUserId, au.display_name AS assignedUserName,
              t.output_target AS outputTarget, t.output_item_id AS outputItemId,
              oi.item_code AS outputItemCode, oi.name AS outputItemName,
              t.output_warehouse_id AS outputWarehouseId, ow.name AS outputWarehouseName,
              t.output_document_id AS outputDocumentId, od.document_no AS outputDocumentNo,
              t.quality_gate AS qualityGate, t.flow_status AS flowStatus,
              wo.execution_status AS executionStatus,
              wo.termination_type AS terminationType,
              t.planned_quantity AS plannedQuantity, t.input_quantity AS inputQuantity,
              t.good_quantity AS goodQuantity, t.output_quantity AS outputQuantity,
              t.defect_quantity AS defectQuantity,
              t.rework_quantity AS reworkQuantity, t.scrap_quantity AS scrapQuantity,
              t.output_lot_no AS outputLotNo, t.output_serial_no AS outputSerialNo,
              t.status, t.remark, t.started_at AS startedAt, t.completed_at AS completedAt,
              t.created_at AS createdAt
       FROM production_tasks t
       INNER JOIN production_work_orders wo ON wo.id = t.work_order_id
       LEFT JOIN production_work_order_items woi ON woi.id = t.work_order_item_id
       INNER JOIN items i ON i.id = COALESCE(woi.product_item_id, wo.product_item_id)
       LEFT JOIN production_routes item_route ON item_route.id = woi.route_id
       INNER JOIN production_processes p ON p.id = t.process_id
       LEFT JOIN departments ad ON ad.id = t.assigned_department_id
       LEFT JOIN users au ON au.id = t.assigned_user_id
       LEFT JOIN items oi ON oi.id = t.output_item_id
       LEFT JOIN warehouses ow ON ow.id = t.output_warehouse_id
       LEFT JOIN stock_documents od ON od.id = t.output_document_id
       WHERE t.id = ?`
    )
    .get(id) as TaskRow | undefined;
}

function canViewTask(userId: number, task: TaskRow) {
  if (isSystemAdmin(userId) || task.assignedUserId === userId) return true;
  if (!hasDepartmentManagementAuthority(userId)) return false;
  return (
    canAccessDepartment(userId, task.workOrderDepartmentId) ||
    (task.assignedDepartmentId !== null && canAccessDepartment(userId, task.assignedDepartmentId))
  );
}

function assertTaskViewAccess(userId: number, taskId: number) {
  const task = getTask(taskId);
  if (!task) throw businessError("工序任务不存在", 404);
  if (!canViewTask(userId, task)) throw businessError("当前账号没有该工序任务的数据范围", 403);
  return task;
}

function assertTaskManageAccess(userId: number, taskId: number) {
  const task = getTask(taskId);
  if (!task) throw businessError("工序任务不存在", 404);
  const canManageWorkOrderDepartment = canAccessDepartment(userId, task.workOrderDepartmentId);
  const canManageAssignedDepartment = task.assignedDepartmentId !== null && canAccessDepartment(userId, task.assignedDepartmentId);
  if (!isSystemAdmin(userId) && !hasDepartmentManagementAuthority(userId)) {
    throw businessError("当前账号没有工序任务派工权限", 403);
  }
  if (!isSystemAdmin(userId) && !canManageWorkOrderDepartment && !canManageAssignedDepartment) {
    throw businessError("当前账号没有该工单的派工管理范围", 403);
  }
  assertWorkOrderExecutionAvailable(task.executionStatus);
  return task;
}

function assertTaskExecutionAccess(userId: number, taskId: number) {
  const task = assertTaskViewAccess(userId, taskId);
  assertWorkOrderExecutionAvailable(task.executionStatus);
  if (isSystemAdmin(userId)) return task;
  if (!task.assignedDepartmentId || !task.assignedUserId) {
    throw businessError("任务尚未派工到执行部门和员工", 409);
  }
  if (task.assignedUserId !== userId) throw businessError("该任务已派给其他员工执行", 403);
  if (!canAccessDepartment(userId, task.assignedDepartmentId)) {
    throw businessError("当前账号不属于该任务执行部门", 403);
  }
  if (!hasPermission(userId, "production.operations.execute") || !isUserAuthorizedForProcess(userId, task.processId)) {
    throw businessError("当前账号没有该工序的执行授权", 403);
  }
  return task;
}

function canManageRepair(userId: number, task: TaskRow, ownerUserId: number | null) {
  return (
    isSystemAdmin(userId) ||
    ownerUserId === userId ||
    (hasDepartmentManagementAuthority(userId) &&
      (canAccessDepartment(userId, task.workOrderDepartmentId) ||
        (task.assignedDepartmentId !== null && canAccessDepartment(userId, task.assignedDepartmentId))))
  );
}

function canManageTaskDepartment(userId: number, task: TaskRow) {
  return (
    isSystemAdmin(userId) ||
    (hasDepartmentManagementAuthority(userId) &&
      (canAccessDepartment(userId, task.workOrderDepartmentId) ||
        (task.assignedDepartmentId !== null && canAccessDepartment(userId, task.assignedDepartmentId))))
  );
}

function assertRepairManageAccess(userId: number, task: TaskRow, ownerUserId: number | null) {
  if (!canManageRepair(userId, task, ownerUserId)) {
    throw businessError("当前账号没有该维修单的数据范围", 403);
  }
}

function assertRepairAssignmentAccess(userId: number, task: TaskRow) {
  if (!canManageTaskDepartment(userId, task)) {
    throw businessError("当前账号没有该维修单的派修管理范围", 403);
  }
}

function taskScopeWhere(userId: number, workOrderAlias = "wo", taskAlias = "t") {
  if (isSystemAdmin(userId)) return { clause: "1 = 1", params: [] as number[] };
  if (!hasDepartmentManagementAuthority(userId)) {
    return { clause: `${taskAlias}.assigned_user_id = ?`, params: [userId] };
  }
  return departmentTaskScopeWhere(userId, workOrderAlias, taskAlias);
}

function departmentTaskScopeWhere(userId: number, workOrderAlias = "wo", taskAlias = "t") {
  if (isSystemAdmin(userId)) return { clause: "1 = 1", params: [] as number[] };
  const departmentIds = getUserDepartmentIds(userId);
  if (!departmentIds.length) {
    return { clause: `${taskAlias}.assigned_user_id = ?`, params: [userId] };
  }
  const placeholders = departmentIds.map(() => "?").join(",");
  return {
    clause: `(${workOrderAlias}.department_id IN (${placeholders})
      OR COALESCE(${taskAlias}.assigned_department_id, ${workOrderAlias}.department_id) IN (${placeholders})
      OR ${taskAlias}.assigned_user_id = ?)`,
    params: [...departmentIds, ...departmentIds, userId]
  };
}

function repairScopeWhere(userId: number, repairAlias = "r", workOrderAlias = "wo", taskAlias = "t") {
  const taskScope = taskScopeWhere(userId, workOrderAlias, taskAlias);
  if (isSystemAdmin(userId)) return taskScope;
  const repairProcessScope = hasPermission(userId, "production.repairs.view") && isUserAuthorizedForRepairProcess(userId)
    ? departmentTaskScopeWhere(userId, workOrderAlias, taskAlias)
    : null;
  if (repairProcessScope) {
    return {
      clause: `(${taskScope.clause} OR ${repairAlias}.owner_user_id = ? OR ${repairProcessScope.clause})`,
      params: [...taskScope.params, userId, ...repairProcessScope.params]
    };
  }
  return {
    clause: `(${taskScope.clause} OR ${repairAlias}.owner_user_id = ?)`,
    params: [...taskScope.params, userId]
  };
}

function qualityScopeWhere(userId: number, qualityAlias = "qc", workOrderAlias = "wo", taskAlias = "t") {
  const taskScope = taskScopeWhere(userId, workOrderAlias, taskAlias);
  if (isSystemAdmin(userId)) return taskScope;
  if (!hasPermission(userId, "quality.inspection.manage")) return taskScope;
  const departmentScope = departmentTaskScopeWhere(userId, workOrderAlias, taskAlias);
  return {
    clause: `(${taskScope.clause} OR (${departmentScope.clause} AND (EXISTS (
      SELECT 1
      FROM production_process_user_authorizations quality_user_auth
      WHERE quality_user_auth.process_id = ${qualityAlias}.process_id AND quality_user_auth.user_id = ?
    ) OR EXISTS (
      SELECT 1
      FROM production_process_role_authorizations quality_role_auth
      INNER JOIN user_roles quality_user_role ON quality_user_role.role_id = quality_role_auth.role_id
      INNER JOIN roles quality_role ON quality_role.id = quality_user_role.role_id
      WHERE quality_role_auth.process_id = ${qualityAlias}.process_id
        AND quality_user_role.user_id = ? AND quality_role.status = 'active'
    ))))`,
    params: [...taskScope.params, ...departmentScope.params, userId, userId]
  };
}

function assertQualityManageAccess(userId: number, task: TaskRow) {
  if (isSystemAdmin(userId) || task.assignedUserId === userId) return;
  if (
    hasPermission(userId, "quality.inspection.manage") &&
    isUserAuthorizedForProcess(userId, task.processId) &&
    (canAccessDepartment(userId, task.workOrderDepartmentId) ||
      (task.assignedDepartmentId !== null && canAccessDepartment(userId, task.assignedDepartmentId)))
  ) {
    return;
  }
  throw businessError("当前账号没有该质检任务的数据范围", 403);
}

type RepairProductSnapshot = {
  itemSpecification: string;
  chipModel: string;
  chipName: string;
  chipSpec: string;
  sourceLotNo: string;
  sourceSerialNo: string;
};

function operationText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function getChipTestRows(operationData: OperationData): OperationRow[] {
  const rows = operationData.chipTestRows;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is OperationRow => typeof row === "object" && row !== null && !Array.isArray(row));
}

type ChipTestRow = {
  chipModel: string;
  chipName: string;
  chipSpec: string;
  testQuantity: number;
  goodQuantity: number;
  defectQuantity: number;
  testResult: string;
  defectReasons: string[];
  defectDescription: string;
  operationRow: OperationRow;
};

function operationTextList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function validateChipTestRows(operationData: OperationData) {
  const sourceRows = getChipTestRows(operationData);
  if (!sourceRows.length) return [] as ChipTestRow[];
  return sourceRows.map((row, index) => {
    const label = `芯片初测明细第 ${index + 1} 行`;
    const testQuantity = parseQuantity(row.testQuantity, `${label}测试数量`);
    const goodQuantity = parseQuantity(row.goodQuantity ?? 0, `${label}良品数量`, true);
    const defectQuantity = parseQuantity(row.defectQuantity ?? 0, `${label}不良数量`, true);
    if (goodQuantity + defectQuantity !== testQuantity) {
      throw businessError(`${label}良品数量与不良数量之和必须等于测试数量`);
    }
    const chipModel = operationText(row.chipModel);
    if (!chipModel) throw businessError(`${label}芯片型号不能为空`);
    return {
      chipModel,
      chipName: operationText(row.chipName),
      chipSpec: operationText(row.chipSpec),
      testQuantity,
      goodQuantity,
      defectQuantity,
      testResult: operationText(row.testResult),
      defectReasons: operationTextList(row.defectReasons),
      defectDescription: operationText(row.defectDescription),
      operationRow: row
    };
  });
}

function getRepairProductSnapshot(
  workOrderId: number,
  taskId: number,
  itemId: number,
  reportId?: number | null,
  operationRow?: OperationRow
): RepairProductSnapshot {
  const itemSpecification = (
    db
      .prepare(
        `SELECT COALESCE(GROUP_CONCAT(d.name || '：' || v.value, ' / '), '') AS itemSpecification
         FROM item_attribute_values v
         INNER JOIN item_attribute_definitions d ON d.id = v.attribute_id
         WHERE v.item_id = ? AND TRIM(v.value) <> ''`
      )
      .get(itemId) as { itemSpecification: string }
  ).itemSpecification;
  const reports = db
    .prepare(
      `SELECT id, operation_data AS operationData, lot_no AS lotNo, serial_no AS serialNo
       FROM production_reports
       WHERE work_order_id = ?
         AND task_id = ?
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, id DESC
       LIMIT 100`
    )
    .all(workOrderId, taskId, reportId ?? -1) as Array<{
    id: number;
    operationData: string;
    lotNo: string;
    serialNo: string;
  }>;
  let chipModel = operationText(operationRow?.chipModel);
  let chipName = operationText(operationRow?.chipName);
  let chipSpec = operationText(operationRow?.chipSpec);
  let sourceLotNo = "";
  let sourceSerialNo = "";
  for (const report of reports) {
    const operationData = parseOperationData(report.operationData);
    chipModel ||= operationText(operationData.chipModel);
    chipName ||= operationText(operationData.chipName);
    chipSpec ||= operationText(operationData.chipSpec);
    const chipTestRow = getChipTestRows(operationData)[0];
    chipModel ||= operationText(chipTestRow?.chipModel);
    chipName ||= operationText(chipTestRow?.chipName);
    chipSpec ||= operationText(chipTestRow?.chipSpec);
    sourceLotNo ||= report.lotNo;
    sourceSerialNo ||= report.serialNo;
    if (chipModel && chipName && chipSpec && (sourceLotNo || sourceSerialNo)) break;
  }
  return { itemSpecification, chipModel, chipName, chipSpec, sourceLotNo, sourceSerialNo };
}

function createRepair(input: {
  workOrderId: number;
  taskId: number;
  reportId?: number | null;
  itemId: number;
  quantity: number;
  defectCode: string;
  defectDescription: string;
  operationRow?: OperationRow;
  ownerUserId?: number | null;
  createdBy: number;
}) {
  const snapshot = getRepairProductSnapshot(input.workOrderId, input.taskId, input.itemId, input.reportId, input.operationRow);
  const result = db
    .prepare(
      `INSERT INTO production_repairs
       (repair_no, work_order_id, source_task_id, report_id, item_id, quantity,
        defect_code, defect_description, item_specification, chip_model, chip_name, chip_spec,
        source_lot_no, source_serial_no, repair_defect_quantity, owner_user_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      nextDailyCode("FIX", "production_repairs", "repair_no"),
      input.workOrderId,
      input.taskId,
      input.reportId ?? null,
      input.itemId,
      input.quantity,
      input.defectCode || "DEFECT",
      input.defectDescription,
      snapshot.itemSpecification,
      snapshot.chipModel,
      snapshot.chipName,
      snapshot.chipSpec,
      snapshot.sourceLotNo,
      snapshot.sourceSerialNo,
      input.quantity,
      input.ownerUserId ?? null,
      input.createdBy
    );
  return Number(result.lastInsertRowid);
}

const QUANTITY_EPSILON = 0.000001;

function positiveQuantity(quantity: number) {
  return quantity > QUANTITY_EPSILON ? quantity : 0;
}

function pendingOutputQuantity(task: Pick<TaskRow, "goodQuantity" | "outputQuantity">) {
  return positiveQuantity(task.goodQuantity - task.outputQuantity);
}

function hasOpenRepairs(taskId: number) {
  const result = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM production_repairs
       WHERE source_task_id = ? AND status IN ('pending', 'repairing', 'retested')`
    )
    .get(taskId) as { count: number };
  return result.count > 0;
}

function getPendingInventoryDocumentId(taskId: number) {
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

function createQualityCheck(task: TaskRow, quantity: number) {
  const checkQuantity = positiveQuantity(quantity);
  if (checkQuantity <= 0) return null;
  const result = db
    .prepare(
      `INSERT INTO production_quality_checks
       (check_no, task_id, work_order_id, process_id, quantity)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      nextDailyCode("QC", "production_quality_checks", "check_no"),
      task.id,
      task.workOrderId,
      task.processId,
      checkQuantity
    );
  db.prepare(
    `UPDATE production_tasks
     SET status = 'in_progress', flow_status = 'awaiting_quality', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(task.id);
  return Number(result.lastInsertRowid);
}

function getOutputItem(task: TaskRow) {
  const itemId = task.outputItemId ?? (task.outputTarget === "finished_goods" ? task.productItemId : null);
  if (!itemId) throw businessError("该工序未配置半成品输出商品", 409);
  const item = getItem(itemId);
  if (!item || item.status !== "active") throw businessError("输出商品不存在或已停用", 409);
  return item;
}

function createProductionReceipt(task: TaskRow, actorUserId: number, quantity: number) {
  const outputQuantity = positiveQuantity(quantity);
  if (outputQuantity <= 0) return null;
  if (!task.outputWarehouseId) throw businessError("该工序未配置输出仓库", 409);
  const warehouse = getWarehouse(task.outputWarehouseId);
  if (!warehouse || warehouse.status !== "active") throw businessError("输出仓库不存在或已停用", 409);
  if (task.outputTarget !== "semi_finished" && task.outputTarget !== "finished_goods") {
    throw businessError("当前工序不是入库输出工序", 409);
  }
  ensureProductionOutputWarehouse(task.outputTarget, warehouse);
  const item = getOutputItem(task);
  if (item.trackingMode === "lot" && !task.outputLotNo) throw businessError("输出商品按批次管理，报工必须填写批次号");
  if (item.trackingMode === "serial" && (!task.outputSerialNo || outputQuantity !== 1)) {
    throw businessError("输出商品按序列号管理时，数量必须为 1 且填写序列号");
  }
  const documentResult = db
    .prepare(
      `INSERT INTO stock_documents
       (document_no, document_type, business_date, department_id, warehouse_id,
        reference_no, reason, remark, created_by)
       VALUES (?, 'receipt', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      nextDailyCode("IN", "stock_documents", "document_no"),
      today(),
      warehouse.departmentId,
      warehouse.id,
      task.taskNo,
      task.outputTarget === "finished_goods" ? "生产完工成品入库" : "生产半成品入库",
      `生产任务 ${task.taskNo} 自动生成，等待仓储提交、审批和过账`,
      actorUserId
    );
  const documentId = Number(documentResult.lastInsertRowid);
  db.prepare(
    `INSERT INTO stock_document_lines
     (document_id, line_no, item_id, quantity, lot_no, serial_no, remark)
     VALUES (?, 1, ?, ?, ?, ?, ?)`
  ).run(
    documentId,
    item.id,
    outputQuantity,
    task.outputLotNo,
    task.outputSerialNo,
    `来源生产任务 ${task.taskNo}`
  );
  db.prepare(
    `INSERT INTO production_inventory_links (task_id, document_id, link_type)
     VALUES (?, ?, ?)`
  ).run(
    task.id,
    documentId,
    task.outputTarget === "finished_goods" ? "finished_goods_receipt" : "semi_finished_receipt"
  );
  db.prepare(
    `UPDATE production_tasks
     SET status = 'in_progress', flow_status = 'awaiting_inventory', output_document_id = ?,
         output_quantity = output_quantity + ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(documentId, outputQuantity, task.id);
  return documentId;
}

function releaseNextTask(task: TaskRow, quantity: number) {
  const outputQuantity = positiveQuantity(quantity);
  if (outputQuantity <= 0) return;
  const itemScopeColumn = task.workOrderItemId === null ? "work_order_item_id IS NULL" : "work_order_item_id = ?";
  const itemScopeParams = task.workOrderItemId === null ? [] : [task.workOrderItemId];
  const next = db
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
    .get(task.workOrderId, ...itemScopeParams, task.sequenceNo) as
    | {
        id: number;
        status: TaskStatus;
        plannedQuantity: number;
        inputQuantity: number;
        goodQuantity: number;
        outputQuantity: number;
      }
    | undefined;
  if (!next) return;
  const shouldInitializePlan =
    (next.status === "pending" || next.status === "cancelled") &&
    next.inputQuantity <= 0 &&
    next.goodQuantity <= 0 &&
    next.outputQuantity <= 0;
  const nextPlannedQuantity = shouldInitializePlan ? outputQuantity : next.plannedQuantity + outputQuantity;
  db.prepare(
    `UPDATE production_tasks
     SET planned_quantity = ?,
         status = CASE WHEN status IN ('pending', 'completed', 'cancelled') THEN 'ready' ELSE status END,
         flow_status = CASE WHEN status IN ('pending', 'completed', 'cancelled') THEN 'active' ELSE flow_status END,
         completed_at = CASE WHEN status = 'completed' THEN NULL ELSE completed_at END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(nextPlannedQuantity, next.id);
}

function cancelPendingDownstreamTasks(task: TaskRow) {
  const itemScopeColumn = task.workOrderItemId === null ? "work_order_item_id IS NULL" : "work_order_item_id = ?";
  const itemScopeParams = task.workOrderItemId === null ? [] : [task.workOrderItemId];
  db.prepare(
    `UPDATE production_tasks
     SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
     WHERE work_order_id = ? AND ${itemScopeColumn} AND sequence_no > ? AND status IN ('pending', 'ready')`
  ).run(task.workOrderId, ...itemScopeParams, task.sequenceNo);
}

function syncTaskStateAfterOutput(taskId: number) {
  const task = getTask(taskId);
  if (!task) return;
  const pendingDocumentId = getPendingInventoryDocumentId(task.id);
  if (pendingDocumentId) {
    db.prepare(
      `UPDATE production_tasks
       SET status = 'in_progress', flow_status = 'awaiting_inventory',
           output_document_id = ?, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(pendingDocumentId, task.id);
    return;
  }
  if (hasOpenRepairs(task.id)) {
    db.prepare(
      `UPDATE production_tasks
       SET status = 'abnormal', flow_status = 'active', output_document_id = NULL,
           completed_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(task.id);
    return;
  }
  if (pendingOutputQuantity(task) <= 0 && task.inputQuantity >= task.plannedQuantity) {
    db.prepare(
      `UPDATE production_tasks
       SET status = 'completed', flow_status = 'active', output_document_id = NULL,
           completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(task.id);
    return;
  }
  db.prepare(
    `UPDATE production_tasks
     SET status = 'in_progress', flow_status = 'active', output_document_id = NULL,
         completed_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status <> 'cancelled'`
  ).run(task.id);
}

function routeApprovedTaskOutput(taskId: number, actorUserId: number, requestedQuantity?: number) {
  const task = getTask(taskId);
  if (!task) throw businessError("工序任务不存在", 404);
  const pendingQuantity = pendingOutputQuantity(task);
  const targetQuantity = requestedQuantity === undefined ? pendingQuantity : positiveQuantity(requestedQuantity);
  const outputQuantity = Math.min(targetQuantity, pendingQuantity);
  if (outputQuantity <= 0) {
    if (task.goodQuantity <= 0 && !hasOpenRepairs(task.id)) {
      cancelPendingDownstreamTasks(task);
    }
    syncTaskStateAfterOutput(task.id);
    updateWorkOrderProgress(task.workOrderId);
    return 0;
  }
  if (task.outputTarget === "repair") {
    throw businessError("工艺路线不能把合格产出直接配置为维修，请将不良品通过维修流程处理", 409);
  }
  if (task.outputTarget === "semi_finished" || task.outputTarget === "finished_goods") {
    createProductionReceipt(task, actorUserId, outputQuantity);
  } else {
    releaseNextTask(task, outputQuantity);
    db.prepare(
      `UPDATE production_tasks
       SET output_quantity = output_quantity + ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(outputQuantity, task.id);
  }
  syncTaskStateAfterOutput(task.id);
  updateWorkOrderProgress(task.workOrderId);
  return outputQuantity;
}

function updateWorkOrderProgress(workOrderId: number) {
  const workOrder = getWorkOrder(workOrderId);
  if (!workOrder || ["closed", "cancelled"].includes(workOrder.status) || workOrder.executionStatus !== "normal") return;
  db.prepare(
    `UPDATE production_work_order_items
     SET good_quantity = COALESCE((
           SELECT t.good_quantity
           FROM production_tasks t
           WHERE t.work_order_item_id = production_work_order_items.id
             AND t.status <> 'cancelled'
           ORDER BY t.sequence_no DESC
           LIMIT 1
         ), 0),
         defect_quantity = COALESCE((
           SELECT SUM(t.defect_quantity)
           FROM production_tasks t
           WHERE t.work_order_item_id = production_work_order_items.id
             AND t.status <> 'cancelled'
         ), 0),
         scrap_quantity = COALESCE((
           SELECT SUM(t.scrap_quantity)
           FROM production_tasks t
           WHERE t.work_order_item_id = production_work_order_items.id
             AND t.status <> 'cancelled'
         ), 0),
         updated_at = CURRENT_TIMESTAMP
     WHERE work_order_id = ?`
  ).run(workOrderId);
  const summary = db
    .prepare(
      `SELECT COUNT(*) AS taskCount,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedCount,
              SUM(CASE WHEN status = 'in_progress' OR status = 'abnormal' THEN 1 ELSE 0 END) AS activeCount
       FROM production_tasks
       WHERE work_order_id = ? AND status <> 'cancelled'`
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
  if (workOrder.status === "released" || (summary.activeCount ?? 0) > 0) {
    db.prepare("UPDATE production_work_orders SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(workOrderId);
  }
}

function completeTaskOutput(taskId: number, actorUserId: number) {
  routeApprovedTaskOutput(taskId, actorUserId);
}

function routeTaskAfterProduction(taskId: number, actorUserId: number) {
  const task = getTask(taskId);
  if (!task) throw businessError("工序任务不存在", 404);
  const outputQuantity = pendingOutputQuantity(task);
  if (task.qualityGate && outputQuantity > 0) {
    createQualityCheck(task, outputQuantity);
    updateWorkOrderProgress(task.workOrderId);
    return;
  }
  routeApprovedTaskOutput(task.id, actorUserId, outputQuantity);
}

function normalizeRouteSteps(
  steps: Array<{
    processId?: number;
    defaultDepartmentId?: number | null;
    outputTarget?: OutputTarget;
    outputItemId?: number | null;
    outputWarehouseId?: number | null;
    qualityGate?: boolean;
    description?: string;
  }>,
  productItemId: number | null
) {
  if (!steps.length) throw businessError("路线至少需要一道工序");
  return steps.map((step, index) => {
    const processId = parseId(step.processId, `第 ${index + 1} 道工序`);
    const process = getProcess(processId);
    if (!process || process.status !== "active") throw businessError(`第 ${index + 1} 道工序不存在或已停用`);
    const defaultDepartmentId = parseOptionalId(step.defaultDepartmentId, `第 ${index + 1} 道工序执行部门`);
    if (defaultDepartmentId) getActiveDepartment(defaultDepartmentId, `第 ${index + 1} 道工序执行部门`);
    const outputTarget = step.outputTarget ?? "next_process";
    if (!["next_process", "semi_finished", "finished_goods", "repair"].includes(outputTarget)) {
      throw businessError(`第 ${index + 1} 道工序输出去向不合法`);
    }
    if (outputTarget === "repair") {
      throw businessError(`第 ${index + 1} 道工序的合格输出不能直接进入维修；不良品会自动进入维修流程`);
    }
    let outputItemId = parseOptionalId(step.outputItemId, `第 ${index + 1} 道工序输出商品`);
    let outputWarehouseId = parseOptionalId(step.outputWarehouseId, `第 ${index + 1} 道工序输出仓库`);
    if (outputTarget === "semi_finished" || outputTarget === "finished_goods") {
      outputItemId ??= outputTarget === "finished_goods" ? productItemId : null;
      if (!outputItemId) throw businessError(`第 ${index + 1} 道工序必须配置输出商品`);
      const outputItem = getItem(outputItemId);
      if (!outputItem || outputItem.status !== "active") throw businessError(`第 ${index + 1} 道工序输出商品不存在或已停用`);
      if (!outputWarehouseId) throw businessError(`第 ${index + 1} 道工序必须配置输出仓库`);
      const warehouse = getWarehouse(outputWarehouseId);
      if (!warehouse || warehouse.status !== "active") throw businessError(`第 ${index + 1} 道工序输出仓库不存在或已停用`);
      ensureProductionOutputWarehouse(outputTarget, warehouse, `第 ${index + 1} 道工序输出仓库`);
    } else {
      outputItemId = null;
      outputWarehouseId = null;
    }
    return {
      processId,
      defaultDepartmentId,
      outputTarget,
      outputItemId,
      outputWarehouseId,
      qualityGate: step.qualityGate ? 1 : 0,
      description: step.description?.trim() ?? ""
    };
  });
}

type WorkOrderItemInput = {
  productItemId?: number;
  routeId?: number;
  plannedQuantity?: number;
  remark?: string;
};

type WorkOrderCreateInput = {
  items?: WorkOrderItemInput[];
  productItemId?: number;
  routeId?: number;
  plannedQuantity?: number;
  departmentId?: number;
  managerUserId?: number | null;
  priority?: WorkOrderPriority;
  plannedStartDate?: string;
  plannedEndDate?: string;
  remark?: string;
};

type NormalizedWorkOrderItem = {
  productItemId: number;
  productItemCode: string;
  routeId: number;
  plannedQuantity: number;
  remark: string;
};

function validateWorkOrderHeader(actorUserId: number, body: WorkOrderCreateInput) {
  const departmentId = parseId(body.departmentId, "生产部门");
  getActiveDepartment(departmentId, "生产部门");
  if (!canAccessDepartment(actorUserId, departmentId)) {
    throw businessError("当前账号没有该生产部门的数据范围", 403);
  }
  const managerUserId = parseOptionalId(body.managerUserId, "工单负责人");
  if (managerUserId) {
    const manager = getActiveUser(managerUserId);
    if (!manager || manager.status !== "active" || !canAccessDepartment(managerUserId, departmentId)) {
      throw businessError("工单负责人必须是该生产部门范围内的启用员工");
    }
  }
  return { departmentId, managerUserId };
}

function normalizeWorkOrderItems(body: WorkOrderCreateInput, startProcess: ProcessRow | null = null) {
  const sourceItems = body.items?.length
    ? body.items
    : [{
        productItemId: body.productItemId,
        routeId: body.routeId,
        plannedQuantity: body.plannedQuantity,
        remark: ""
      }];
  if (!sourceItems.length) throw businessError("生产工单至少需要一行产品明细");
  const seenItemRoutes = new Set<string>();
  return sourceItems.map((line, index) => {
    const productItemId = parseId(line.productItemId, `第 ${index + 1} 行生产商品`);
    const routeId = parseId(line.routeId, `第 ${index + 1} 行工艺路线`);
    const plannedQuantity = parseQuantity(line.plannedQuantity, `第 ${index + 1} 行计划数量`);
    const item = getItem(productItemId);
    const route = getRoute(routeId);
    if (!item || item.status !== "active") throw businessError(`第 ${index + 1} 行生产商品不存在或已停用`);
    if (!route || route.status !== "active") throw businessError(`第 ${index + 1} 行工艺路线不存在或已停用`);
    if (route.productItemId !== null && route.productItemId !== productItemId) {
      throw businessError(`第 ${index + 1} 行工艺路线不适用于当前生产商品`);
    }
    const steps = getRouteSteps(routeId);
    if (!steps.length) throw businessError(`第 ${index + 1} 行工艺路线未配置工序步骤`);
    if (startProcess && !steps.some((step) => step.processId === startProcess.id)) {
      throw businessError(`第 ${index + 1} 行工艺路线不包含当前工序“${startProcess.name}”`);
    }
    const itemRouteKey = `${productItemId}:${routeId}`;
    if (seenItemRoutes.has(itemRouteKey)) throw businessError(`第 ${index + 1} 行生产商品和工艺路线重复`);
    seenItemRoutes.add(itemRouteKey);
    return {
      productItemId,
      productItemCode: item.itemCode,
      routeId,
      plannedQuantity,
      remark: line.remark?.trim() ?? ""
    };
  });
}

function insertWorkOrderRecord(
  body: WorkOrderCreateInput,
  header: { departmentId: number; managerUserId: number | null },
  items: NormalizedWorkOrderItem[],
  createdBy: number,
  startProcessId: number | null = null
) {
  const firstItem = items[0];
  const result = db
    .prepare(
      `INSERT INTO production_work_orders
       (work_order_no, product_item_id, route_id, start_process_id, department_id, manager_user_id,
        planned_quantity, priority, planned_start_date, planned_end_date, remark, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      nextDailyCode("MO", "production_work_orders", "work_order_no"),
      firstItem.productItemId,
      firstItem.routeId,
      startProcessId,
      header.departmentId,
      header.managerUserId,
      firstItem.plannedQuantity,
      body.priority ?? "normal",
      body.plannedStartDate ?? "",
      body.plannedEndDate ?? "",
      body.remark?.trim() ?? "",
      createdBy
    );
  const id = Number(result.lastInsertRowid);
  const insertItem = db.prepare(
    `INSERT INTO production_work_order_items
     (work_order_id, line_no, product_item_id, route_id, planned_quantity, remark)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  items.forEach((line, index) => {
    insertItem.run(id, index + 1, line.productItemId, line.routeId, line.plannedQuantity, line.remark);
  });
  return id;
}

function generateWorkOrderTasks(workOrder: WorkOrderRow) {
  const workOrderItems = getWorkOrderItems(workOrder.id);
  if (!workOrderItems.length) throw businessError("生产工单未配置产品明细", 409);
  const itemSteps = workOrderItems.map((item) => {
    const steps = getRouteSteps(item.routeId);
    if (!steps.length) throw businessError(`第 ${item.lineNo} 行工艺路线未配置工序步骤`, 409);
    const startIndex = workOrder.startProcessId === null
      ? 0
      : steps.findIndex((step) => step.processId === workOrder.startProcessId);
    if (startIndex < 0) {
      throw businessError(`第 ${item.lineNo} 行工艺路线不包含工单起始工序`, 409);
    }
    return { item, steps: steps.slice(startIndex) };
  });
  const existingTaskCount = (
    db.prepare("SELECT COUNT(*) AS count FROM production_tasks WHERE work_order_id = ?").get(workOrder.id) as { count: number }
  ).count;
  if (existingTaskCount > 0) throw businessError("该工单已生成工序任务", 409);

  const insertTask = db.prepare(
    `INSERT INTO production_tasks
     (task_no, work_order_id, work_order_item_id, route_step_id, process_id, sequence_no, assigned_department_id,
      output_target, quality_gate, output_item_id, output_warehouse_id, planned_quantity, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  itemSteps.forEach(({ item, steps }) => {
    steps.forEach((step, index) => {
      insertTask.run(
        `${workOrder.workOrderNo}-P${String(item.lineNo).padStart(2, "0")}-${String(step.stepNo).padStart(2, "0")}`,
        workOrder.id,
        item.id,
        step.id,
        step.processId,
        step.stepNo,
        step.defaultDepartmentId ?? workOrder.departmentId,
        step.outputTarget,
        step.qualityGate,
        step.outputItemId ?? (step.outputTarget === "finished_goods" ? item.productItemId : null),
        step.outputWarehouseId,
        index === 0 ? item.plannedQuantity : 0,
        index === 0 ? "ready" : "pending"
      );
    });
  });
  db.prepare(
    "UPDATE production_work_orders SET status = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(workOrder.id);
}

export async function registerProductionRoutes(
  app: FastifyInstance,
  dependencies: { requirePermission: PermissionGuard; clientIp: ClientIp }
) {
  const { requirePermission, clientIp } = dependencies;

  app.get("/api/production/dashboard", { preHandler: requirePermission("production.dashboard.view") }, async (request) => {
    const scope = taskScopeWhere(request.user.id);
    const workOrders = db
      .prepare(
        `SELECT COUNT(DISTINCT wo.id) AS count
         FROM production_work_orders wo
         LEFT JOIN production_tasks t ON t.work_order_id = wo.id
         WHERE ${scope.clause}
           AND wo.status NOT IN ('closed', 'cancelled')
           AND wo.execution_status = 'normal'`
      )
      .get(...scope.params) as { count: number };
    const tasks = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM production_tasks t
         INNER JOIN production_work_orders wo ON wo.id = t.work_order_id
         WHERE ${scope.clause} AND (
           t.status IN ('ready', 'in_progress', 'abnormal')
           OR t.flow_status IN ('awaiting_quality', 'awaiting_inventory')
         )`
      )
      .get(...scope.params) as { count: number };
    const reports = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM production_reports pr
         INNER JOIN production_tasks t ON t.id = pr.task_id
         INNER JOIN production_work_orders wo ON wo.id = pr.work_order_id
         WHERE ${scope.clause} AND date(pr.created_at) = date('now')`
      )
      .get(...scope.params) as { count: number };
    const repairs = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM production_repairs r
         INNER JOIN production_tasks t ON t.id = r.source_task_id
         INNER JOIN production_work_orders wo ON wo.id = r.work_order_id
         WHERE ${scope.clause} AND r.status IN ('pending', 'repairing', 'retested')`
      )
      .get(...scope.params) as { count: number };
    return {
      cards: [
        { key: "workOrders", label: "进行中工单", value: workOrders.count, tone: "blue" },
        { key: "tasks", label: "待处理工序", value: tasks.count, tone: "green" },
        { key: "reports", label: "今日报工", value: reports.count, tone: "amber" },
        { key: "repairs", label: "待维修不良", value: repairs.count, tone: "red" }
      ],
      flow: [
        { title: "配置工序授权", detail: "为工序绑定可执行的角色或员工，并在路线中指定执行部门。" },
        { title: "下达并派工", detail: "工单按工艺路线生成任务，经理把任务派给指定的执行员工。" },
        { title: "报工与质检", detail: "员工只能报自己的授权任务；质量关卡必须经质检判定后才会流转。" },
        { title: "维修与受控入库", detail: "不良经维修合格放行或报废后闭环，半成品和成品自动生成待审批入库单。" }
      ]
    };
  });

  app.get("/api/production/authorization-options", { preHandler: requirePermission("production.processes.manage") }, async () => ({
    roles: db.prepare("SELECT id, name, code FROM roles WHERE status = 'active' ORDER BY id").all(),
    users: db
      .prepare(
        `SELECT u.id, u.display_name AS displayName, u.employee_no AS employeeNo,
                u.position, u.department_id AS departmentId, d.name AS departmentName
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE u.status = 'active'
         ORDER BY u.id`
      )
      .all(),
    departments: db.prepare("SELECT id, name, code FROM departments WHERE status = 'active' ORDER BY id").all(),
    warehouses: db
      .prepare(
        `SELECT w.id, w.code, w.name, w.department_id AS departmentId,
                w.warehouse_type AS warehouseType, d.name AS departmentName
         FROM warehouses w
         INNER JOIN departments d ON d.id = w.department_id
         WHERE w.status = 'active'
         ORDER BY w.id`
      )
      .all()
  }));

  app.get("/api/production/route-options", { preHandler: requirePermission("production.routes.manage") }, async () => ({
    departments: db.prepare("SELECT id, name, code FROM departments WHERE status = 'active' ORDER BY id").all(),
    warehouses: db
      .prepare(
        `SELECT w.id, w.code, w.name, w.department_id AS departmentId,
                w.warehouse_type AS warehouseType, d.name AS departmentName
         FROM warehouses w
         INNER JOIN departments d ON d.id = w.department_id
         WHERE w.status = 'active'
         ORDER BY w.id`
      )
      .all()
  }));

  app.get("/api/production/processes", { preHandler: requirePermission("production.processes.view") }, async () => ({
    items: db
      .prepare(
        `SELECT p.id, p.code, p.name, p.process_type AS processType, p.sort_order AS sortOrder,
                p.description, p.status,
                (SELECT COUNT(*) FROM production_process_role_authorizations pra WHERE pra.process_id = p.id) AS authorizedRoleCount,
                (SELECT COUNT(*) FROM production_process_user_authorizations pua WHERE pua.process_id = p.id) AS authorizedUserCount
         FROM production_processes p
         ORDER BY p.sort_order, p.id`
      )
      .all()
  }));

  app.get<{ Params: { id: string } }>("/api/production/processes/:id", { preHandler: requirePermission("production.processes.view") }, async (request) => {
    const id = parseId(request.params.id, "工序");
    const process = getProcess(id);
    if (!process) throw app.httpErrors.notFound("工序不存在");
    return { item: process, authorizations: getProcessAuthorization(id) };
  });

  app.post<{
    Body: { code?: string; name?: string; processType?: ProcessType; sortOrder?: number; description?: string };
  }>("/api/production/processes", { preHandler: requirePermission("production.processes.manage") }, async (request) => {
    const name = request.body.name?.trim();
    if (!name) throw app.httpErrors.badRequest("工序名称不能为空");
    const code = request.body.code?.trim().toUpperCase() || nextPlainCode("PROC", "production_processes", "code");
    try {
      const result = db
        .prepare("INSERT INTO production_processes (code, name, process_type, sort_order, description) VALUES (?, ?, ?, ?, ?)")
        .run(code, name, request.body.processType ?? "manufacturing", Number(request.body.sortOrder ?? 0), request.body.description?.trim() ?? "");
      const id = Number(result.lastInsertRowid);
      recordAudit(request.user.id, "CREATE", "production_process", id, `创建工序 ${name}`, clientIp(request));
      return { item: getProcess(id) };
    } catch {
      throw app.httpErrors.conflict("工序编码或名称已存在，或工序类型不合法");
    }
  });

  app.put<{
    Params: { id: string };
    Body: { code?: string; name?: string; processType?: ProcessType; sortOrder?: number; description?: string; status?: "active" | "inactive" };
  }>("/api/production/processes/:id", { preHandler: requirePermission("production.processes.manage") }, async (request) => {
    const id = parseId(request.params.id, "工序");
    if (!getProcess(id)) throw app.httpErrors.notFound("工序不存在");
    try {
      db.prepare(
        `UPDATE production_processes
         SET code = COALESCE(?, code), name = COALESCE(?, name),
             process_type = COALESCE(?, process_type), sort_order = COALESCE(?, sort_order),
             description = COALESCE(?, description), status = COALESCE(?, status),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        request.body.code?.trim().toUpperCase() || null,
        request.body.name?.trim() || null,
        request.body.processType ?? null,
        request.body.sortOrder ?? null,
        request.body.description?.trim() ?? null,
        request.body.status ?? null,
        id
      );
      recordAudit(request.user.id, "UPDATE", "production_process", id, `更新工序 ${id}`, clientIp(request));
      return { item: getProcess(id) };
    } catch {
      throw app.httpErrors.conflict("工序编码或名称已存在，或工序数据不合法");
    }
  });

  app.delete<{ Params: { id: string } }>("/api/production/processes/:id", { preHandler: requirePermission("production.processes.manage") }, async (request) => {
    const id = parseId(request.params.id, "工序");
    const process = getProcess(id);
    if (!process) throw app.httpErrors.notFound("工序不存在");
    const routeStepCount = (
      db.prepare("SELECT COUNT(*) AS count FROM production_route_steps WHERE process_id = ?").get(id) as { count: number }
    ).count;
    const taskCount = (
      db.prepare("SELECT COUNT(*) AS count FROM production_tasks WHERE process_id = ?").get(id) as { count: number }
    ).count;
    const reportCount = (
      db.prepare("SELECT COUNT(*) AS count FROM production_reports WHERE process_id = ?").get(id) as { count: number }
    ).count;
    const qualityCheckCount = (
      db.prepare("SELECT COUNT(*) AS count FROM production_quality_checks WHERE process_id = ?").get(id) as { count: number }
    ).count;
    if (routeStepCount || taskCount || reportCount || qualityCheckCount) {
      throw app.httpErrors.conflict("该工序已被工艺路线或生产业务记录引用，不能删除；请先停用或调整引用");
    }
    db.prepare("DELETE FROM production_processes WHERE id = ?").run(id);
    recordAudit(request.user.id, "DELETE", "production_process", id, `删除工序 ${process.name}`, clientIp(request));
    return { ok: true };
  });

  app.put<{
    Params: { id: string };
    Body: { roleIds?: number[]; userIds?: number[] };
  }>("/api/production/processes/:id/authorizations", { preHandler: requirePermission("production.processes.manage") }, async (request) => {
    const id = parseId(request.params.id, "工序");
    if (!getProcess(id)) throw app.httpErrors.notFound("工序不存在");
    const roleIds = [...new Set((request.body.roleIds ?? []).map(Number))].filter((value) => Number.isInteger(value) && value > 0);
    const userIds = [...new Set((request.body.userIds ?? []).map(Number))].filter((value) => Number.isInteger(value) && value > 0);
    if (!roleIds.length && !userIds.length) throw app.httpErrors.badRequest("工序至少需要授权一个角色或员工");
    const transaction = db.transaction(() => {
      if (roleIds.length) {
        const count = (
          db.prepare(`SELECT COUNT(*) AS count FROM roles WHERE status = 'active' AND id IN (${roleIds.map(() => "?").join(",")})`).get(...roleIds) as {
            count: number;
          }
        ).count;
        if (count !== roleIds.length) throw businessError("存在无效或停用角色");
      }
      if (userIds.length) {
        const count = (
          db.prepare(`SELECT COUNT(*) AS count FROM users WHERE status = 'active' AND id IN (${userIds.map(() => "?").join(",")})`).get(...userIds) as {
            count: number;
          }
        ).count;
        if (count !== userIds.length) throw businessError("存在无效或停用员工");
      }
      db.prepare("DELETE FROM production_process_role_authorizations WHERE process_id = ?").run(id);
      db.prepare("DELETE FROM production_process_user_authorizations WHERE process_id = ?").run(id);
      const insertRole = db.prepare("INSERT INTO production_process_role_authorizations (process_id, role_id) VALUES (?, ?)");
      const insertUser = db.prepare("INSERT INTO production_process_user_authorizations (process_id, user_id) VALUES (?, ?)");
      roleIds.forEach((roleId) => insertRole.run(id, roleId));
      userIds.forEach((userId) => insertUser.run(id, userId));
    });
    transaction();
    recordAudit(request.user.id, "AUTHORIZE", "production_process", id, "更新工序岗位与员工授权", clientIp(request));
    return { authorizations: getProcessAuthorization(id) };
  });

  app.get<{
    Querystring: { processId?: string; departmentId?: string };
  }>("/api/production/operators", { preHandler: requirePermission("production.tasks.view") }, async (request) => {
    const processId = request.query.processId ? parseId(request.query.processId, "工序") : null;
    const departmentId = request.query.departmentId ? parseId(request.query.departmentId, "部门") : null;
    const clauses = ["u.status = 'active'"];
    const params: Array<number | string> = [];
    if (departmentId) {
      getActiveDepartment(departmentId);
      if (!isSystemAdmin(request.user.id) && !canAccessDepartment(request.user.id, departmentId)) {
        throw app.httpErrors.forbidden("当前账号没有该部门的员工查看范围");
      }
      clauses.push("u.department_id = ?");
      params.push(departmentId);
    } else if (!isSystemAdmin(request.user.id)) {
      const departments = getUserDepartmentIds(request.user.id);
      if (!departments.length) return { items: [] };
      clauses.push(`u.department_id IN (${departments.map(() => "?").join(",")})`);
      params.push(...departments);
    }
    clauses.push(
      `EXISTS (
        SELECT 1
        FROM user_roles ur
        INNER JOIN role_permissions rp ON rp.role_id = ur.role_id
        INNER JOIN permissions pe ON pe.id = rp.permission_id
        INNER JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id AND r.status = 'active' AND pe.code = 'production.operations.execute'
      )`
    );
    if (processId) {
      if (!getProcess(processId)) throw app.httpErrors.notFound("工序不存在");
      clauses.push(
        `(EXISTS (SELECT 1 FROM production_process_user_authorizations pua WHERE pua.process_id = ? AND pua.user_id = u.id)
          OR EXISTS (
            SELECT 1
            FROM production_process_role_authorizations pra
            INNER JOIN user_roles ur ON ur.role_id = pra.role_id
            INNER JOIN roles r ON r.id = ur.role_id
            WHERE pra.process_id = ? AND ur.user_id = u.id AND r.status = 'active'
          ))`
      );
      params.push(processId, processId);
    }
    return {
      items: db
        .prepare(
          `SELECT u.id, u.display_name AS displayName, u.employee_no AS employeeNo,
                  u.position, u.department_id AS departmentId, d.name AS departmentName
           FROM users u
           LEFT JOIN departments d ON d.id = u.department_id
           WHERE ${clauses.join(" AND ")}
           ORDER BY u.id`
        )
        .all(...params)
    };
  });

  app.get("/api/production/warehouses", { preHandler: requirePermission("production.routes.manage") }, async () => ({
    items: db
      .prepare(
        `SELECT w.id, w.code, w.name, w.department_id AS departmentId,
                w.warehouse_type AS warehouseType, d.name AS departmentName
         FROM warehouses w
         INNER JOIN departments d ON d.id = w.department_id
         WHERE w.status = 'active'
         ORDER BY w.id`
      )
      .all()
  }));

  app.get<{
    Querystring: { processCode?: string };
  }>("/api/production/routes", { preHandler: requirePermission("production.routes.view") }, async (request) => {
    const processCode = request.query.processCode?.trim().toUpperCase();
    if (processCode) assertProcessCodeAuthorization(request.user.id, processCode);
    return {
      items: db
        .prepare(
          `SELECT r.id, r.code, r.name, r.product_item_id AS productItemId,
                  i.item_code AS productItemCode, i.name AS productItemName,
                  r.description, r.status, COUNT(s.id) AS stepCount
           FROM production_routes r
           LEFT JOIN items i ON i.id = r.product_item_id
           LEFT JOIN production_route_steps s ON s.route_id = r.id
           WHERE (? = '' OR EXISTS (
             SELECT 1
             FROM production_route_steps filter_step
             INNER JOIN production_processes filter_process ON filter_process.id = filter_step.process_id
             WHERE filter_step.route_id = r.id AND filter_process.code = ?
           ))
           GROUP BY r.id
           ORDER BY r.id DESC`
        )
        .all(processCode ?? "", processCode ?? "")
    };
  });

  app.get<{ Params: { id: string } }>("/api/production/routes/:id", { preHandler: requirePermission("production.routes.view") }, async (request) => {
    const id = parseId(request.params.id, "工艺路线");
    const route = getRoute(id);
    if (!route) throw app.httpErrors.notFound("工艺路线不存在");
    return { route, steps: getRouteSteps(id) };
  });

  app.post<{
    Body: {
      code?: string;
      name?: string;
      productItemId?: number | null;
      description?: string;
      steps?: Array<{
        processId?: number;
        defaultDepartmentId?: number | null;
        outputTarget?: OutputTarget;
        outputItemId?: number | null;
        outputWarehouseId?: number | null;
        qualityGate?: boolean;
        description?: string;
      }>;
    };
  }>("/api/production/routes", { preHandler: requirePermission("production.routes.manage") }, async (request) => {
    const name = request.body.name?.trim();
    if (!name) throw app.httpErrors.badRequest("路线名称不能为空");
    const productItemId = parseOptionalId(request.body.productItemId, "适用商品");
    if (productItemId) {
      const item = getItem(productItemId);
      if (!item || item.status !== "active") throw app.httpErrors.badRequest("适用商品不存在或已停用");
    }
    const steps = normalizeRouteSteps(request.body.steps ?? [], productItemId);
    const code = request.body.code?.trim().toUpperCase() || nextPlainCode("ROUTE", "production_routes", "code");
    try {
      const insert = db.transaction(() => {
        const result = db
          .prepare("INSERT INTO production_routes (code, name, product_item_id, description) VALUES (?, ?, ?, ?)")
          .run(code, name, productItemId, request.body.description?.trim() ?? "");
        const routeId = Number(result.lastInsertRowid);
        const insertStep = db.prepare(
          `INSERT INTO production_route_steps
           (route_id, process_id, step_no, default_department_id, output_target,
            output_item_id, output_warehouse_id, quality_gate, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        steps.forEach((step, index) => {
          insertStep.run(
            routeId,
            step.processId,
            index + 1,
            step.defaultDepartmentId,
            step.outputTarget,
            step.outputItemId,
            step.outputWarehouseId,
            step.qualityGate,
            step.description
          );
        });
        return routeId;
      });
      const id = insert();
      recordAudit(request.user.id, "CREATE", "production_route", id, `创建工艺路线 ${name}`, clientIp(request));
      return { route: getRoute(id), steps: getRouteSteps(id) };
    } catch (error) {
      throw app.httpErrors.conflict(error instanceof Error ? error.message : "工艺路线创建失败");
    }
  });

  app.put<{
    Params: { id: string };
    Body: {
      code?: string;
      name?: string;
      productItemId?: number | null;
      description?: string;
      status?: "active" | "inactive";
      steps?: Array<{
        processId?: number;
        defaultDepartmentId?: number | null;
        outputTarget?: OutputTarget;
        outputItemId?: number | null;
        outputWarehouseId?: number | null;
        qualityGate?: boolean;
        description?: string;
      }>;
    };
  }>("/api/production/routes/:id", { preHandler: requirePermission("production.routes.manage") }, async (request) => {
    const id = parseId(request.params.id, "工艺路线");
    const existing = getRoute(id);
    if (!existing) throw app.httpErrors.notFound("工艺路线不存在");
    const productItemId =
      request.body.productItemId === undefined ? existing.productItemId : parseOptionalId(request.body.productItemId, "适用商品");
    if (productItemId) {
      const item = getItem(productItemId);
      if (!item || item.status !== "active") throw app.httpErrors.badRequest("适用商品不存在或已停用");
    }
    const steps = request.body.steps === undefined ? null : normalizeRouteSteps(request.body.steps, productItemId);
    const activeWorkOrderCount = (
      db.prepare("SELECT COUNT(*) AS count FROM production_work_orders WHERE route_id = ? AND status IN ('released', 'in_progress')").get(id) as {
        count: number;
      }
    ).count;
    if (steps && activeWorkOrderCount > 0) throw app.httpErrors.conflict("路线存在已下达工单，不能修改步骤；请新建版本路线");
    try {
      const update = db.transaction(() => {
        db.prepare(
          `UPDATE production_routes
           SET code = COALESCE(?, code), name = COALESCE(?, name), product_item_id = ?,
               description = COALESCE(?, description), status = COALESCE(?, status),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(
          request.body.code?.trim().toUpperCase() || null,
          request.body.name?.trim() || null,
          productItemId,
          request.body.description?.trim() ?? null,
          request.body.status ?? null,
          id
        );
        if (steps) {
          db.prepare("DELETE FROM production_route_steps WHERE route_id = ?").run(id);
          const insertStep = db.prepare(
            `INSERT INTO production_route_steps
             (route_id, process_id, step_no, default_department_id, output_target,
              output_item_id, output_warehouse_id, quality_gate, description)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          steps.forEach((step, index) => {
            insertStep.run(
              id,
              step.processId,
              index + 1,
              step.defaultDepartmentId,
              step.outputTarget,
              step.outputItemId,
              step.outputWarehouseId,
              step.qualityGate,
              step.description
            );
          });
        }
      });
      update();
      recordAudit(request.user.id, "UPDATE", "production_route", id, `更新工艺路线 ${id}`, clientIp(request));
      return { route: getRoute(id), steps: getRouteSteps(id) };
    } catch (error) {
      throw app.httpErrors.conflict(error instanceof Error ? error.message : "工艺路线更新失败");
    }
  });

  app.delete<{ Params: { id: string } }>("/api/production/routes/:id", { preHandler: requirePermission("production.routes.manage") }, async (request) => {
    const id = parseId(request.params.id, "工艺路线");
    const route = getRoute(id);
    if (!route) throw app.httpErrors.notFound("工艺路线不存在");
    const workOrderCount = (
      db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM production_work_orders WHERE route_id = ?) +
             (SELECT COUNT(*) FROM production_work_order_items WHERE route_id = ?) AS count`
        )
        .get(id, id) as {
        count: number;
      }
    ).count;
    if (workOrderCount > 0) {
      throw app.httpErrors.conflict("该工艺路线已被生产工单引用，不能删除；请先处理或归档相关工单");
    }
    db.prepare("DELETE FROM production_routes WHERE id = ?").run(id);
    recordAudit(request.user.id, "DELETE", "production_route", id, `删除工艺路线 ${route.name}`, clientIp(request));
    return { ok: true };
  });

  app.get<{
    Querystring: { status?: WorkOrderStatus | "all" };
  }>("/api/production/work-orders", { preHandler: requirePermission("production.workorders.view") }, async (request) => {
    const departmentIds = isSystemAdmin(request.user.id) || hasDepartmentManagementAuthority(request.user.id)
      ? (isSystemAdmin(request.user.id) ? null : getUserDepartmentIds(request.user.id))
      : null;
    const clauses = ["1 = 1"];
    const params: Array<number | string> = [];
    if (!isSystemAdmin(request.user.id) && !hasDepartmentManagementAuthority(request.user.id)) {
      clauses.push("EXISTS (SELECT 1 FROM production_tasks own_task WHERE own_task.work_order_id = wo.id AND own_task.assigned_user_id = ?)");
      params.push(request.user.id);
    } else if (departmentIds) {
      if (!departmentIds.length) return { items: [] };
      clauses.push(`wo.department_id IN (${departmentIds.map(() => "?").join(",")})`);
      params.push(...departmentIds);
    }
    if (request.query.status && request.query.status !== "all") {
      clauses.push("wo.status = ?");
      params.push(request.query.status);
    }
    const workOrders = db
      .prepare(
        `SELECT wo.id, wo.work_order_no AS workOrderNo,
                first_item.product_item_id AS productItemId,
                first_product.item_code AS productItemCode, first_product.name AS productItemName,
                first_item.route_id AS routeId, first_route.name AS routeName,
                wo.department_id AS departmentId, d.name AS departmentName,
                manager.display_name AS managerName,
                COALESCE((
                  SELECT SUM(planned_quantity)
                  FROM production_work_order_items
                  WHERE work_order_id = wo.id
                ), wo.planned_quantity) AS plannedQuantity,
                wo.status, wo.execution_status AS executionStatus,
                wo.termination_type AS terminationType, wo.priority,
                wo.planned_start_date AS plannedStartDate,
                wo.planned_end_date AS plannedEndDate, wo.remark, creator.display_name AS createdByName,
                (SELECT COUNT(*) FROM production_work_order_items WHERE work_order_id = wo.id) AS itemCount,
                (SELECT COUNT(*) FROM production_tasks WHERE work_order_id = wo.id) AS taskCount,
                COALESCE((
                  SELECT SUM(current_task.good_quantity)
                  FROM production_work_order_items summary_item
                  LEFT JOIN production_tasks current_task ON current_task.id = (
                    SELECT t2.id
                    FROM production_tasks t2
                    WHERE t2.work_order_item_id = summary_item.id
                      AND t2.good_quantity > 0
                      AND t2.status <> 'cancelled'
                    ORDER BY t2.sequence_no DESC
                    LIMIT 1
                  )
                  WHERE summary_item.work_order_id = wo.id
                ), 0) AS goodQuantity,
                COALESCE((SELECT SUM(scrap_quantity) FROM production_tasks WHERE work_order_id = wo.id), 0) AS defectQuantity,
                wo.created_at AS createdAt
         FROM production_work_orders wo
         LEFT JOIN production_work_order_items first_item ON first_item.id = (
           SELECT woi_first.id
           FROM production_work_order_items woi_first
           WHERE woi_first.work_order_id = wo.id
           ORDER BY woi_first.line_no
           LIMIT 1
         )
         LEFT JOIN items first_product ON first_product.id = first_item.product_item_id
         LEFT JOIN production_routes first_route ON first_route.id = first_item.route_id
         INNER JOIN departments d ON d.id = wo.department_id
         LEFT JOIN users manager ON manager.id = wo.manager_user_id
         INNER JOIN users creator ON creator.id = wo.created_by
         WHERE ${clauses.join(" AND ")}
         ORDER BY wo.id DESC`
      )
      .all(...params) as Array<Record<string, unknown> & { id: number }>;
    const workOrderIds = workOrders.map((workOrder) => workOrder.id);
    const itemSummariesByWorkOrder = new Map<number, Array<Record<string, unknown>>>();
    if (workOrderIds.length) {
      const itemRows = db
        .prepare(
          `SELECT woi.work_order_id AS workOrderId, woi.line_no AS lineNo,
                  i.item_code AS productItemCode, i.name AS productItemName,
                  r.name AS routeName, woi.planned_quantity AS plannedQuantity,
                  COALESCE((
                    SELECT t.good_quantity
                    FROM production_tasks t
                    WHERE t.work_order_item_id = woi.id
                      AND t.good_quantity > 0
                      AND t.status <> 'cancelled'
                    ORDER BY t.sequence_no DESC
                    LIMIT 1
                  ), 0) AS goodQuantity,
                  COALESCE((
                    SELECT SUM(t.defect_quantity)
                    FROM production_tasks t
                    WHERE t.work_order_item_id = woi.id
                      AND t.status <> 'cancelled'
                  ), 0) AS defectQuantity,
                  COALESCE((
                    SELECT SUM(t.scrap_quantity)
                    FROM production_tasks t
                    WHERE t.work_order_item_id = woi.id
                      AND t.status <> 'cancelled'
                  ), 0) AS scrapQuantity
           FROM production_work_order_items woi
           INNER JOIN items i ON i.id = woi.product_item_id
           INNER JOIN production_routes r ON r.id = woi.route_id
           WHERE woi.work_order_id IN (${workOrderIds.map(() => "?").join(",")})
           ORDER BY woi.work_order_id DESC, woi.line_no`
        )
        .all(...workOrderIds) as Array<Record<string, unknown> & { workOrderId: number }>;
      for (const itemRow of itemRows) {
        const summaries = itemSummariesByWorkOrder.get(itemRow.workOrderId) ?? [];
        summaries.push(itemRow);
        itemSummariesByWorkOrder.set(itemRow.workOrderId, summaries);
      }
    }
    return {
      items: workOrders.map((workOrder) => ({
        ...workOrder,
        itemSummaries: itemSummariesByWorkOrder.get(workOrder.id) ?? []
      }))
    };
  });

  app.post<{ Body: WorkOrderCreateInput }>(
    "/api/production/work-orders",
    { preHandler: requirePermission("production.workorders.manage") },
    async (request) => {
      try {
        const header = validateWorkOrderHeader(request.user.id, request.body);
        const normalizedItems = normalizeWorkOrderItems(request.body);
        const id = db.transaction(() => insertWorkOrderRecord(request.body, header, normalizedItems, request.user.id))();
        recordAudit(
          request.user.id,
          "CREATE",
          "production_work_order",
          id,
          `创建生产工单，产品明细 ${normalizedItems.map((item) => item.productItemCode).join("、")}`,
          clientIp(request)
        );
        return { item: getWorkOrder(id) };
      } catch (error) {
        throw app.httpErrors.conflict(error instanceof Error ? error.message : "生产工单创建失败");
      }
    }
  );

  app.post<{ Params: { processCode: string }; Body: WorkOrderCreateInput }>(
    "/api/production/processes/:processCode/work-orders",
    { preHandler: requirePermission("production.workorders.manage") },
    async (request) => {
      const processCode = request.params.processCode.trim().toUpperCase();
      const startProcess = assertProcessCodeAuthorization(request.user.id, processCode);
      try {
        const header = validateWorkOrderHeader(request.user.id, request.body);
        const normalizedItems = normalizeWorkOrderItems(request.body, startProcess);
        const id = db.transaction(() => {
          const createdWorkOrderId = insertWorkOrderRecord(
            request.body,
            header,
            normalizedItems,
            request.user.id,
            startProcess.id
          );
          const workOrder = getWorkOrder(createdWorkOrderId);
          if (!workOrder) throw businessError("生产工单创建后读取失败", 500);
          generateWorkOrderTasks(workOrder);
          return createdWorkOrderId;
        })();
        const workOrder = getWorkOrder(id);
        recordAudit(
          request.user.id,
          "CREATE_AND_RELEASE",
          "production_work_order",
          id,
          `从${startProcess.name}发起并下达生产工单，产品明细 ${normalizedItems.map((item) => item.productItemCode).join("、")}`,
          clientIp(request)
        );
        return { item: workOrder };
      } catch (error) {
        throw app.httpErrors.conflict(error instanceof Error ? error.message : "当前工序生产工单创建失败");
      }
    }
  );

  app.post<{ Params: { id: string } }>("/api/production/work-orders/:id/release", { preHandler: requirePermission("production.workorders.manage") }, async (request) => {
    const id = parseId(request.params.id, "生产工单");
    const workOrder = getWorkOrder(id);
    if (!workOrder) throw app.httpErrors.notFound("生产工单不存在");
    if (!canAccessDepartment(request.user.id, workOrder.departmentId)) throw app.httpErrors.forbidden("当前账号没有该生产工单的数据范围");
    if (workOrder.status !== "draft") throw app.httpErrors.conflict("只有草稿工单可以下达");
    db.transaction(() => generateWorkOrderTasks(workOrder))();
    recordAudit(request.user.id, "RELEASE", "production_work_order", id, `下达生产工单 ${workOrder.workOrderNo}`, clientIp(request));
    return { item: getWorkOrder(id) };
  });

  app.post<{ Params: { id: string } }>("/api/production/work-orders/:id/cancel", { preHandler: requirePermission("production.workorders.manage") }, async (request) => {
    const id = parseId(request.params.id, "生产工单");
    const workOrder = getWorkOrder(id);
    if (!workOrder) throw app.httpErrors.notFound("生产工单不存在");
    if (!canAccessDepartment(request.user.id, workOrder.departmentId)) throw app.httpErrors.forbidden("当前账号没有该生产工单的数据范围");
    if (!["draft", "released"].includes(workOrder.status) || workOrder.executionStatus !== "normal") {
      throw app.httpErrors.conflict("只有正常状态的草稿或已下达但未生产工单可以取消");
    }
    const reports = (db.prepare("SELECT COUNT(*) AS count FROM production_reports WHERE work_order_id = ?").get(id) as { count: number }).count;
    if (reports > 0) throw app.httpErrors.conflict("工单已有报工记录，不能直接取消");
    db.transaction(() => {
      db.prepare("UPDATE production_tasks SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE work_order_id = ?").run(id);
      db.prepare("UPDATE production_work_orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    })();
    recordAudit(request.user.id, "CANCEL", "production_work_order", id, `取消生产工单 ${workOrder.workOrderNo}`, clientIp(request));
    return { item: getWorkOrder(id) };
  });

  app.post<{ Params: { id: string } }>("/api/production/work-orders/:id/close", { preHandler: requirePermission("production.workorders.manage") }, async (request) => {
    const id = parseId(request.params.id, "生产工单");
    const workOrder = getWorkOrder(id);
    if (!workOrder) throw app.httpErrors.notFound("生产工单不存在");
    if (!canAccessDepartment(request.user.id, workOrder.departmentId)) throw app.httpErrors.forbidden("当前账号没有该生产工单的数据范围");
    if (workOrder.status === "closed") {
      return { item: workOrder };
    }
    if (
      !["completed", "cancelled"].includes(workOrder.status)
      && !(workOrder.executionStatus === "terminated" && ["released", "in_progress"].includes(workOrder.status))
    ) {
      throw app.httpErrors.conflict("只有已完成、已取消或已终止工单可以关闭");
    }
    db.prepare("UPDATE production_work_orders SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    recordAudit(request.user.id, "CLOSE", "production_work_order", id, `关闭生产工单 ${workOrder.workOrderNo}`, clientIp(request));
    return { item: getWorkOrder(id) };
  });

  app.post<{ Params: { id: string } }>("/api/production/work-orders/:id/pause", { preHandler: requirePermission("production.workorders.control") }, async (request) => {
    const id = parseId(request.params.id, "生产工单");
    const workOrder = getWorkOrder(id);
    if (!workOrder) throw app.httpErrors.notFound("生产工单不存在");
    assertWorkOrderAccess(request.user.id, workOrder);
    if (!["released", "in_progress"].includes(workOrder.status) || workOrder.executionStatus !== "normal") {
      throw app.httpErrors.conflict("只有正常执行中的已下达或生产中工单可以暂停");
    }
    db.prepare(
      "UPDATE production_work_orders SET execution_status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(id);
    recordAudit(request.user.id, "PAUSE", "production_work_order", id, `暂停生产工单 ${workOrder.workOrderNo}`, clientIp(request));
    return { item: getWorkOrder(id) };
  });

  app.post<{ Params: { id: string } }>("/api/production/work-orders/:id/resume", { preHandler: requirePermission("production.workorders.control") }, async (request) => {
    const id = parseId(request.params.id, "生产工单");
    const workOrder = getWorkOrder(id);
    if (!workOrder) throw app.httpErrors.notFound("生产工单不存在");
    assertWorkOrderAccess(request.user.id, workOrder);
    if (workOrder.executionStatus !== "paused") throw app.httpErrors.conflict("只有已暂停工单可以继续");
    db.prepare(
      "UPDATE production_work_orders SET execution_status = 'normal', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(id);
    updateWorkOrderProgress(id);
    recordAudit(request.user.id, "RESUME", "production_work_order", id, `继续生产工单 ${workOrder.workOrderNo}`, clientIp(request));
    return { item: getWorkOrder(id) };
  });

  app.post<{ Params: { id: string }; Body: { terminationType?: "stop" | "terminate" } }>(
    "/api/production/work-orders/:id/terminate",
    { preHandler: requirePermission("production.workorders.control") },
    async (request) => {
      const id = parseId(request.params.id, "生产工单");
      const workOrder = getWorkOrder(id);
      if (!workOrder) throw app.httpErrors.notFound("生产工单不存在");
      assertWorkOrderAccess(request.user.id, workOrder);
      const terminationType = request.body.terminationType === "stop" ? "stop" : "terminate";
      if (!["released", "in_progress"].includes(workOrder.status) || workOrder.executionStatus === "terminated") {
        throw app.httpErrors.conflict("当前状态不能停止或终止工单");
      }
      db.prepare(
        `UPDATE production_work_orders
         SET execution_status = 'terminated', termination_type = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(terminationType, id);
      recordAudit(
        request.user.id,
        terminationType === "stop" ? "STOP" : "TERMINATE",
        "production_work_order",
        id,
        `${terminationType === "stop" ? "停止" : "终止"}生产工单 ${workOrder.workOrderNo}`,
        clientIp(request)
      );
      return { item: getWorkOrder(id) };
    }
  );

  app.delete<{ Params: { id: string } }>("/api/production/work-orders/:id", { preHandler: requirePermission("production.workorders.delete") }, async (request) => {
    const id = parseId(request.params.id, "生产工单");
    const workOrder = getWorkOrder(id);
    if (!workOrder) throw app.httpErrors.notFound("生产工单不存在");
    assertWorkOrderAccess(request.user.id, workOrder);
    if (workOrder.status !== "draft" || workOrder.executionStatus !== "normal") {
      throw app.httpErrors.conflict("只有正常状态的草稿工单可以删除");
    }
    const businessRecords = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM production_tasks WHERE work_order_id = ?) +
           (SELECT COUNT(*) FROM production_reports WHERE work_order_id = ?) +
           (SELECT COUNT(*) FROM production_repairs WHERE work_order_id = ?) +
           (SELECT COUNT(*) FROM production_quality_checks WHERE work_order_id = ?) +
           (SELECT COUNT(*) FROM production_inventory_links WHERE task_id IN (
             SELECT id FROM production_tasks WHERE work_order_id = ?
           )) AS count`
      )
      .get(id, id, id, id, id) as { count: number };
    if (businessRecords.count > 0) {
      throw app.httpErrors.conflict("工单已经产生任务或业务记录，不能删除，请使用取消或终止");
    }
    db.prepare("DELETE FROM production_work_orders WHERE id = ?").run(id);
    recordAudit(request.user.id, "DELETE", "production_work_order", id, `删除草稿生产工单 ${workOrder.workOrderNo}`, clientIp(request));
    return { ok: true };
  });

  app.get<{
    Querystring: { status?: TaskStatus | "all"; workOrderId?: string; processCode?: string };
  }>("/api/production/tasks", { preHandler: requirePermission("production.tasks.view") }, async (request) => {
    const scope = taskScopeWhere(request.user.id);
    const clauses = [scope.clause];
    const params: Array<string | number> = [...scope.params];
    if (request.query.status && request.query.status !== "all") {
      clauses.push("t.status = ?");
      params.push(request.query.status);
    }
    if (request.query.workOrderId) {
      clauses.push("t.work_order_id = ?");
      params.push(parseId(request.query.workOrderId, "生产工单"));
    }
    if (request.query.processCode?.trim()) {
      const processCode = request.query.processCode.trim().toUpperCase();
      assertProcessCodeAuthorization(request.user.id, processCode);
      clauses.push("p.code = ?");
      params.push(processCode);
    }
    return {
      items: db
        .prepare(
          `SELECT t.id, t.task_no AS taskNo, t.work_order_id AS workOrderId,
                  t.work_order_item_id AS workOrderItemId, COALESCE(woi.line_no, 1) AS workOrderItemLineNo,
                  wo.work_order_no AS workOrderNo, i.item_code AS productItemCode,
                  i.name AS productItemName, item_route.name AS itemRouteName, t.process_id AS processId,
                  p.code AS processCode, p.name AS processName, p.process_type AS processType,
                  wo.execution_status AS executionStatus, wo.termination_type AS terminationType,
                  t.sequence_no AS sequenceNo, t.assigned_department_id AS assignedDepartmentId,
                  ad.name AS assignedDepartmentName, t.assigned_user_id AS assignedUserId,
                  au.display_name AS assignedUserName, t.planned_quantity AS plannedQuantity,
                  t.input_quantity AS inputQuantity, t.good_quantity AS goodQuantity,
                  t.output_quantity AS outputQuantity, t.defect_quantity AS defectQuantity,
                  t.rework_quantity AS reworkQuantity,
                  t.scrap_quantity AS scrapQuantity, t.status, t.flow_status AS flowStatus,
                  t.output_document_id AS outputDocumentId, od.document_no AS outputDocumentNo,
                  t.remark, t.started_at AS startedAt, t.completed_at AS completedAt,
                  t.created_at AS createdAt
           FROM production_tasks t
           INNER JOIN production_work_orders wo ON wo.id = t.work_order_id
           LEFT JOIN production_work_order_items woi ON woi.id = t.work_order_item_id
           INNER JOIN items i ON i.id = COALESCE(woi.product_item_id, wo.product_item_id)
           LEFT JOIN production_routes item_route ON item_route.id = woi.route_id
           INNER JOIN production_processes p ON p.id = t.process_id
           LEFT JOIN departments ad ON ad.id = t.assigned_department_id
           LEFT JOIN users au ON au.id = t.assigned_user_id
           LEFT JOIN stock_documents od ON od.id = t.output_document_id
           WHERE ${clauses.join(" AND ")}
           ORDER BY t.id DESC`
        )
        .all(...params)
    };
  });

  app.get<{
    Params: { id: string };
  }>("/api/production/tasks/:id", { preHandler: requirePermission("production.tasks.view") }, async (request) => {
    const id = parseId(request.params.id, "工序任务");
    const task = assertTaskViewAccess(request.user.id, id);
    const reports = db
      .prepare(
        `SELECT pr.id, pr.report_no AS reportNo, pr.report_date AS reportDate,
                u.display_name AS operatorName, pr.input_quantity AS inputQuantity,
                pr.good_quantity AS goodQuantity, pr.defect_quantity AS defectQuantity,
                pr.rework_quantity AS reworkQuantity, pr.scrap_quantity AS scrapQuantity,
                pr.lot_no AS lotNo, pr.serial_no AS serialNo, pr.remark,
                pr.operation_data AS operationData, pr.created_at AS createdAt
         FROM production_reports pr
         INNER JOIN users u ON u.id = pr.operator_user_id
         WHERE pr.task_id = ?
         ORDER BY pr.id`
      )
      .all(id) as Array<Record<string, unknown> & { operationData?: string }>;
    const repairs = db
      .prepare(
        `SELECT r.id, r.repair_no AS repairNo, r.quantity, r.defect_code AS defectCode,
                r.defect_description AS defectDescription, r.item_specification AS itemSpecification,
                r.chip_model AS chipModel, r.chip_name AS chipName, r.chip_spec AS chipSpec,
                r.source_lot_no AS sourceLotNo, r.source_serial_no AS sourceSerialNo,
                r.repaired_good_quantity AS repairGoodQuantity,
                r.repair_defect_quantity AS repairDefectQuantity,
                r.scrapped_quantity AS scrapQuantity, r.scrap_reason AS scrapReason,
                r.status, r.repair_action AS repairAction, r.result,
                owner.display_name AS ownerName, r.created_at AS createdAt, r.updated_at AS updatedAt
         FROM production_repairs r
         LEFT JOIN users owner ON owner.id = r.owner_user_id
         WHERE r.source_task_id = ?
         ORDER BY r.id`
      )
      .all(id);
    const repairOperations = db
      .prepare(
        `SELECT ro.id, r.repair_no AS repairNo, ro.repair_good_quantity AS repairGoodQuantity,
                ro.repair_defect_quantity AS repairDefectQuantity, ro.scrap_quantity AS scrapQuantity,
                ro.scrap_reason AS scrapReason, ro.repair_action AS repairAction, ro.result,
                operator.display_name AS operatorName, ro.created_at AS createdAt
         FROM production_repair_operations ro
         INNER JOIN production_repairs r ON r.id = ro.repair_id
         INNER JOIN users operator ON operator.id = ro.operator_user_id
         WHERE r.source_task_id = ?
         ORDER BY ro.id`
      )
      .all(id);
    const qualityChecks = db
      .prepare(
        `SELECT qc.id, qc.check_no AS checkNo, qc.quantity,
                qc.passed_quantity AS passedQuantity, qc.failed_quantity AS failedQuantity,
                qc.status, qc.check_result AS checkResult, inspector.display_name AS inspectorName,
                qc.checked_at AS checkedAt, qc.created_at AS createdAt
         FROM production_quality_checks qc
         LEFT JOIN users inspector ON inspector.id = qc.inspector_user_id
         WHERE qc.task_id = ?
         ORDER BY qc.id`
      )
      .all(id);
    const inventoryDocuments = db
      .prepare(
        `SELECT d.id, d.document_no AS documentNo, d.document_type AS documentType,
                d.status, d.business_date AS businessDate, l.link_type AS linkType,
                l.status AS linkStatus, l.posted_at AS postedAt
         FROM production_inventory_links l
         INNER JOIN stock_documents d ON d.id = l.document_id
         WHERE l.task_id = ?
         ORDER BY l.id`
      )
      .all(id);
    return {
      item: task,
      reports: reports.map((report) => ({ ...report, operationData: parseOperationData(report.operationData) })),
      repairs,
      repairOperations,
      qualityChecks,
      inventoryDocuments
    };
  });

  app.post<{
    Params: { id: string };
    Body: { action?: TaskOutputAction };
  }>("/api/production/tasks/:id/output-actions", { preHandler: requirePermission("production.tasks.view") }, async (request) => {
    const id = parseId(request.params.id, "工序任务");
    const action = request.body.action;
    if (!action || !["preview", "print", "download"].includes(action)) {
      throw app.httpErrors.badRequest("任务单输出操作不合法");
    }
    const task = assertTaskViewAccess(request.user.id, id);
    const actionLabels: Record<TaskOutputAction, string> = {
      preview: "预览",
      print: "打印",
      download: "下载"
    };
    recordAudit(
      request.user.id,
      action.toUpperCase(),
      "production_task",
      id,
      `${actionLabels[action]}生产任务单 ${task.taskNo}`,
      clientIp(request)
    );
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Body: { assignedDepartmentId?: number | null; assignedUserId?: number | null; remark?: string };
  }>("/api/production/tasks/:id/assign", { preHandler: requirePermission("production.tasks.manage") }, async (request) => {
    const id = parseId(request.params.id, "工序任务");
    const task = assertTaskManageAccess(request.user.id, id);
    if (!["pending", "ready"].includes(task.status) || task.flowStatus !== "active") {
      throw app.httpErrors.conflict("只有待流转或待开工的任务可以派工");
    }
    const assignedDepartmentId = parseId(request.body.assignedDepartmentId, "派工部门");
    const assignedUserId = parseId(request.body.assignedUserId, "执行员工");
    if (task.assignedDepartmentId && task.assignedDepartmentId !== assignedDepartmentId) {
      throw app.httpErrors.badRequest("该任务执行部门由工艺路线预设，不能跨部门派工");
    }
    getActiveDepartment(assignedDepartmentId, "派工部门");
    const operator = getActiveUser(assignedUserId);
    if (!operator || operator.status !== "active" || operator.departmentId !== assignedDepartmentId) {
      throw app.httpErrors.badRequest("执行员工必须是派工部门内的启用员工");
    }
    if (!hasPermission(assignedUserId, "production.operations.execute") || !isUserAuthorizedForProcess(assignedUserId, task.processId)) {
      throw app.httpErrors.badRequest("执行员工没有该工序的报工授权");
    }
    db.prepare(
      `UPDATE production_tasks
       SET assigned_department_id = ?, assigned_user_id = ?, remark = COALESCE(?, remark),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(assignedDepartmentId, assignedUserId, request.body.remark?.trim() || null, id);
    recordAudit(request.user.id, "ASSIGN", "production_task", id, `派工工序任务 ${task.taskNo} 给 ${operator.displayName}`, clientIp(request));
    return { item: getTask(id) };
  });

  app.post<{ Params: { id: string } }>("/api/production/tasks/:id/start", { preHandler: requirePermission("production.operations.execute") }, async (request) => {
    const id = parseId(request.params.id, "工序任务");
    const task = assertTaskExecutionAccess(request.user.id, id);
    if (task.status !== "ready" || task.flowStatus !== "active") throw app.httpErrors.conflict("当前工序任务不能开工");
    db.prepare(
      "UPDATE production_tasks SET status = 'in_progress', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(id);
    updateWorkOrderProgress(task.workOrderId);
    recordAudit(request.user.id, "START", "production_task", id, `开工工序任务 ${task.taskNo}`, clientIp(request));
    return { item: getTask(id) };
  });

  app.post<{
    Params: { id: string };
    Body: {
      reportDate?: string;
      inputQuantity?: number;
      goodQuantity?: number;
      defectQuantity?: number;
      reworkQuantity?: number;
      scrapQuantity?: number;
      lotNo?: string;
      serialNo?: string;
      defectCode?: string;
      operationData?: Record<string, unknown>;
      remark?: string;
    };
  }>("/api/production/tasks/:id/report", { preHandler: requirePermission("production.operations.execute") }, async (request) => {
    const id = parseId(request.params.id, "工序任务");
    const task = assertTaskExecutionAccess(request.user.id, id);
    if (task.status !== "in_progress" || task.flowStatus !== "active") {
      throw app.httpErrors.conflict("任务必须处于已开工且可报工状态");
    }
    const inputQuantity = parseQuantity(request.body.inputQuantity, "投入数量");
    const goodQuantity = parseQuantity(request.body.goodQuantity ?? 0, "合格数量", true);
    const defectQuantity = parseQuantity(request.body.defectQuantity ?? 0, "不良数量", true);
    const reworkQuantity = parseQuantity(request.body.reworkQuantity ?? 0, "返工数量", true);
    const scrapQuantity = parseQuantity(request.body.scrapQuantity ?? 0, "报废数量", true);
    if (goodQuantity + defectQuantity !== inputQuantity) {
      throw app.httpErrors.badRequest("每次报工的合格数量与不良数量之和必须等于投入数量");
    }
    if (reworkQuantity + scrapQuantity > defectQuantity) {
      throw app.httpErrors.badRequest("返工数量和报废数量之和不能大于不良数量");
    }
    if (task.inputQuantity + inputQuantity > task.plannedQuantity) {
      throw app.httpErrors.badRequest("累计投入数量不能大于任务计划数量");
    }
    const lotNo = request.body.lotNo?.trim() ?? "";
    const serialNo = request.body.serialNo?.trim() ?? "";
    if (task.productTrackingMode === "lot" && !lotNo) throw app.httpErrors.badRequest("该商品按批次管理，报工必须填写批次号");
    if (task.productTrackingMode === "serial" && (!serialNo || inputQuantity !== 1)) {
      throw app.httpErrors.badRequest("该商品按序列号管理时，每次报工数量必须为 1 且填写序列号");
    }
    const operationData = normalizeOperationData(request.body.operationData);
    const chipTestRows = task.processCode.includes("CHIP-TEST") || task.processName.includes("芯片初测")
      ? validateChipTestRows(operationData)
      : [];
    if (chipTestRows.length) {
      const summary = chipTestRows.reduce(
        (total, row) => ({
          testQuantity: total.testQuantity + row.testQuantity,
          goodQuantity: total.goodQuantity + row.goodQuantity,
          defectQuantity: total.defectQuantity + row.defectQuantity
        }),
        { testQuantity: 0, goodQuantity: 0, defectQuantity: 0 }
      );
      if (
        Math.abs(summary.testQuantity - inputQuantity) > QUANTITY_EPSILON
        || Math.abs(summary.goodQuantity - goodQuantity) > QUANTITY_EPSILON
        || Math.abs(summary.defectQuantity - defectQuantity) > QUANTITY_EPSILON
      ) {
        throw app.httpErrors.badRequest("芯片初测明细的测试、良品和不良合计必须分别等于本次报工数量");
      }
    }
    const reportNo = nextDailyCode("REP", "production_reports", "report_no");
    const report = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO production_reports
           (report_no, task_id, work_order_id, process_id, operator_user_id, report_date,
            input_quantity, good_quantity, defect_quantity, rework_quantity, scrap_quantity,
            lot_no, serial_no, remark, operation_data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          reportNo,
          id,
          task.workOrderId,
          task.processId,
          request.user.id,
          request.body.reportDate || today(),
          inputQuantity,
          goodQuantity,
          defectQuantity,
          reworkQuantity,
          scrapQuantity,
          lotNo,
          serialNo,
          request.body.remark?.trim() ?? "",
          JSON.stringify(operationData)
        );
      const reportId = Number(result.lastInsertRowid);
      const nextInput = task.inputQuantity + inputQuantity;
      const nextGood = task.goodQuantity + goodQuantity;
      const nextDefect = task.defectQuantity + defectQuantity;
      const nextRework = task.reworkQuantity + reworkQuantity;
      const nextScrap = task.scrapQuantity + scrapQuantity;
      db.prepare(
        `UPDATE production_tasks
         SET input_quantity = ?, good_quantity = ?, defect_quantity = ?, rework_quantity = ?,
             scrap_quantity = ?, output_lot_no = COALESCE(NULLIF(?, ''), output_lot_no),
             output_serial_no = COALESCE(NULLIF(?, ''), output_serial_no),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(nextInput, nextGood, nextDefect, nextRework, nextScrap, lotNo, serialNo, id);
      const repairQuantity = defectQuantity - scrapQuantity;
      if (chipTestRows.length) {
        let remainingScrapQuantity = scrapQuantity;
        for (const row of chipTestRows) {
          const rowScrapQuantity = Math.min(row.defectQuantity, remainingScrapQuantity);
          const rowRepairQuantity = row.defectQuantity - rowScrapQuantity;
          remainingScrapQuantity -= rowScrapQuantity;
          if (rowRepairQuantity <= 0) continue;
          createRepair({
            workOrderId: task.workOrderId,
            taskId: task.id,
            reportId,
            itemId: task.productItemId,
            quantity: rowRepairQuantity,
            defectCode: row.defectReasons.join("、") || request.body.defectCode?.trim() || "DEFECT",
            defectDescription: row.defectDescription || `${task.processName} ${row.chipModel} 测试不良`,
            operationRow: row.operationRow,
            createdBy: request.user.id
          });
        }
      } else if (repairQuantity > 0) {
        createRepair({
          workOrderId: task.workOrderId,
          taskId: task.id,
          reportId,
          itemId: task.productItemId,
          quantity: repairQuantity,
          defectCode: request.body.defectCode?.trim() || "DEFECT",
          defectDescription: request.body.remark?.trim() || `${task.processName} 报工产生不良`,
          createdBy: request.user.id
        });
      }
      if (nextInput >= task.plannedQuantity) {
        routeTaskAfterProduction(task.id, request.user.id);
      }
      return reportId;
    });
    const reportId = report();
    updateWorkOrderProgress(task.workOrderId);
    recordAudit(request.user.id, "REPORT", "production_task", id, `工序报工 ${task.taskNo}，单号 ${reportNo}`, clientIp(request));
    return { item: getTask(id), reportId };
  });

  app.get("/api/production/reports", { preHandler: requirePermission("production.reports.view") }, async (request) => {
    const scope = taskScopeWhere(request.user.id);
    const rows = db
      .prepare(
        `SELECT pr.id, pr.report_no AS reportNo, pr.report_date AS reportDate,
                  t.task_no AS taskNo, COALESCE(woi.line_no, 1) AS workOrderItemLineNo,
                  wo.work_order_no AS workOrderNo,
                  i.item_code AS productItemCode, i.name AS productItemName,
                  p.name AS processName, u.display_name AS operatorName,
                  pr.input_quantity AS inputQuantity, pr.good_quantity AS goodQuantity,
                  pr.defect_quantity AS defectQuantity, pr.rework_quantity AS reworkQuantity,
                  pr.scrap_quantity AS scrapQuantity, pr.lot_no AS lotNo,
                  pr.serial_no AS serialNo, pr.remark, pr.operation_data AS operationData,
                  pr.created_at AS createdAt
           FROM production_reports pr
           INNER JOIN production_tasks t ON t.id = pr.task_id
           INNER JOIN production_work_orders wo ON wo.id = pr.work_order_id
           LEFT JOIN production_work_order_items woi ON woi.id = t.work_order_item_id
           INNER JOIN items i ON i.id = COALESCE(woi.product_item_id, wo.product_item_id)
           INNER JOIN production_processes p ON p.id = pr.process_id
           INNER JOIN users u ON u.id = pr.operator_user_id
           WHERE ${scope.clause}
           ORDER BY pr.id DESC
           LIMIT 500`
      )
      .all(...scope.params) as Array<Record<string, unknown> & { operationData?: string }>;
    return { items: rows.map((row) => ({ ...row, operationData: parseOperationData(row.operationData) })) };
  });

  app.get<{
    Querystring: { processCode?: string };
  }>("/api/production/quality-checks", { preHandler: requirePermission("quality.inspection.view") }, async (request) => {
    const scope = qualityScopeWhere(request.user.id);
    const clauses = [scope.clause];
    const params: Array<string | number> = [...scope.params];
    if (request.query.processCode?.trim()) {
      const processCode = request.query.processCode.trim().toUpperCase();
      assertProcessCodeAuthorization(request.user.id, processCode);
      clauses.push("p.code = ?");
      params.push(processCode);
    }
    return {
      items: db
        .prepare(
          `SELECT qc.id, qc.check_no AS checkNo, qc.quantity, qc.passed_quantity AS passedQuantity,
                  qc.failed_quantity AS failedQuantity, qc.status, qc.check_result AS checkResult,
                  qc.checked_at AS checkedAt, qc.created_at AS createdAt,
                  t.id AS taskId, t.task_no AS taskNo, COALESCE(woi.line_no, 1) AS workOrderItemLineNo,
                  t.flow_status AS taskFlowStatus,
                  wo.work_order_no AS workOrderNo, i.item_code AS productItemCode,
                  i.name AS productItemName, p.code AS processCode, p.name AS processName,
                  wo.execution_status AS executionStatus, wo.termination_type AS terminationType,
                  inspector.display_name AS inspectorName
           FROM production_quality_checks qc
           INNER JOIN production_tasks t ON t.id = qc.task_id
           INNER JOIN production_work_orders wo ON wo.id = qc.work_order_id
           LEFT JOIN production_work_order_items woi ON woi.id = t.work_order_item_id
           INNER JOIN items i ON i.id = COALESCE(woi.product_item_id, wo.product_item_id)
           INNER JOIN production_processes p ON p.id = qc.process_id
           LEFT JOIN users inspector ON inspector.id = qc.inspector_user_id
           WHERE ${clauses.join(" AND ")}
           ORDER BY qc.id DESC
           LIMIT 500`
        )
        .all(...params)
    };
  });

  app.post<{
    Params: { id: string };
    Body: { passedQuantity?: number; failedQuantity?: number; checkResult?: string };
  }>("/api/production/quality-checks/:id/inspect", { preHandler: requirePermission("quality.inspection.manage") }, async (request) => {
    const id = parseId(request.params.id, "质检记录");
    const qualityCheck = db
      .prepare(
        `SELECT qc.id, qc.task_id AS taskId, qc.quantity, qc.status
         FROM production_quality_checks qc
         WHERE qc.id = ?`
      )
      .get(id) as { id: number; taskId: number; quantity: number; status: QualityCheckStatus } | undefined;
    if (!qualityCheck) throw app.httpErrors.notFound("质检记录不存在");
    const task = getTask(qualityCheck.taskId);
    if (!task) throw app.httpErrors.notFound("质检来源工序任务不存在");
    assertQualityManageAccess(request.user.id, task);
    assertWorkOrderExecutionAvailable(task.executionStatus);
    if (!isSystemAdmin(request.user.id) && !isUserAuthorizedForProcess(request.user.id, task.processId)) {
      throw app.httpErrors.forbidden("当前账号没有该工序的质检授权");
    }
    if (qualityCheck.status !== "pending" || task.flowStatus !== "awaiting_quality") {
      throw app.httpErrors.conflict("当前质检记录不能判定");
    }
    const passedQuantity = parseQuantity(request.body.passedQuantity ?? 0, "合格数量", true);
    const failedQuantity = parseQuantity(request.body.failedQuantity ?? 0, "不合格数量", true);
    if (passedQuantity + failedQuantity !== qualityCheck.quantity) {
      throw app.httpErrors.badRequest("质检合格与不合格数量之和必须等于待检数量");
    }
    const inspect = db.transaction(() => {
      db.prepare(
        `UPDATE production_quality_checks
         SET passed_quantity = ?, failed_quantity = ?, status = ?, check_result = ?,
             inspector_user_id = ?, checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        passedQuantity,
        failedQuantity,
        failedQuantity > 0 ? "failed" : "passed",
        request.body.checkResult?.trim() ?? "",
        request.user.id,
        id
      );
      if (failedQuantity > 0) {
        db.prepare(
          `UPDATE production_tasks
           SET good_quantity = good_quantity - ?, defect_quantity = defect_quantity + ?,
               status = 'in_progress', flow_status = 'active', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(failedQuantity, failedQuantity, task.id);
        createRepair({
          workOrderId: task.workOrderId,
          taskId: task.id,
          itemId: task.productItemId,
          quantity: failedQuantity,
          defectCode: "QUALITY_FAIL",
          defectDescription: request.body.checkResult?.trim() || `${task.processName} 质量关卡不合格`,
          createdBy: request.user.id
        });
      }
      routeApprovedTaskOutput(task.id, request.user.id, passedQuantity);
    });
    inspect();
    updateWorkOrderProgress(task.workOrderId);
    recordAudit(request.user.id, "INSPECT", "production_quality_check", id, `完成质检 ${task.taskNo}`, clientIp(request));
    return { item: getTask(task.id) };
  });

  app.get("/api/production/repairs", { preHandler: requirePermission("production.repairs.view") }, async (request) => {
    const scope = repairScopeWhere(request.user.id);
    return {
      items: db
        .prepare(
          `SELECT r.id, r.source_task_id AS taskId, r.repair_no AS repairNo, wo.work_order_no AS workOrderNo,
                  t.task_no AS taskNo, COALESCE(woi.line_no, 1) AS workOrderItemLineNo,
                  i.item_code AS itemCode, i.name AS itemName,
                  r.quantity, r.defect_code AS defectCode, r.defect_description AS defectDescription,
                  r.item_specification AS itemSpecification, r.chip_model AS chipModel,
                  r.chip_name AS chipName, r.chip_spec AS chipSpec,
                  r.source_lot_no AS sourceLotNo, r.source_serial_no AS sourceSerialNo,
                  r.repaired_good_quantity AS repairGoodQuantity,
                   r.repair_defect_quantity AS repairDefectQuantity,
                   r.scrapped_quantity AS scrapQuantity, r.scrap_reason AS scrapReason,
                   r.status, r.repair_action AS repairAction, r.result,
                   wo.execution_status AS executionStatus, wo.termination_type AS terminationType,
                   r.owner_user_id AS ownerUserId, owner.display_name AS ownerName,
                  creator.display_name AS createdByName, r.created_at AS createdAt,
                  r.updated_at AS updatedAt
           FROM production_repairs r
           INNER JOIN production_work_orders wo ON wo.id = r.work_order_id
           INNER JOIN production_tasks t ON t.id = r.source_task_id
           LEFT JOIN production_work_order_items woi ON woi.id = t.work_order_item_id
           LEFT JOIN items i ON i.id = r.item_id
           LEFT JOIN users owner ON owner.id = r.owner_user_id
           INNER JOIN users creator ON creator.id = r.created_by
           WHERE ${scope.clause}
           ORDER BY r.id DESC
           LIMIT 500`
        )
      .all(...scope.params)
    };
  });

  app.get("/api/production/scrap-products", { preHandler: requirePermission("production.scrap-products.view") }, async (request) => {
    const scope = repairScopeWhere(request.user.id);
    return {
      items: db
        .prepare(
          `SELECT ro.id, ro.created_at AS createdAt,
                  r.repair_no AS repairNo, r.work_order_id AS workOrderId,
                  wo.work_order_no AS workOrderNo, t.task_no AS taskNo,
                  COALESCE(woi.line_no, 1) AS workOrderItemLineNo,
                  i.item_code AS itemCode, i.name AS itemName,
                  r.item_specification AS itemSpecification, r.chip_model AS chipModel,
                  r.chip_name AS chipName, r.chip_spec AS chipSpec,
                  r.source_lot_no AS sourceLotNo, r.source_serial_no AS sourceSerialNo,
                  ro.scrap_quantity AS scrapQuantity, ro.scrap_reason AS scrapReason,
                  ro.repair_good_quantity AS repairGoodQuantity,
                  ro.repair_defect_quantity AS repairDefectQuantity,
                  ro.repair_action AS repairAction, ro.result,
                  r.defect_code AS defectCode, r.defect_description AS defectDescription,
                  op.display_name AS operatorName
           FROM production_repair_operations ro
           INNER JOIN production_repairs r ON r.id = ro.repair_id
           INNER JOIN production_tasks t ON t.id = r.source_task_id
           INNER JOIN production_work_orders wo ON wo.id = r.work_order_id
           LEFT JOIN production_work_order_items woi ON woi.id = t.work_order_item_id
           LEFT JOIN items i ON i.id = r.item_id
           INNER JOIN users op ON op.id = ro.operator_user_id
           WHERE ${scope.clause} AND ro.scrap_quantity > 0
           ORDER BY ro.id DESC
           LIMIT 500`
        )
        .all(...scope.params)
    };
  });

  app.post<{
    Body: {
      taskId?: number;
      itemId?: number;
      quantity?: number;
      defectCode?: string;
      defectDescription?: string;
      ownerUserId?: number | null;
    };
  }>("/api/production/repairs", { preHandler: requirePermission("production.repairs.manage") }, async (request) => {
    const taskId = parseOptionalId(request.body.taskId, "来源任务");
    if (!taskId) throw app.httpErrors.badRequest("手工创建维修记录必须关联来源工序任务");
    const task = getTask(taskId);
    if (!task) throw app.httpErrors.notFound("来源工序任务不存在");
    assertRepairManageAccess(request.user.id, task, null);
    assertWorkOrderExecutionAvailable(task.executionStatus);
    assertRepairProcessAuthorization(request.user.id);
    const itemId = parseOptionalId(request.body.itemId, "不良商品") ?? task.productItemId;
    const item = getItem(itemId);
    if (!item || item.status !== "active") throw app.httpErrors.badRequest("不良商品不存在或已停用");
    const quantity = parseQuantity(request.body.quantity, "维修数量");
    const ownerUserId = parseOptionalId(request.body.ownerUserId, "维修负责人");
    if (ownerUserId) {
      try {
        assertRepairOwnerEligibility(ownerUserId, task);
      } catch (error) {
        throw app.httpErrors.badRequest(error instanceof Error ? error.message : "维修负责人不符合派工条件");
      }
    }
    const id = createRepair({
      workOrderId: task.workOrderId,
      taskId: task.id,
      itemId,
      quantity,
      defectCode: request.body.defectCode?.trim() ?? "DEFECT",
      defectDescription: request.body.defectDescription?.trim() ?? "",
      ownerUserId,
      createdBy: request.user.id
    });
    db.prepare("UPDATE production_tasks SET status = 'abnormal', flow_status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
    recordAudit(request.user.id, "CREATE", "production_repair", id, "创建不良维修记录", clientIp(request));
    return { id };
  });

  app.put<{
    Params: { id: string };
    Body: {
      repairGoodQuantity?: number;
      scrapQuantity?: number;
      scrapReason?: string;
      settlementStatus?: "continue" | "complete";
      ownerUserId?: number | null;
    };
  }>("/api/production/repairs/:id", { preHandler: requirePermission("production.repairs.manage") }, async (request) => {
    const id = parseId(request.params.id, "维修记录");
    const repair = db
      .prepare(
        `SELECT r.id, r.status, r.quantity, r.source_task_id AS taskId,
                r.owner_user_id AS ownerUserId, r.repaired_good_quantity AS repairGoodQuantity,
                r.repair_defect_quantity AS repairDefectQuantity,
                r.scrapped_quantity AS scrapQuantity, r.scrap_reason AS scrapReason
         FROM production_repairs r
         WHERE r.id = ?`
      )
      .get(id) as {
      id: number;
      status: RepairStatus;
      quantity: number;
      taskId: number | null;
      ownerUserId: number | null;
      repairGoodQuantity: number;
      repairDefectQuantity: number;
      scrapQuantity: number;
      scrapReason: string;
    } | undefined;
    if (!repair || !repair.taskId) throw app.httpErrors.notFound("维修记录不存在");
    const task = getTask(repair.taskId);
    if (!task) throw app.httpErrors.notFound("来源工序任务不存在");
    assertRepairManageAccess(request.user.id, task, repair.ownerUserId);
    assertWorkOrderExecutionAvailable(task.executionStatus);
    assertRepairProcessAuthorization(request.user.id);
    if (repair.repairDefectQuantity <= QUANTITY_EPSILON) {
      throw app.httpErrors.conflict("该维修单已经完成结算，不能重复处理");
    }
    const ownerUserId = request.body.ownerUserId === undefined ? repair.ownerUserId : parseOptionalId(request.body.ownerUserId, "维修负责人");
    if (ownerUserId) {
      try {
        assertRepairOwnerEligibility(ownerUserId, task);
      } catch (error) {
        throw app.httpErrors.badRequest(error instanceof Error ? error.message : "维修负责人不符合派工条件");
      }
    }
    const repairGoodQuantity = parseQuantity(request.body.repairGoodQuantity ?? 0, "维修合格数量", true);
    const scrapQuantity = parseQuantity(request.body.scrapQuantity ?? 0, "维修报废数量", true);
    const settledQuantity = repairGoodQuantity + scrapQuantity;
    const settlementStatus = request.body.settlementStatus === "continue" ? "continue" : "complete";
    if (settledQuantity <= QUANTITY_EPSILON) {
      throw app.httpErrors.badRequest("请填写本次维修合格或报废数量");
    }
    if (settledQuantity - repair.repairDefectQuantity > QUANTITY_EPSILON) {
      throw app.httpErrors.badRequest("本次维修合格和报废数量之和不能大于当前待维修数量");
    }
    if (settlementStatus === "complete" && repair.repairDefectQuantity - settledQuantity > QUANTITY_EPSILON) {
      throw app.httpErrors.badRequest("选择维修完成时，必须处理完当前待维修数量");
    }
    const scrapReason = request.body.scrapReason?.trim() ?? "";
    if (scrapQuantity > QUANTITY_EPSILON && !scrapReason) {
      throw app.httpErrors.badRequest("存在维修报废数量时必须填写报废原因");
    }
    if (repairGoodQuantity + scrapQuantity > task.defectQuantity + QUANTITY_EPSILON) {
      throw app.httpErrors.conflict("维修结算数量不能大于来源任务当前不良数量");
    }
    const totalRepairGoodQuantity = repair.repairGoodQuantity + repairGoodQuantity;
    const totalScrapQuantity = repair.scrapQuantity + scrapQuantity;
    const nextRepairDefectQuantity = Math.max(repair.repairDefectQuantity - settledQuantity, 0);
    const nextStatus: RepairStatus = nextRepairDefectQuantity > QUANTITY_EPSILON
      ? "repairing"
      : totalRepairGoodQuantity > QUANTITY_EPSILON && totalScrapQuantity > QUANTITY_EPSILON
        ? "closed"
        : totalRepairGoodQuantity > QUANTITY_EPSILON
          ? "returned"
          : "scrapped";
    const nextScrapReason = scrapQuantity > QUANTITY_EPSILON
      ? [repair.scrapReason, `${today()}：${scrapReason}`].filter(Boolean).join("\n")
      : repair.scrapReason;
    const resolve = db.transaction(() => {
      db.prepare(
        `UPDATE production_repairs
         SET status = ?, owner_user_id = ?, repaired_good_quantity = ?, repair_defect_quantity = ?,
             scrapped_quantity = ?, scrap_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        nextStatus,
        ownerUserId,
        totalRepairGoodQuantity,
        nextRepairDefectQuantity,
        totalScrapQuantity,
        nextScrapReason,
        id
      );
      db.prepare(
        `INSERT INTO production_repair_operations
         (repair_id, repair_good_quantity, repair_defect_quantity, scrap_quantity, scrap_reason,
          repair_action, result, operator_user_id)
         VALUES (?, ?, ?, ?, ?, '', '', ?)`
      ).run(
        id,
        repairGoodQuantity,
        nextRepairDefectQuantity,
        scrapQuantity,
        scrapReason,
        request.user.id
      );
      db.prepare(
        `UPDATE production_tasks
         SET good_quantity = good_quantity + ?, defect_quantity = MAX(defect_quantity - ?, 0),
             scrap_quantity = scrap_quantity + ?, status = 'in_progress',
             flow_status = 'active', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(repairGoodQuantity, settledQuantity, scrapQuantity, task.id);
      routeApprovedTaskOutput(task.id, request.user.id, repairGoodQuantity);
    });
    resolve();
    updateWorkOrderProgress(task.workOrderId);
    recordAudit(
      request.user.id,
      "UPDATE",
      "production_repair",
      id,
      `维修结算：合格 ${repairGoodQuantity}，报废 ${scrapQuantity}，状态 ${settlementStatus === "continue" ? "继续维修" : "维修完成"}`,
      clientIp(request)
    );
    return { item: getTask(task.id) };
  });
}
