import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Factory,
  FileClock,
  FileSpreadsheet,
  LayoutDashboard,
  Layers3,
  ListTree,
  LockKeyhole,
  LogOut,
  Menu,
  Package,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Settings2,
  SlidersHorizontal,
  UserCog,
  Users,
  Warehouse,
  ArchiveRestore,
  Wrench,
  Trash2,
  X
} from "lucide-react";
import {
  Permission,
  Role,
  User,
  UserListItem,
  login,
  request
} from "./api";
import {
  InventoryBalancesPage,
  InventoryCountPage,
  InventoryDocumentsPage,
  InventoryIssuePage,
  InventoryLedgerPage,
  InventoryOverviewPage,
  InventoryReceiptPage,
  InventoryScrapPage,
  InventoryTransferPage,
  InventoryWarehousesPage,
  ProductAttributesPage,
  ProductCategoriesPage,
  ProductItemsPage,
  ProductUnitsPage
} from "./InventoryPage";
import {
  ProductionOverviewPage,
  ProductionProcessesPage,
  ProductionRoutesPage,
  ProductionWorkOrdersPage,
  ProductionTasksPage,
  ProductionReportsPage,
  ProductionRepairsPage,
  ProductionScrapProductsPage,
  ProductionQualityPage
} from "./ProductionPage";
import { ProductionStationPage } from "./ProductionStationPage";

type Page =
  | "dashboard"
  | "users"
  | "roles"
  | "departments"
  | "audit"
  | "production-overview"
  | "production-bga"
  | "production-disassembly"
  | "production-assembly"
  | "production-chip-initial-test"
  | "production-outsource"
  | "production-chip-retest"
  | "production-smt"
  | "production-aging"
  | "production-fqc"
  | "production-processes"
  | "production-routes"
  | "production-workorders"
  | "production-tasks"
  | "production-reports"
  | "production-repairs"
  | "production-scrap-products"
  | "quality"
  | "product-items"
  | "product-categories"
  | "product-units"
  | "product-attributes"
  | "inventory-overview"
  | "inventory-warehouses"
  | "inventory-balances"
  | "inventory-receipts"
  | "inventory-issues"
  | "inventory-transfers"
  | "inventory-counts"
  | "inventory-scrap"
  | "inventory-documents"
  | "inventory-ledger";

type NavSection = "system" | "products" | "production" | "production-settings" | "inventory";

type NavItem = {
  key: Page;
  label: string;
  icon: typeof LayoutDashboard;
  permission: string;
  group: string;
  section?: NavSection;
  processCode?: string;
};

type ProcessOption = {
  id: number;
  code: string;
  name: string;
  processType: string;
  status: "active" | "inactive";
};

const pageLabels: Record<Page, string> = {
  dashboard: "工作台",
  users: "系统设置 / 员工账号",
  roles: "系统设置 / 工序角色权限",
  departments: "系统设置 / 工序流程",
  audit: "系统设置 / 操作审计",
  "production-overview": "生产管理 / 工作台",
  "production-bga": "生产管理 / 芯片拆卸植球",
  "production-disassembly": "生产管理 / 生产拆解",
  "production-assembly": "生产管理 / 生产组装",
  "production-chip-initial-test": "生产管理 / 芯片初测",
  "production-outsource": "生产管理 / 委外加工",
  "production-chip-retest": "生产管理 / 委外回厂复测",
  "production-smt": "生产管理 / SMT贴片",
  "production-aging": "生产管理 / 成品测试老化",
  "production-fqc": "生产管理 / 日检合格成品入库",
  "production-repairs": "生产管理 / 不良维修",
  "production-scrap-products": "生产管理 / 报废产品",
  "production-processes": "生产基础设置 / 工序定义",
  "production-routes": "生产基础设置 / 工艺路线",
  "production-workorders": "生产管理 / 生产计划与工单",
  "production-tasks": "生产基础设置 / 工序任务中心",
  "production-reports": "生产基础设置 / 报工记录",
  quality: "质量管理",
  "product-items": "商品管理 / 商品资料",
  "product-categories": "商品管理 / 商品分类",
  "product-units": "商品管理 / 计量单位",
  "product-attributes": "商品管理 / 商品属性",
  "inventory-overview": "库存管理 / 库存工作台",
  "inventory-warehouses": "库存管理 / 仓库管理",
  "inventory-balances": "库存管理 / 库存查询",
  "inventory-receipts": "库存管理 / 商品入库",
  "inventory-issues": "库存管理 / 商品出库",
  "inventory-transfers": "库存管理 / 仓库调拨",
  "inventory-counts": "库存管理 / 库存盘点",
  "inventory-scrap": "库存管理 / 商品报废",
  "inventory-documents": "库存管理 / 出入库记录",
  "inventory-ledger": "库存管理 / 库存台账"
};

const legacyPageMap: Record<string, Page> = {
  inventory: "inventory-overview",
  "inventory-items": "product-items",
  "inventory-categories": "product-categories",
  "inventory-units": "product-units",
  "inventory-attributes": "product-attributes",
  production: "production-overview"
};

const normalizeStoredPage = (stored: string | null): Page => {
  if (!stored) return "dashboard";
  return legacyPageMap[stored] ?? (stored in pageLabels ? stored as Page : "dashboard");
};

const navItems: NavItem[] = [
  { key: "dashboard", label: "工作台", icon: LayoutDashboard, permission: "system.dashboard.view", group: "总览" },
  { key: "users", label: "员工账号", icon: Users, permission: "system.users.view", group: "系统管理", section: "system" },
  { key: "roles", label: "工序角色权限", icon: ShieldCheck, permission: "system.roles.view", group: "系统管理", section: "system" },
  { key: "departments", label: "工序流程", icon: Building2, permission: "system.departments.view", group: "系统管理", section: "system" },
  { key: "audit", label: "操作审计", icon: FileClock, permission: "system.audit.view", group: "系统管理", section: "system" },
  { key: "production-overview", label: "生产工作台", icon: Factory, permission: "production.dashboard.view", group: "业务模块", section: "production" },
  { key: "production-workorders", label: "生产计划与工单", icon: PackageCheck, permission: "production.workorders.view", group: "业务模块", section: "production" },
  { key: "production-disassembly", label: "生产拆解", icon: PackageMinus, permission: "production.tasks.view", group: "业务模块", section: "production", processCode: "PROC-DISASSEMBLY" },
  { key: "production-assembly", label: "生产组装", icon: PackagePlus, permission: "production.tasks.view", group: "业务模块", section: "production", processCode: "PROC-ASSEMBLY" },
  { key: "production-bga", label: "芯片拆卸植球", icon: Wrench, permission: "production.tasks.view", group: "业务模块", section: "production", processCode: "PROC-BGA" },
  { key: "production-chip-initial-test", label: "芯片初测", icon: ClipboardCheck, permission: "production.tasks.view", group: "业务模块", section: "production", processCode: "PROC-CHIP-TEST" },
  { key: "production-outsource", label: "委外加工", icon: ArrowLeftRight, permission: "production.tasks.view", group: "业务模块", section: "production", processCode: "PROC-OUTSOURCE" },
  { key: "production-chip-retest", label: "委外回厂复测", icon: RefreshCw, permission: "production.tasks.view", group: "业务模块", section: "production", processCode: "PROC-CHIP-RETEST" },
  { key: "production-smt", label: "SMT贴片", icon: Settings2, permission: "production.tasks.view", group: "业务模块", section: "production", processCode: "PROC-SMT" },
  { key: "production-aging", label: "成品测试老化", icon: Activity, permission: "production.tasks.view", group: "业务模块", section: "production", processCode: "PROC-AGING" },
  { key: "production-fqc", label: "日检合格成品入库", icon: PackageCheck, permission: "production.tasks.view", group: "业务模块", section: "production", processCode: "PROC-FQC" },
  { key: "production-repairs", label: "不良维修", icon: Wrench, permission: "production.repairs.view", group: "业务模块", section: "production" },
  { key: "production-scrap-products", label: "报废产品", icon: Trash2, permission: "production.scrap-products.view", group: "业务模块", section: "production" },
  { key: "production-processes", label: "工序定义", icon: ClipboardCheck, permission: "production.processes.view", group: "业务模块", section: "production-settings" },
  { key: "production-routes", label: "工艺路线", icon: Settings2, permission: "production.routes.view", group: "业务模块", section: "production-settings" },
  { key: "production-tasks", label: "工序任务中心", icon: SlidersHorizontal, permission: "production.tasks.view", group: "业务模块", section: "production-settings" },
  { key: "production-reports", label: "报工记录", icon: FileSpreadsheet, permission: "production.reports.view", group: "业务模块", section: "production-settings" },
  { key: "product-items", label: "商品资料", icon: Package, permission: "inventory.items.view", group: "业务模块", section: "products" },
  { key: "product-categories", label: "商品分类", icon: ListTree, permission: "inventory.categories.view", group: "业务模块", section: "products" },
  { key: "product-attributes", label: "商品属性", icon: FileSpreadsheet, permission: "inventory.attributes.view", group: "业务模块", section: "products" },
  { key: "product-units", label: "计量单位", icon: Layers3, permission: "inventory.units.view", group: "业务模块", section: "products" },
  { key: "inventory-overview", label: "库存工作台", icon: LayoutDashboard, permission: "inventory.dashboard.view", group: "业务模块", section: "inventory" },
  { key: "inventory-warehouses", label: "仓库管理", icon: Warehouse, permission: "inventory.warehouses.view", group: "业务模块", section: "inventory" },
  { key: "inventory-balances", label: "库存查询", icon: ArchiveRestore, permission: "inventory.balance.view", group: "业务模块", section: "inventory" },
  { key: "inventory-receipts", label: "商品入库", icon: PackagePlus, permission: "inventory.documents.view", group: "业务模块", section: "inventory" },
  { key: "inventory-issues", label: "商品出库", icon: PackageMinus, permission: "inventory.documents.view", group: "业务模块", section: "inventory" },
  { key: "inventory-transfers", label: "仓库调拨", icon: ArrowLeftRight, permission: "inventory.documents.view", group: "业务模块", section: "inventory" },
  { key: "inventory-counts", label: "库存盘点", icon: ClipboardCheck, permission: "inventory.documents.view", group: "业务模块", section: "inventory" },
  { key: "inventory-scrap", label: "商品报废", icon: Trash2, permission: "inventory.documents.view", group: "业务模块", section: "inventory" },
  { key: "inventory-documents", label: "出入库记录", icon: ClipboardList, permission: "inventory.documents.view", group: "业务模块", section: "inventory" },
  { key: "inventory-ledger", label: "库存台账", icon: FileSpreadsheet, permission: "inventory.ledger.view", group: "业务模块", section: "inventory" }
];

const navSections: Array<{
  key: NavSection;
  label: string;
  icon: typeof LayoutDashboard;
  group: string;
  isActive: (page: Page) => boolean;
}> = [
  { key: "system", label: "系统设置", icon: Settings2, group: "系统管理", isActive: (page) => ["users", "roles", "departments", "audit"].includes(page) },
  { key: "products", label: "商品管理", icon: PackageCheck, group: "业务模块", isActive: (page) => page.startsWith("product-") },
  { key: "production", label: "生产管理", icon: Factory, group: "业务模块", isActive: (page) => ["production-overview", "production-workorders", "production-disassembly", "production-assembly", "production-bga", "production-chip-initial-test", "production-outsource", "production-chip-retest", "production-smt", "production-aging", "production-fqc", "production-repairs", "production-scrap-products"].includes(page) },
  { key: "production-settings", label: "生产基础设置", icon: Settings2, group: "业务模块", isActive: (page) => ["production-tasks", "production-reports", "production-processes", "production-routes"].includes(page) },
  { key: "inventory", label: "库存管理", icon: Warehouse, group: "业务模块", isActive: (page) => page.startsWith("inventory-") }
];

const hasPermission = (user: User | null, code: string) =>
  Boolean(user?.permissions.some((permission) => permission.code === code));

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>(() => {
    const stored = window.localStorage.getItem("memory-erp-page");
    const normalized = normalizeStoredPage(stored);
    if (stored && stored !== normalized) {
      window.localStorage.setItem("memory-erp-page", normalized);
    }
    return normalized;
  });

  useEffect(() => {
    const token = localStorage.getItem("memory-erp-token");
    if (!token) {
      setLoading(false);
      return;
    }
    request<{ user: User }>("/auth/me")
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch(() => localStorage.removeItem("memory-erp-token"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onLogout = () => {
      setUser(null);
      setLoading(false);
    };
    window.addEventListener("memory-erp-logout", onLogout);
    return () => window.removeEventListener("memory-erp-logout", onLogout);
  }, []);

  const signIn = async (username: string, password: string) => {
    const result = await login(username, password);
    localStorage.setItem("memory-erp-token", result.token);
    setUser(result.user);
    setPage("dashboard");
    localStorage.setItem("memory-erp-page", "dashboard");
  };

  const signOut = () => {
    localStorage.removeItem("memory-erp-token");
    setUser(null);
  };

  const navigate = (nextPage: Page) => {
    setPage(nextPage);
    localStorage.setItem("memory-erp-page", nextPage);
  };

  const visibleItems = user
    ? navItems.filter((item) =>
        hasPermission(user, item.permission) &&
        (!item.processCode || user.roles.some((role) => role.code === "SYSTEM_ADMIN") || user.authorizedProcessCodes.includes(item.processCode))
      )
    : [];
  const pageIsVisible = visibleItems.some((item) => item.key === page);
  const firstVisiblePage = visibleItems[0]?.key;
  useEffect(() => {
    if (user && !pageIsVisible && firstVisiblePage) {
      setPage(firstVisiblePage);
      localStorage.setItem("memory-erp-page", firstVisiblePage);
    }
  }, [firstVisiblePage, pageIsVisible, user]);

  if (loading) {
    return <div className="app-loading"><Activity size={20} />正在载入系统...</div>;
  }
  if (!user) {
    return <LoginPage onLogin={signIn} />;
  }

  return (
    <AppShell user={user} page={page} items={visibleItems} onNavigate={navigate} onSignOut={signOut}>
      {page === "dashboard" && <DashboardPage />}
      {page === "users" && <UsersPage currentUser={user} />}
      {page === "roles" && <RolesPage currentUser={user} />}
      {page === "departments" && <ProductionProcessesPage currentUser={user} />}
      {page === "audit" && <AuditPage />}
      {page === "product-items" && <ProductItemsPage currentUser={user} />}
      {page === "product-categories" && <ProductCategoriesPage currentUser={user} />}
      {page === "product-units" && <ProductUnitsPage currentUser={user} />}
      {page === "product-attributes" && <ProductAttributesPage currentUser={user} />}
      {page === "production-overview" && <ProductionOverviewPage />}
      {page === "production-disassembly" && <ProductionStationPage currentUser={user} station="disassembly" />}
      {page === "production-assembly" && <ProductionStationPage currentUser={user} station="assembly" />}
      {page === "production-bga" && <ProductionStationPage currentUser={user} station="bga" />}
      {page === "production-chip-initial-test" && <ProductionStationPage currentUser={user} station="chip-initial-test" />}
      {page === "production-outsource" && <ProductionStationPage currentUser={user} station="outsource" />}
      {page === "production-chip-retest" && <ProductionStationPage currentUser={user} station="chip-retest" />}
      {page === "production-smt" && <ProductionStationPage currentUser={user} station="smt" />}
      {page === "production-aging" && <ProductionStationPage currentUser={user} station="aging" />}
      {page === "production-fqc" && <ProductionStationPage currentUser={user} station="fqc" />}
      {page === "production-processes" && <ProductionProcessesPage currentUser={user} />}
      {page === "production-routes" && <ProductionRoutesPage currentUser={user} />}
      {page === "production-workorders" && <ProductionWorkOrdersPage currentUser={user} />}
      {page === "production-tasks" && <ProductionTasksPage currentUser={user} />}
      {page === "production-reports" && <ProductionReportsPage />}
      {page === "production-repairs" && <ProductionRepairsPage currentUser={user} />}
      {page === "production-scrap-products" && <ProductionScrapProductsPage />}
      {page === "inventory-overview" && <InventoryOverviewPage />}
      {page === "inventory-warehouses" && <InventoryWarehousesPage currentUser={user} />}
      {page === "inventory-balances" && <InventoryBalancesPage />}
      {page === "inventory-receipts" && <InventoryReceiptPage currentUser={user} />}
      {page === "inventory-issues" && <InventoryIssuePage currentUser={user} />}
      {page === "inventory-transfers" && <InventoryTransferPage currentUser={user} />}
      {page === "inventory-counts" && <InventoryCountPage currentUser={user} />}
      {page === "inventory-scrap" && <InventoryScrapPage currentUser={user} />}
      {page === "inventory-documents" && <InventoryDocumentsPage currentUser={user} />}
      {page === "inventory-ledger" && <InventoryLedgerPage />}
      {page === "quality" && <ProductionQualityPage currentUser={user} />}
      {user.mustChangePassword === 1 && <PasswordChangeModal onChanged={(result) => {
        localStorage.setItem("memory-erp-token", result.token);
        setUser(result.user);
      }} />}
    </AppShell>
  );
}

function LoginPage({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await onLogin(username, password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-visual">
        <div className="visual-topline"><span className="brand-mark">M</span><span>Memory Modules</span></div>
        <div className="visual-copy">
          <span className="eyebrow">ERP + MES FOUNDATION</span>
          <h1>把每一次生产动作，<br />变成可追溯的现场记录。</h1>
          <p>从员工账号、岗位权限开始，逐步连接生产、仓储与质量流程。</p>
        </div>
        <div className="visual-foot">
          <span>人工生产底座</span><span className="dot" /><span>权限先行</span><span className="dot" /><span>逐步扩展</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <div className="mobile-brand"><span className="brand-mark">M</span>Memory Modules</div>
          <span className="eyebrow">系统登录</span>
          <h2>欢迎回来</h2>
          <p className="login-hint">登录后台管理台，管理员工、角色和系统权限。</p>
          <form onSubmit={submit} className="login-form">
            <label>账号<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
            <label>密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" /></label>
            {error && <div className="form-error">{error}</div>}
            <button className="primary-button login-button" disabled={submitting}>
              {submitting ? "正在登录..." : "登录系统"} <ArrowRight size={17} />
            </button>
          </form>
          <div className="login-note"><LockKeyhole size={15} />管理员初始账号由部署环境初始化</div>
        </div>
      </section>
    </main>
  );
}

function PasswordChangeModal({ onChanged }: { onChanged: (result: { token: string; user: User }) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setSaving(true);
    try {
      const result = await request<{ token: string; user: User }>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      onChanged(result);
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "密码修改失败");
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="password-change-title"><div className="modal-header"><div><span className="eyebrow">账号安全</span><h2 id="password-change-title">修改初始密码</h2></div></div><form className="modal-form" onSubmit={submit}><div className="form-note">为保护账号安全，请先设置新的登录密码后再继续使用系统。</div><div className="form-grid"><label className="full-span">当前密码<input type="password" autoFocus value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>新密码<input type="password" minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label>确认新密码<input type="password" minLength={10} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label></div>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button className="primary-button" disabled={saving}>{saving ? "提交中..." : "确认修改"} <Check size={16} /></button></div></form></section></div>;
}

function AppShell({
  user,
  page,
  items,
  onNavigate,
  onSignOut,
  children
}: {
  user: User;
  page: Page;
  items: NavItem[];
  onNavigate: (page: Page) => void;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const groups = [...new Set(items.map((item) => item.group))];
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<NavSection, boolean>>(() => ({
    system: ["users", "roles", "departments", "audit"].includes(page),
    products: page.startsWith("product-"),
    production: ["production-overview", "production-workorders", "production-disassembly", "production-assembly", "production-bga", "production-chip-initial-test", "production-outsource", "production-chip-retest", "production-smt", "production-aging", "production-fqc", "production-repairs", "production-scrap-products"].includes(page),
    "production-settings": ["production-tasks", "production-reports", "production-processes", "production-routes"].includes(page),
    inventory: page.startsWith("inventory-")
  }));

  useEffect(() => {
    const activeSection = navSections.find((section) => section.isActive(page));
    if (activeSection) {
      setExpandedSections((current) => ({ ...current, [activeSection.key]: true }));
    }
  }, [page]);

  const renderNavItem = (item: NavItem, extraClass = "") => {
    const Icon = item.icon;
    return (
      <button
        className={`nav-item ${extraClass} ${page === item.key ? "active" : ""}`}
        key={item.key}
        onClick={() => { onNavigate(item.key); setMobileOpen(false); }}
      >
        <Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>
      </button>
    );
  };

  const renderNavSection = (section: (typeof navSections)[number], group: string) => {
    const sectionItems = items.filter((item) => item.group === group && item.section === section.key);
    if (!sectionItems.length) return null;
    const Icon = section.icon;
    const expanded = expandedSections[section.key];
    const active = section.isActive(page);
    return (
      <div className="nav-submenu" key={section.key}>
        <button
          className={`nav-parent ${active ? "active" : ""}`}
          onClick={() => setExpandedSections((current) => ({ ...current, [section.key]: !current[section.key] }))}
          aria-expanded={expanded}
        >
          <Icon size={17} strokeWidth={1.8} /><span>{section.label}</span><ChevronDown className={expanded ? "expanded" : ""} size={15} />
        </button>
        {expanded && (
          <div className="nav-submenu-items">
            {sectionItems.map((item) => renderNavItem(item, "nav-subitem"))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="sidebar-brand"><span className="brand-mark">M</span><span>Memory Modules</span></div>
        <div className="sidebar-context"><span className="eyebrow">ERP + MES</span><strong>管理控制台</strong></div>
        <nav className="main-nav">
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-group-label">{group}</span>
              {items.filter((item) => item.group === group && !item.section).map((item) => renderNavItem(item))}
              {navSections.filter((section) => section.group === group).map((section) => renderNavSection(section, group))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="system-status"><span className="status-dot" />系统运行正常</div>
          <div className="sidebar-version">Foundation v0.1</div>
        </div>
      </aside>
      {mobileOpen && <button className="mobile-backdrop" onClick={() => setMobileOpen(false)} aria-label="关闭菜单" />}
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-button" onClick={() => setMobileOpen(true)} aria-label="打开菜单"><Menu size={20} /></button>
            <div><span className="breadcrumb-muted">管理台</span><span className="breadcrumb-separator">/</span><strong>{pageLabels[page]}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className="user-menu"><span className="avatar">{user.displayName.slice(0, 1)}</span><span className="user-menu-text"><strong>{user.displayName}</strong><small>{user.position || "员工"}</small></span><ChevronDown size={15} /></div>
            <button className="icon-button" onClick={onSignOut} title="退出登录" aria-label="退出登录"><LogOut size={18} /></button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {action}
    </div>
  );
}

function DashboardPage() {
  const [data, setData] = useState<{ cards: Array<{ key: string; label: string; value: number; tone: string }>; todo: Array<{ title: string; status: string; detail: string }> } | null>(null);
  const [error, setError] = useState("");
  const load = () => request<typeof data>("/dashboard").then(setData).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "加载失败"));
  useEffect(() => { void load(); }, []);

  return (
    <div>
      <PageHeader eyebrow="系统总览" title="管理工作台" description="从基础工序和权限开始，逐步搭建内存条 ERP + MES 的业务底座。" action={<button className="secondary-button" onClick={load}><RefreshCw size={16} />刷新数据</button>} />
      {error && <div className="form-error page-error">{error}</div>}
      <div className="metric-grid">
        {(data?.cards ?? []).map((card) => (
          <div className="metric-card" key={card.key}><div className={`metric-icon ${card.tone}`}><Activity size={19} /></div><div><span>{card.label}</span><strong>{card.value}</strong></div></div>
        ))}
        {!data && [1, 2, 3, 4].map((item) => <div className="metric-card skeleton" key={item} />)}
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading"><div><span className="eyebrow">当前阶段</span><h2>系统基础建设</h2></div><span className="phase-badge">Phase 01</span></div>
          <div className="progress-wrap"><div className="progress-label"><span>底座完成度</span><strong>35%</strong></div><div className="progress-track"><span style={{ width: "35%" }} /></div></div>
          <div className="roadmap-list">
            {(data?.todo ?? []).map((item, index) => <div className="roadmap-item" key={item.title}><span className={`roadmap-index ${index === 0 ? "current" : ""}`}>{index + 1}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div><span className="roadmap-status">{item.status}</span></div>)}
          </div>
        </section>
        <section className="panel quick-panel">
          <div className="panel-heading"><div><span className="eyebrow">系统底座</span><h2>下一步工作</h2></div><SlidersHorizontal size={19} className="muted-icon" /></div>
          <div className="quick-item"><div className="quick-icon blue"><UserCog size={18} /></div><div><strong>完善员工账号</strong><p>补充工号、岗位、工序流程和角色</p></div><ArrowRight size={17} /></div>
          <div className="quick-item"><div className="quick-icon green"><ShieldCheck size={18} /></div><div><strong>配置工序权限</strong><p>按工序模板分配可操作功能</p></div><ArrowRight size={17} /></div>
          <div className="quick-item"><div className="quick-icon amber"><Factory size={18} /></div><div><strong>准备生产模块</strong><p>下一阶段接入工单和工序任务</p></div><ArrowRight size={17} /></div>
        </section>
      </div>
    </div>
  );
}

function UsersPage({ currentUser }: { currentUser: User }) {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [processes, setProcesses] = useState<ProcessOption[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UserListItem | null>(null);
  const load = async () => {
    const [userResult, processResult, roleResult] = await Promise.all([
      request<{ items: UserListItem[] }>("/users"),
      request<{ items: ProcessOption[] }>("/system/process-options"),
      request<{ items: Role[] }>("/roles")
    ]);
    setUsers(userResult.items);
    setProcesses(processResult.items);
    setRoles(roleResult.items);
  };
  useEffect(() => { load().catch(() => undefined); }, []);

  const canManageUsers = currentUser.roles.some((role) => role.code === "SYSTEM_ADMIN");
  const filtered = users.filter((item) => `${item.displayName}${item.username}${item.employeeNo}${item.position}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div>
      <PageHeader eyebrow="系统管理 / 账号" title="员工账号" description="每位员工使用独立账号，工序角色和数据范围决定可操作的系统功能。" action={canManageUsers ? <button className="primary-button" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={17} />新建员工</button> : undefined} />
      <section className="panel">
        <div className="toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、账号、工号或岗位" /></div><button className="icon-button" onClick={() => load()} title="刷新列表" aria-label="刷新列表"><RefreshCw size={17} /></button></div>
        <div className="table-wrap"><table><thead><tr><th>员工</th><th>工号</th><th>工序流程 / 岗位</th><th>角色</th><th>状态</th><th>最近登录</th><th className="action-cell">操作</th></tr></thead><tbody>
          {filtered.map((item) => <tr key={item.id}><td><div className="person-cell"><span className="avatar small">{item.displayName.slice(0, 1)}</span><div><strong>{item.displayName}</strong><small>@{item.username}</small></div></div></td><td className="muted-cell">{item.employeeNo}</td><td><strong>{item.processName || "未分配工序"}</strong><small>{item.position || "未设置岗位"}</small></td><td><div className="tag-list">{(item.roleNames || "未分配角色").split("、").map((role) => <span className="tag" key={role}>{role}</span>)}</div></td><td><span className={`status-badge ${item.status}`}>{item.status === "active" ? "启用" : "停用"}</span></td><td className="muted-cell">{item.lastLoginAt ? formatDate(item.lastLoginAt) : "尚未登录"}</td><td className="action-cell">{canManageUsers ? <button className="table-action" onClick={() => { setEditing(item); setShowForm(true); }}>编辑</button> : <span className="muted-cell">仅查看</span>}</td></tr>)}
          {!filtered.length && <tr><td colSpan={7}><EmptyState title="没有找到员工" description="调整搜索条件，或创建一个新的员工账号。" /></td></tr>}
        </tbody></table></div>
      </section>
      {showForm && <UserForm user={editing} processes={processes} roles={roles} currentUser={currentUser} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function UserForm({ user, processes, roles, currentUser, onClose, onSaved }: { user: UserListItem | null; processes: ProcessOption[]; roles: Role[]; currentUser: User; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ username: user?.username ?? "", password: "", displayName: user?.displayName ?? "", employeeNo: user?.employeeNo ?? "", position: user?.position ?? "", processId: user?.processId?.toString() ?? "", roleIds: user?.roleIds.split(",").filter(Boolean) ?? [], managedProcessIds: user?.managedProcessIds.split(",").filter(Boolean) ?? [], status: user?.status ?? "active" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const toggleRole = (id: string) => setForm((current) => ({ ...current, roleIds: current.roleIds.includes(id) ? current.roleIds.filter((roleId) => roleId !== id) : [...current.roleIds, id] }));
  const toggleManagedProcess = (id: string) => setForm((current) => ({ ...current, managedProcessIds: current.managedProcessIds.includes(id) ? current.managedProcessIds.filter((processId) => processId !== id) : [...current.managedProcessIds, id] }));
  const changeProcess = (processId: string) => {
    const hiddenRoleIds = form.roleIds.filter((roleId) => !roles.some((role) => role.id.toString() === roleId));
    setForm({ ...form, processId, roleIds: hiddenRoleIds, managedProcessIds: form.managedProcessIds.filter((id) => id !== form.processId) });
  };
  const isSystemAdmin = currentUser.roles.some((role) => role.code === "SYSTEM_ADMIN");
  const processRoles = form.processId ? roles.filter((role) => role.processId?.toString() === form.processId) : [];
  const activeProcesses = processes.filter((process) => process.status === "active");
  const selectedHasManagerRole = form.roleIds.some((roleId) => roles.find((role) => role.id.toString() === roleId)?.roleKind === "manager");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const payload = { displayName: form.displayName, employeeNo: form.employeeNo, position: form.position, processId: form.processId ? Number(form.processId) : null, roleIds: form.roleIds.map(Number), managedProcessIds: selectedHasManagerRole ? form.managedProcessIds.map(Number) : [], status: form.status, password: form.password || undefined };
      if (user) {
        await request(`/users/${user.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await request("/users", { method: "POST", body: JSON.stringify({ ...payload, username: form.username, password: form.password }) });
      }
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };
  return <Modal title={user ? "编辑员工账号" : "新建员工账号"} onClose={onClose}><form className="modal-form" onSubmit={submit}>
    <div className="form-grid"><label>登录账号<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} disabled={Boolean(user)} /></label><label>员工姓名<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label><label>工号<input value={form.employeeNo} onChange={(event) => setForm({ ...form, employeeNo: event.target.value })} /></label><label>岗位<input value={form.position} onChange={(event) => setForm({ ...form, position: event.target.value })} placeholder="例如：芯片初测员工" /></label><label>所属工序<select value={form.processId} onChange={(event) => changeProcess(event.target.value)}><option value="">请选择所属工序</option>{activeProcesses.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>账号状态<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "active" | "inactive" })}><option value="active">启用</option><option value="inactive">停用</option></select></label><label className="full-span">{user ? "重置密码（留空则不修改）" : "初始密码"}<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label></div>
    <div className="role-picker"><div className="field-label">工序职位</div><div className="role-options">{processRoles.map((role) => <button type="button" className={`role-option ${form.roleIds.includes(role.id.toString()) ? "selected" : ""}`} key={role.id} onClick={() => toggleRole(role.id.toString())}><span>{form.roleIds.includes(role.id.toString()) ? <Check size={14} /> : <span className="empty-check" />}</span>{role.roleKind === "manager" ? "主管" : "员工"} · {role.name}</button>)}</div>{!form.processId && <div className="form-note">先选择所属工序后，再分配主管或员工职位。</div>}</div>
    {isSystemAdmin && selectedHasManagerRole && <div className="role-picker"><div className="field-label">主管工序范围</div><div className="role-options">{activeProcesses.map((process) => <button type="button" className={`role-option ${form.managedProcessIds.includes(process.id.toString()) ? "selected" : ""}`} key={process.id} onClick={() => toggleManagedProcess(process.id.toString())}><span>{form.managedProcessIds.includes(process.id.toString()) ? <Check size={14} /> : <span className="empty-check" />}</span>{process.name}</button>)}</div></div>}
    {currentUser.id === user?.id && <div className="form-note">当前正在编辑自己的账号，停用后将立即退出系统。</div>}
    {error && <div className="form-error">{error}</div>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving}>{saving ? "保存中..." : "保存账号"} <Check size={16} /></button></div>
  </form></Modal>;
}

type ProcessPermissionOption = {
  code: string;
  label: string;
  detail: string;
  managerOnly?: boolean;
};

const getProcessRolePermissionOptions = (role: Role | null, permissions: Permission[]) => {
  if (!role?.processCode) return [];
  const permissionCodes = new Set(permissions.map((permission) => permission.code));
  const processName = role.processName ?? "当前工序";
  const options: ProcessPermissionOption[] = [
    { code: "production.tasks.view", label: `查看${processName}任务`, detail: "进入该工序页面，只查看对应工序任务和工单流转数据。" },
    { code: "production.operations.execute", label: "开工与报工", detail: "执行本工序开工、报工、测试、拆解或组装等操作。" },
    { code: "production.reports.view", label: "报工记录与任务输出", detail: "查看本工序报工记录，并支持任务预览、打印和下载。" },
    { code: "production.tasks.manage", label: "派工与任务调整", detail: "给本工序员工分配任务，调整任务执行人。", managerOnly: true },
    { code: "production.workorders.manage", label: "新建本工序工单", detail: "从当前工序页面发起并下达生产工单。", managerOnly: true }
  ];
  const isQualityProcess = role.processType === "testing" || role.processType === "inspection" || ["PROC-CHIP-TEST", "PROC-CHIP-RETEST", "PROC-AGING", "PROC-FQC"].includes(role.processCode);
  if (isQualityProcess) {
    options.push(
      { code: "quality.inspection.view", label: "查看本工序质检", detail: "查看本工序产生的检验、隔离和放行记录。" },
      { code: "quality.inspection.manage", label: "质检判定", detail: "对本工序待检任务执行判定、隔离和放行。" }
    );
  }
  if (role.processType === "repair" || role.processCode === "PROC-REPAIR") {
    options.push(
      { code: "production.repairs.view", label: "查看不良维修", detail: "查看流入不良维修工序的维修批次和处理进度。" },
      { code: "production.repairs.manage", label: "维修结算", detail: "登记维修完成、继续维修、合格、不良和报废数量。" },
      { code: "production.scrap-products.view", label: "查看报废产品", detail: "查看维修结算形成的报废产品批次。", managerOnly: true }
    );
  }
  return options
    .filter((option) => permissionCodes.has(option.code))
    .filter((option) => role.roleKind === "manager" || !option.managerOnly);
};

function RolesPage({ currentUser }: { currentUser: User }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [enabled, setEnabled] = useState<number[]>([]);
  const [roleDetail, setRoleDetail] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    const [roleResult, permissionResult] = await Promise.all([request<{ items: Role[] }>("/roles"), request<{ items: Permission[] }>("/permissions")]);
    setRoles(roleResult.items);
    setPermissions(permissionResult.items);
    if (!selectedId && roleResult.items[0]) setSelectedId(roleResult.items[0].id);
  };
  useEffect(() => { load().catch(() => undefined); }, []);
  useEffect(() => {
    if (!selectedId) return;
    request<{ role: Role; permissions: Array<Permission & { enabled: number }> }>(`/roles/${selectedId}`).then((result) => { setRoleDetail(result.role); setEnabled(result.permissions.filter((item) => item.enabled).map((item) => item.id)); }).catch(() => undefined);
  }, [selectedId]);
  const canManageRoles = currentUser.roles.some((role) => role.code === "SYSTEM_ADMIN");
  const permissionByCode = useMemo(() => new Map(permissions.map((permission) => [permission.code, permission])), [permissions]);
  const processPermissionOptions = useMemo(() => getProcessRolePermissionOptions(roleDetail, permissions), [roleDetail, permissions]);
  const getDependencyCodes = (code: string, resolved = new Set<string>()): string[] => {
    if (resolved.has(code)) return [];
    resolved.add(code);
    const directDependencies = permissionByCode.get(code)?.dependencies ?? [];
    return directDependencies.flatMap((dependency) => [dependency, ...getDependencyCodes(dependency, resolved)]);
  };
  const togglePermission = (id: number) => {
    const permission = permissions.find((item) => item.id === id);
    if (!permission) return;
    setError("");
    if (["system.users.manage", "system.roles.manage"].includes(permission.code) && roleDetail?.code !== "SYSTEM_ADMIN") {
      setError("员工账号与角色授权仅限系统总管理员角色。");
      return;
    }
    if (enabled.includes(id)) {
      const dependent = permissions.find((item) => enabled.includes(item.id) && getDependencyCodes(item.code).includes(permission.code));
      if (dependent) {
        setError(`“${dependent.label}”依赖当前权限，请先取消该业务操作权限。`);
        return;
      }
      setEnabled((current) => current.filter((permissionId) => permissionId !== id));
      return;
    }
    const dependencyIds = getDependencyCodes(permission.code).map((code) => permissionByCode.get(code)?.id).filter((dependencyId): dependencyId is number => dependencyId !== undefined);
    setEnabled((current) => [...new Set([...current, id, ...dependencyIds])]);
  };
  const optionChecked = (code: string) => {
    const permission = permissionByCode.get(code);
    return Boolean(permission && enabled.includes(permission.id));
  };
  const toggleProcessPermission = (code: string) => {
    const permission = permissionByCode.get(code);
    if (permission) togglePermission(permission.id);
  };
  const collectSelectedProcessPermissionIds = () => {
    const permissionIds = new Set<number>();
    for (const option of processPermissionOptions) {
      if (!optionChecked(option.code)) continue;
      for (const code of [option.code, ...getDependencyCodes(option.code)]) {
        const permission = permissionByCode.get(code);
        if (permission) permissionIds.add(permission.id);
      }
    }
    return [...permissionIds];
  };
  const save = async () => {
    if (!selectedId) return;
    setError("");
    setSaving(true);
    try {
      await request(`/roles/${selectedId}`, { method: "PUT", body: JSON.stringify({ permissionIds: collectSelectedProcessPermissionIds() }) });
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "权限保存失败");
    } finally {
      setSaving(false);
    }
  };
  return <div><PageHeader eyebrow="系统管理 / 权限" title="工序角色权限" description="工序角色由工序流程自动生成，每道工序默认拥有主管和员工两类角色。" action={<div className="header-actions"><button className="secondary-button" onClick={() => load()}><RefreshCw size={16} />刷新角色</button></div>} />
    <div className="roles-layout"><section className="panel roles-list"><div className="panel-heading"><div><span className="eyebrow">按工序生成</span><h2>工序角色</h2></div><span className="count-label">{roles.length} 个</span></div>{roles.map((role) => <button className={`role-list-item ${selectedId === role.id ? "selected" : ""}`} key={role.id} onClick={() => setSelectedId(role.id)}><span className="role-symbol"><ShieldCheck size={17} /></span><span><strong>{role.name}</strong><small>{role.processName ? `${role.processName} · ${role.roleKind === "manager" ? "主管" : "员工"}` : role.code} · {role.userCount} 名员工</small></span><ArrowRight size={16} /></button>)}</section>
       <section className="panel permission-panel"><div className="panel-heading"><div><span className="eyebrow">权限配置</span><h2>{roleDetail?.name ?? "选择角色"}</h2><p>{roleDetail?.description}</p></div>{selectedId && canManageRoles && <button className="primary-button" onClick={save} disabled={saving}>{saving ? "保存中..." : "保存权限"} <Check size={16} /></button>}</div>{error && <div className="form-error">{error}</div>}{roleDetail ? <div className="permission-group"><div className="permission-group-title"><span>{roleDetail.processName ?? "工序"}页面权限</span><small>{roleDetail.roleKind === "manager" ? "主管可配置全部操作" : "员工仅配置执行操作"}</small></div>{processPermissionOptions.map((option) => <label className="permission-row" key={option.code}><input type="checkbox" disabled={!canManageRoles} checked={optionChecked(option.code)} onChange={() => toggleProcessPermission(option.code)} /><span className="fake-checkbox">{optionChecked(option.code) && <Check size={13} />}</span><span><strong>{option.label}</strong><small>{option.detail}</small></span></label>)}{!processPermissionOptions.length && <EmptyState title="暂无可配置权限" description="请选择左侧由工序流程自动生成的主管或员工角色。" />}</div> : <EmptyState title="请选择工序角色" description="左侧选择某一道工序的主管或员工角色后，再配置该工序页面权限。" />}</section>
    </div>
  </div>;
}

function DepartmentsPage({ currentUser }: { currentUser: User }) {
  return <ProductionProcessesPage currentUser={currentUser} />;
}

function AuditPage() {
  const [items, setItems] = useState<Array<{ id: number; action: string; resource: string; detail: string; ipAddress: string; createdAt: string; displayName: string; username: string }>>([]);
  useEffect(() => { request<{ items: typeof items }>("/audit-logs").then((result) => setItems(result.items)).catch(() => undefined); }, []);
  return <div><PageHeader eyebrow="系统管理 / 审计" title="操作审计" description="记录登录、账号、角色、权限和关键基础数据变更，作为后续业务模块的审计底座。" /><section className="panel"><div className="toolbar"><div className="toolbar-note"><FileClock size={17} />最近 200 条操作记录</div><button className="icon-button" onClick={() => request<{ items: typeof items }>("/audit-logs").then((result) => setItems(result.items))} title="刷新日志" aria-label="刷新日志"><RefreshCw size={17} /></button></div><div className="table-wrap"><table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>资源</th><th>详情</th><th>来源</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td className="muted-cell">{formatDate(item.createdAt)}</td><td><strong>{item.displayName || item.username || "系统"}</strong></td><td><span className="audit-action">{item.action}</span></td><td>{item.resource}</td><td>{item.detail}</td><td className="muted-cell">{item.ipAddress || "-"}</td></tr>)}{!items.length && <tr><td colSpan={6}><EmptyState title="暂无审计记录" description="登录和基础数据变更会出现在这里。" /></td></tr>}</tbody></table></div></section></div>;
}

function ReservedPage({ page }: { page: Page }) {
  const meta = { production: { icon: Factory, eyebrow: "业务模块 / 预留", title: "生产管理", description: "工单、派工、工序任务和人工报工将在下一阶段接入。", accent: "blue" }, quality: { icon: ClipboardList, eyebrow: "业务模块 / 预留", title: "质量管理", description: "芯片测试、成品老化、不良维修和目检放行将在后续阶段接入。", accent: "amber" } }[page as "production" | "quality"];
  const Icon = meta.icon;
  return <div><PageHeader eyebrow={meta.eyebrow} title={meta.title} description={meta.description} /><section className={`reserved-panel ${meta.accent}`}><div className="reserved-icon"><Icon size={32} /></div><span className="eyebrow">下一阶段</span><h2>权限底座已就绪</h2><p>这个模块的页面入口、导航权限和业务权限代码已经预留。后续接入模块时，不需要重新设计登录和权限体系。</p><div className="reserved-line"><span /><span /><span /><span /></div></section></div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="eyebrow">基础资料</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div>{children}</section></div>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><div className="empty-icon"><Search size={18} /></div><strong>{title}</strong><span>{description}</span></div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default App;
