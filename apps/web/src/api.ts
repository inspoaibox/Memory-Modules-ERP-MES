const API_BASE = "/api";

export type Permission = {
  id: number;
  code: string;
  module: string;
  action: string;
  label: string;
  dependencies?: string[];
};

export type UserProfile = {
  id: number;
  username: string;
  displayName: string;
  employeeNo: string;
  position: string;
  departmentId: number | null;
  departmentName: string | null;
  status: "active" | "inactive";
  mustChangePassword: number;
  lastLoginAt: string | null;
  roles: Array<{ id: number; name: string; code: string }>;
  managedDepartments: Array<{ id: number; name: string; code: string }>;
  permissions: Permission[];
  authorizedProcessCodes: string[];
};

export type UserListItem = Omit<UserProfile, "roles" | "permissions"> & {
  roleNames: string;
  roleCodes: string;
  roleIds: string;
  managedDepartmentIds: string;
};

export type User = UserProfile;

export type Department = {
  id: number;
  name: string;
  code: string;
  description: string;
  status: "active" | "inactive";
  userCount: number;
};

export type Role = {
  id: number;
  name: string;
  code: string;
  description: string;
  status: "active" | "inactive";
  userCount: number;
  permissionCount: number;
};

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("memory-erp-token");
  const method = (options.method ?? "GET").toUpperCase();
  const hasJsonBody = options.body !== undefined && options.body !== null;
  const requestBody =
    !hasJsonBody && !["GET", "HEAD"].includes(method) ? JSON.stringify({}) : options.body;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    body: requestBody,
    headers: {
      ...(requestBody !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {})
    }
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("memory-erp-token");
      window.dispatchEvent(new Event("memory-erp-logout"));
    }
    throw new Error(body.message ?? "请求失败");
  }
  return body as T;
}

export function login(username: string, password: string) {
  return request<{ token: string; user: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}
