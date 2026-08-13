import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import sensible from "@fastify/sensible";
import bcrypt from "bcryptjs";
import {
  db,
  getUserAuthorizedProcessCodes,
  getUserPermissions,
  hasPermission,
  initializeDatabase,
  isSystemAdmin,
  permissionDependencies,
  recordAudit
} from "./db.js";
import { seedDemoData } from "./demoSeed.js";
import { registerInventoryRoutes } from "./inventory.js";
import { registerProductionRoutes } from "./production.js";

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

const app = Fastify({ logger: true });
const port = Number(process.env.PORT ?? 43127);
const jwtSecret = process.env.JWT_SECRET ?? "memory-erp-mes-development-secret";

await app.register(cors, {
  origin: ["http://localhost:43128", "http://127.0.0.1:43128"]
});
await app.register(sensible);
await app.register(jwt, { secret: jwtSecret, sign: { expiresIn: "8h" } });

initializeDatabase();
if (process.env.NODE_ENV !== "production" && process.env.SEED_DEMO_DATA === "true") {
  const seeded = seedDemoData();
  if (seeded) app.log.info("已写入本地演示测试数据");
}

function clientIp(request: FastifyRequest) {
  return request.headers["x-forwarded-for"]?.toString().split(",")[0] ?? request.ip;
}

async function authenticate(request: FastifyRequest) {
  try {
    await request.jwtVerify();
  } catch {
    throw app.httpErrors.unauthorized("请先登录");
  }
  const currentUser = db
    .prepare("SELECT status, token_version AS tokenVersion, must_change_password AS mustChangePassword FROM users WHERE id = ?")
    .get(request.user.id) as { status: "active" | "inactive"; tokenVersion: number; mustChangePassword: number } | undefined;
  if (!currentUser || currentUser.status !== "active" || currentUser.tokenVersion !== request.user.tokenVersion) {
    throw app.httpErrors.unauthorized("账号已停用或登录已失效，请重新登录");
  }
  const path = request.url.split("?")[0];
  if (currentUser.mustChangePassword && !["/api/auth/me", "/api/auth/change-password"].includes(path)) {
    throw app.httpErrors.forbidden("当前账号必须先修改初始密码");
  }
}

function requirePermission(code: string) {
  return async (request: FastifyRequest) => {
    await authenticate(request);
    if (!hasPermission(request.user.id, code)) {
      throw app.httpErrors.forbidden("当前账号没有该操作权限");
    }
  };
}

await registerInventoryRoutes(app, { requirePermission, clientIp });
await registerProductionRoutes(app, { requirePermission, clientIp });

function getUserProfile(userId: number) {
  const user = db
    .prepare(
      `
        SELECT u.id, u.username, u.display_name AS displayName, u.employee_no AS employeeNo,
               u.position, u.status, u.last_login_at AS lastLoginAt,
               u.must_change_password AS mustChangePassword,
               d.id AS departmentId, d.name AS departmentName
        FROM users u
        LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.id = ?
      `
    )
    .get(userId) as Record<string, unknown> | undefined;
  if (!user) return null;
  const roles = db
    .prepare(
      `
        SELECT r.id, r.name, r.code
        FROM roles r
        INNER JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = ? AND r.status = 'active'
        ORDER BY r.id
      `
    )
    .all(userId);
  const managedDepartments = db
    .prepare(
      `
        SELECT d.id, d.name, d.code
        FROM departments d
        INNER JOIN department_managers dm ON dm.department_id = d.id
        WHERE dm.user_id = ? AND d.status = 'active'
        ORDER BY d.id
      `
    )
    .all(userId);
  return {
    ...user,
    roles,
    managedDepartments,
    permissions: getUserPermissions(userId),
    authorizedProcessCodes: getUserAuthorizedProcessCodes(userId)
  };
}

function ensureSystemAdmin(userId: number) {
  if (!isSystemAdmin(userId)) throw app.httpErrors.forbidden("只有系统总管理员可以执行该操作");
}

function ensurePassword(password: string) {
  if (password.length < 10) throw app.httpErrors.badRequest("密码至少需要 10 位");
}

function ensureActiveDepartment(departmentId: number | null | undefined, label = "所属部门") {
  if (departmentId == null) return null;
  const department = db
    .prepare("SELECT id FROM departments WHERE id = ? AND status = 'active'")
    .get(departmentId) as { id: number } | undefined;
  if (!department) throw app.httpErrors.badRequest(`${label}不存在或已停用`);
  return department.id;
}

function ensureActiveRoleIds(roleIds: number[], required = true) {
  const ids = [...new Set(roleIds.map(Number))].filter((id) => Number.isInteger(id) && id > 0);
  if (required && !ids.length) throw app.httpErrors.badRequest("员工必须至少分配一个启用角色");
  if (!ids.length) return ids;
  const rows = db
    .prepare(`SELECT id FROM roles WHERE status = 'active' AND id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as Array<{ id: number }>;
  if (rows.length !== ids.length) throw app.httpErrors.badRequest("角色不存在或已停用");
  return ids;
}

function ensureManagedDepartmentIds(departmentIds: number[]) {
  const ids = [...new Set(departmentIds.map(Number))].filter((id) => Number.isInteger(id) && id > 0);
  for (const id of ids) ensureActiveDepartment(id, "经理管理部门");
  return ids;
}

function getSystemAdminRoleId() {
  return (db.prepare("SELECT id FROM roles WHERE code = 'SYSTEM_ADMIN'").get() as { id: number }).id;
}

function validatePermissionDependencies(permissionIds: number[]) {
  if (!permissionIds.length) return;
  const rows = db
    .prepare(`SELECT id, code, label FROM permissions WHERE id IN (${permissionIds.map(() => "?").join(",")})`)
    .all(...permissionIds) as Array<{ id: number; code: string; label: string }>;
  const selectedCodes = new Set(rows.map((permission) => permission.code));
  for (const permission of rows) {
    const missing = (permissionDependencies[permission.code] ?? []).find((dependency) => !selectedCodes.has(dependency));
    if (missing) throw app.httpErrors.badRequest(`权限“${permission.label}”依赖“${missing}”，请一并授予`);
  }
}

app.get("/api/health", async () => ({
  ok: true,
  service: "memory-erp-mes-api",
  timestamp: new Date().toISOString()
}));

app.post<{
  Body: { username?: string; password?: string };
}>("/api/auth/login", async (request, reply) => {
  const username = request.body.username?.trim();
  const password = request.body.password ?? "";
  if (!username || !password) {
    throw app.httpErrors.badRequest("请输入账号和密码");
  }

  const user = db
    .prepare(
      "SELECT id, username, password_hash AS passwordHash, display_name AS displayName, status, token_version AS tokenVersion FROM users WHERE username = ?"
    )
    .get(username) as
    | {
        id: number;
        username: string;
        passwordHash: string;
        displayName: string;
        status: string;
        tokenVersion: number;
      }
    | undefined;
  if (!user || user.status !== "active" || !bcrypt.compareSync(password, user.passwordHash)) {
    recordAudit(user?.id ?? null, "LOGIN_FAILED", "auth", null, `账号 ${username} 登录失败`, clientIp(request));
    throw app.httpErrors.unauthorized("账号或密码错误");
  }

  db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
  recordAudit(user.id, "LOGIN", "auth", user.id, "登录成功", clientIp(request));
  const token = await reply.jwtSign({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    tokenVersion: user.tokenVersion
  });
  return { token, user: getUserProfile(user.id) };
});

app.get("/api/auth/me", { preHandler: authenticate }, async (request) => {
  return { user: getUserProfile(request.user.id) };
});

app.post<{
  Body: { currentPassword?: string; newPassword?: string };
}>("/api/auth/change-password", { preHandler: authenticate }, async (request, reply) => {
  const currentPassword = request.body.currentPassword ?? "";
  const newPassword = request.body.newPassword ?? "";
  ensurePassword(newPassword);
  if (newPassword === currentPassword) throw app.httpErrors.badRequest("新密码不能与当前密码相同");
  const user = db
    .prepare("SELECT id, username, display_name AS displayName, password_hash AS passwordHash, token_version AS tokenVersion FROM users WHERE id = ?")
    .get(request.user.id) as { id: number; username: string; displayName: string; passwordHash: string; tokenVersion: number } | undefined;
  if (!user || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
    throw app.httpErrors.unauthorized("当前密码不正确");
  }
  const nextTokenVersion = user.tokenVersion + 1;
  db.prepare(
    "UPDATE users SET password_hash = ?, token_version = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(bcrypt.hashSync(newPassword, 10), nextTokenVersion, user.id);
  recordAudit(user.id, "PASSWORD_CHANGE", "user", user.id, "修改登录密码", clientIp(request));
  const token = await reply.jwtSign({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    tokenVersion: nextTokenVersion
  });
  return { token, user: getUserProfile(user.id) };
});

app.get("/api/dashboard", { preHandler: requirePermission("system.dashboard.view") }, async () => {
  const users = db.prepare("SELECT COUNT(*) AS count FROM users WHERE status = 'active'").get() as {
    count: number;
  };
  const roles = db.prepare("SELECT COUNT(*) AS count FROM roles WHERE status = 'active'").get() as {
    count: number;
  };
  const departments = db
    .prepare("SELECT COUNT(*) AS count FROM departments WHERE status = 'active'")
    .get() as { count: number };
  const audits = db
    .prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE date(created_at) = date('now')")
    .get() as { count: number };
  return {
    cards: [
      { key: "users", label: "启用员工", value: users.count, tone: "blue" },
      { key: "roles", label: "启用角色", value: roles.count, tone: "green" },
      { key: "departments", label: "组织部门", value: departments.count, tone: "amber" },
      { key: "audits", label: "今日审计事件", value: audits.count, tone: "red" }
    ],
    todo: [
      { title: "账号与岗位权限初始化", status: "当前阶段", detail: "完善员工、部门、角色和权限数据" },
      { title: "生产工序权限预留", status: "下一阶段", detail: "接入工单、工序任务和人工报工" },
      { title: "质量与仓储模块预留", status: "后续扩展", detail: "接入库存状态、测试、维修和放行" }
    ]
  };
});

app.get("/api/permissions", { preHandler: requirePermission("system.roles.view") }, async () => {
  const permissions = db.prepare("SELECT id, code, module, action, label FROM permissions ORDER BY module, id").all() as Array<{
    id: number;
    code: string;
    module: string;
    action: string;
    label: string;
  }>;
  return {
    items: permissions.map((permission) => ({
      ...permission,
      dependencies: permissionDependencies[permission.code] ?? []
    }))
  };
});

app.get("/api/departments", { preHandler: requirePermission("system.departments.view") }, async () => {
  return {
    items: db
      .prepare(
        `
          SELECT d.id, d.name, d.code, d.description, d.status,
                 COUNT(u.id) AS userCount
          FROM departments d
          LEFT JOIN users u ON u.department_id = d.id
          GROUP BY d.id
          ORDER BY d.id
        `
      )
      .all()
  };
});

app.post<{
  Body: { name?: string; code?: string; description?: string };
}>("/api/departments", { preHandler: requirePermission("system.departments.manage") }, async (request) => {
  const name = request.body.name?.trim();
  const code = request.body.code?.trim().toUpperCase();
  const description = request.body.description?.trim() ?? "";
  if (!name || !code) throw app.httpErrors.badRequest("部门名称和编码不能为空");
  try {
    const result = db
      .prepare("INSERT INTO departments (name, code, description) VALUES (?, ?, ?)")
      .run(name, code, description);
    const departmentId = Number(result.lastInsertRowid);
    recordAudit(request.user.id, "CREATE", "department", departmentId, `创建部门 ${name}`, clientIp(request));
    return { item: db.prepare("SELECT * FROM departments WHERE id = ?").get(departmentId) };
  } catch {
    throw app.httpErrors.conflict("部门名称或编码已存在");
  }
});

app.get("/api/users", { preHandler: requirePermission("system.users.view") }, async () => {
  return {
    items: db
      .prepare(
        `
          SELECT u.id, u.username, u.display_name AS displayName, u.employee_no AS employeeNo,
                 u.position, u.status, u.last_login_at AS lastLoginAt,
                 d.id AS departmentId, d.name AS departmentName,
                 COALESCE(GROUP_CONCAT(r.name, '、'), '') AS roleNames,
                 COALESCE(GROUP_CONCAT(r.code, ','), '') AS roleCodes,
                 COALESCE(GROUP_CONCAT(r.id, ','), '') AS roleIds,
                 COALESCE(
                   (SELECT GROUP_CONCAT(dm.department_id, ',')
                    FROM department_managers dm
                    WHERE dm.user_id = u.id),
                   ''
                 ) AS managedDepartmentIds
          FROM users u
          LEFT JOIN departments d ON d.id = u.department_id
          LEFT JOIN user_roles ur ON ur.user_id = u.id
          LEFT JOIN roles r ON r.id = ur.role_id
          GROUP BY u.id
          ORDER BY u.id DESC
        `
      )
      .all()
  };
});

app.post<{
  Body: {
    username?: string;
    password?: string;
    displayName?: string;
    employeeNo?: string;
    position?: string;
                 departmentId?: number | null;
    roleIds?: number[];
    managedDepartmentIds?: number[];
  };
}>("/api/users", { preHandler: requirePermission("system.users.manage") }, async (request) => {
  ensureSystemAdmin(request.user.id);
  const { username, password, displayName, employeeNo, position, departmentId, roleIds = [], managedDepartmentIds = [] } = request.body;
  if (!username?.trim() || !password || !displayName?.trim() || !employeeNo?.trim()) {
    throw app.httpErrors.badRequest("账号、密码、姓名和工号不能为空");
  }
  ensurePassword(password);
  const resolvedDepartmentId = ensureActiveDepartment(departmentId);
  const resolvedRoleIds = ensureActiveRoleIds(roleIds);
  const resolvedManagedDepartmentIds = ensureManagedDepartmentIds(managedDepartmentIds);
  const insert = db.transaction(() => {
    const result = db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, employee_no, position, department_id, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)"
      )
      .run(
        username.trim(),
        bcrypt.hashSync(password, 10),
        displayName.trim(),
        employeeNo.trim(),
        position?.trim() ?? "",
        resolvedDepartmentId
      );
    const insertRole = db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)");
    for (const roleId of resolvedRoleIds) insertRole.run(result.lastInsertRowid, roleId);
    const insertManagerDepartment = db.prepare(
      "INSERT OR IGNORE INTO department_managers (department_id, user_id) VALUES (?, ?)"
    );
    for (const managedDepartmentId of resolvedManagedDepartmentIds) insertManagerDepartment.run(managedDepartmentId, result.lastInsertRowid);
    return result.lastInsertRowid;
  });
  try {
    const id = insert();
    recordAudit(request.user.id, "CREATE", "user", Number(id), `创建员工账号 ${username}`, clientIp(request));
    return { item: getUserProfile(Number(id)) };
  } catch {
    throw app.httpErrors.conflict("账号或工号已存在");
  }
});

app.put<{
  Params: { id: string };
  Body: {
    displayName?: string;
    employeeNo?: string;
    position?: string;
    departmentId?: number | null;
    status?: "active" | "inactive";
    password?: string;
    roleIds?: number[];
    managedDepartmentIds?: number[];
  };
}>("/api/users/:id", { preHandler: requirePermission("system.users.manage") }, async (request) => {
  ensureSystemAdmin(request.user.id);
  const id = Number(request.params.id);
  const existing = db.prepare("SELECT id, username, department_id AS departmentId, status FROM users WHERE id = ?").get(id) as
    | { id: number; username: string; departmentId: number | null; status: "active" | "inactive" }
    | undefined;
  if (!existing) throw app.httpErrors.notFound("员工账号不存在");

  const { displayName, employeeNo, position, departmentId, status, password, roleIds = [], managedDepartmentIds = [] } = request.body;
  if (password) ensurePassword(password);
  const nextDepartmentId = departmentId === undefined ? existing.departmentId : ensureActiveDepartment(departmentId);
  const nextRoleIds = request.body.roleIds === undefined ? null : ensureActiveRoleIds(roleIds);
  const nextManagedDepartmentIds = request.body.managedDepartmentIds === undefined ? null : ensureManagedDepartmentIds(managedDepartmentIds);
  const systemAdminRoleId = getSystemAdminRoleId();
  const existingIsSystemAdmin = isSystemAdmin(id);
  if (
    id === request.user.id &&
    ((status === "inactive") || (nextRoleIds !== null && !nextRoleIds.includes(systemAdminRoleId)))
  ) {
    throw app.httpErrors.conflict("不能移除当前登录账号的系统管理员权限或停用自己");
  }
  if (existingIsSystemAdmin && (status === "inactive" || (nextRoleIds !== null && !nextRoleIds.includes(systemAdminRoleId)))) {
    const activeSystemAdminCount = db
      .prepare(
        `SELECT COUNT(DISTINCT u.id) AS count
         FROM users u
         INNER JOIN user_roles ur ON ur.user_id = u.id
         WHERE ur.role_id = ? AND u.status = 'active'`
      )
      .get(systemAdminRoleId) as { count: number };
    if (activeSystemAdminCount.count <= 1) throw app.httpErrors.conflict("系统至少需要保留一名启用的系统总管理员");
  }
  const update = db.transaction(() => {
    db.prepare(
      `
        UPDATE users
        SET display_name = COALESCE(?, display_name),
            employee_no = COALESCE(?, employee_no),
            position = COALESCE(?, position),
             department_id = ?,
             status = COALESCE(?, status),
             password_hash = COALESCE(?, password_hash),
             token_version = token_version + 1,
             must_change_password = CASE WHEN ? IS NULL THEN must_change_password ELSE 1 END,
             updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(
      displayName?.trim() || null,
      employeeNo?.trim() || null,
      position?.trim() ?? null,
       nextDepartmentId,
       status ?? null,
       password ? bcrypt.hashSync(password, 10) : null,
       password ? 1 : null,
       id
     );
    if (request.body.roleIds) {
      db.prepare("DELETE FROM user_roles WHERE user_id = ?").run(id);
      const insertRole = db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)");
      for (const roleId of nextRoleIds ?? []) insertRole.run(id, roleId);
    }
    if (request.body.managedDepartmentIds) {
      db.prepare("DELETE FROM department_managers WHERE user_id = ?").run(id);
      const insertManagerDepartment = db.prepare(
        "INSERT OR IGNORE INTO department_managers (department_id, user_id) VALUES (?, ?)"
      );
      for (const managedDepartmentId of nextManagedDepartmentIds ?? []) insertManagerDepartment.run(managedDepartmentId, id);
    }
  });
  try {
    update();
    recordAudit(request.user.id, "UPDATE", "user", id, `更新员工账号 ${existing.username}`, clientIp(request));
    return { item: getUserProfile(id) };
  } catch {
    throw app.httpErrors.conflict("工号已存在或数据不合法");
  }
});

app.get("/api/roles", { preHandler: requirePermission("system.roles.view") }, async () => {
  return {
    items: db
      .prepare(
        `
          SELECT r.id, r.name, r.code, r.description, r.status,
                 COUNT(DISTINCT ur.user_id) AS userCount,
                 COUNT(DISTINCT rp.permission_id) AS permissionCount
          FROM roles r
          LEFT JOIN user_roles ur ON ur.role_id = r.id
          LEFT JOIN role_permissions rp ON rp.role_id = r.id
          GROUP BY r.id
          ORDER BY r.id
        `
      )
      .all()
  };
});

app.post<{
  Body: { name?: string; code?: string; description?: string };
}>("/api/roles", { preHandler: requirePermission("system.roles.manage") }, async (request) => {
  ensureSystemAdmin(request.user.id);
  const name = request.body.name?.trim();
  const code = request.body.code?.trim().toUpperCase();
  const description = request.body.description?.trim() ?? "";
  if (!name || !code) throw app.httpErrors.badRequest("角色名称和编码不能为空");
  try {
    const result = db
      .prepare("INSERT INTO roles (name, code, description) VALUES (?, ?, ?)")
      .run(name, code, description);
    const roleId = Number(result.lastInsertRowid);
    recordAudit(request.user.id, "CREATE", "role", roleId, `创建角色 ${name}`, clientIp(request));
    return { item: db.prepare("SELECT * FROM roles WHERE id = ?").get(roleId) };
  } catch {
    throw app.httpErrors.conflict("角色名称或编码已存在");
  }
});

app.get<{
  Params: { id: string };
}>("/api/roles/:id", { preHandler: requirePermission("system.roles.view") }, async (request) => {
  const id = Number(request.params.id);
  const role = db.prepare("SELECT id, name, code, description, status FROM roles WHERE id = ?").get(id);
  if (!role) throw app.httpErrors.notFound("角色不存在");
  const permissions = db
    .prepare(
      `
        SELECT p.id, p.code, p.module, p.action, p.label,
               CASE WHEN rp.permission_id IS NULL THEN 0 ELSE 1 END AS enabled
        FROM permissions p
        LEFT JOIN role_permissions rp ON rp.permission_id = p.id AND rp.role_id = ?
        ORDER BY p.module, p.id
      `
    )
    .all(id) as Array<{
      id: number;
      code: string;
      module: string;
      action: string;
      label: string;
      enabled: number;
    }>;
  return {
    role,
    permissions: permissions.map((permission) => ({
      ...permission,
      dependencies: permissionDependencies[permission.code] ?? []
    }))
  };
});

app.put<{
  Params: { id: string };
  Body: { name?: string; description?: string; permissionIds?: number[] };
}>("/api/roles/:id", { preHandler: requirePermission("system.roles.manage") }, async (request) => {
  ensureSystemAdmin(request.user.id);
  const id = Number(request.params.id);
  const existing = db.prepare("SELECT id, code FROM roles WHERE id = ?").get(id) as
    | { id: number; code: string }
    | undefined;
  if (!existing) throw app.httpErrors.notFound("角色不存在");

  const permissionIds = [...new Set((request.body.permissionIds ?? []).map(Number))].filter((permissionId) => Number.isInteger(permissionId) && permissionId > 0);
  if (request.body.permissionIds === undefined) throw app.httpErrors.badRequest("请明确提交角色权限");
  const validPermissionCount = permissionIds.length
    ? (db.prepare(`SELECT COUNT(*) AS count FROM permissions WHERE id IN (${permissionIds.map(() => "?").join(",")})`).get(...permissionIds) as { count: number }).count
    : 0;
  if (validPermissionCount !== permissionIds.length) throw app.httpErrors.badRequest("存在无效权限");
  validatePermissionDependencies(permissionIds);
  if (existing.code !== "SYSTEM_ADMIN" && permissionIds.length) {
    const restrictedCodes = ["system.users.manage", "system.roles.manage"];
    const restrictedCount = (
      db
        .prepare(`SELECT COUNT(*) AS count FROM permissions WHERE id IN (${permissionIds.map(() => "?").join(",")}) AND code IN (?, ?)`)
        .get(...permissionIds, ...restrictedCodes) as { count: number }
    ).count;
    if (restrictedCount > 0) {
      throw app.httpErrors.forbidden("员工账号与角色授权仅限系统总管理员角色");
    }
  }
  if (existing.code === "SYSTEM_ADMIN") {
    const totalPermissionCount = (db.prepare("SELECT COUNT(*) AS count FROM permissions").get() as { count: number }).count;
    if (permissionIds.length !== totalPermissionCount) throw app.httpErrors.conflict("系统总管理员角色必须保留全部系统权限");
  }
  db.transaction(() => {
    db.prepare(
      "UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(request.body.name?.trim() || null, request.body.description?.trim() ?? null, id);
    db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(id);
    const insertPermission = db.prepare(
      "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)"
    );
    for (const permissionId of permissionIds) insertPermission.run(id, permissionId);
  })();
  recordAudit(request.user.id, "UPDATE", "role", id, `更新角色 ${existing.code} 的权限`, clientIp(request));
  return { item: db.prepare("SELECT * FROM roles WHERE id = ?").get(id) };
});

app.get("/api/audit-logs", { preHandler: requirePermission("system.audit.view") }, async () => {
  return {
    items: db
      .prepare(
        `
          SELECT a.id, a.action, a.resource, a.resource_id AS resourceId,
                 a.detail, a.ip_address AS ipAddress, a.created_at AS createdAt,
                 u.display_name AS displayName, u.username
          FROM audit_logs a
          LEFT JOIN users u ON u.id = a.user_id
          ORDER BY a.id DESC
          LIMIT 200
        `
      )
      .all()
  };
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const knownError = error as { statusCode?: number; message?: string };
  const statusCode = knownError.statusCode && knownError.statusCode >= 400 ? knownError.statusCode : 500;
  reply.status(statusCode).send({
    message: statusCode === 500 ? "服务器内部错误" : knownError.message
  });
});

app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`ERP/MES API listening on http://localhost:${port}`);
});
