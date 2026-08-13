import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Download,
  Eye,
  FilePlus2,
  Package,
  PackageMinus,
  PackagePlus,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  X
} from "lucide-react";
import { Department, User, request } from "./api";

export type InventoryPageKey =
  | "overview"
  | "categories"
  | "units"
  | "attributes"
  | "items"
  | "warehouses"
  | "balances"
  | "ledger"
  | "documents";

type Category = {
  id: number;
  parentId: number | null;
  parentName: string | null;
  code: string;
  name: string;
  description: string;
  status: "active" | "inactive";
  itemCount: number;
};

type CategoryTreeNode = Category & {
  children: CategoryTreeNode[];
};

type CategoryTreeRow = CategoryTreeNode & {
  level: number;
};

type Unit = {
  id: number;
  code: string;
  name: string;
  precision: number;
  status: "active" | "inactive";
};

type AttributeDefinition = {
  id: number;
  code: string;
  name: string;
  valueType: "text" | "number" | "select";
  optionsText: string;
  status: "active" | "inactive";
  value?: string;
};

type Item = {
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
  attributeCount?: number;
  stockQuantity?: number;
};

type ItemWarehouseBalance = {
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  warehouseType: WarehouseType;
  departmentName: string;
  quantity: number;
};

type ItemFilters = {
  categoryId: string;
  warehouseId: string;
  stockStatus: "all" | "in_stock" | "out_of_stock";
  trackingMode: "all" | Item["trackingMode"];
  status: "all" | Item["status"];
};

type WarehouseType = "raw_material" | "semi_finished" | "finished_goods" | "quarantine" | "scrap" | "general";

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

type StockBalance = {
  itemId: number;
  itemCode: string;
  itemName: string;
  unitName: string | null;
  warehouseId: number;
  warehouseName: string;
  warehouseType: WarehouseType;
  lotNo: string;
  serialNo: string;
  quantity: number;
};

type LedgerEntry = {
  id: number;
  createdAt: string;
  documentNo: string;
  documentType: DocumentType;
  itemCode: string;
  itemName: string;
  warehouseName: string;
  warehouseType: WarehouseType;
  quantityDelta: number;
  lotNo: string;
  serialNo: string;
};

type DocumentType = "receipt" | "issue" | "transfer" | "count" | "scrap";
type DocumentStatus = "draft" | "submitted" | "approved" | "posted" | "cancelled";
type DocumentOutputAction = "preview" | "print" | "download";

type StockDocument = {
  id: number;
  documentNo: string;
  documentType: DocumentType;
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

type StockDocumentDetail = StockDocument & {
  submittedAt?: string | null;
  approvedAt?: string | null;
  postedAt?: string | null;
  lines: Array<{
    id: number;
    lineNo: number;
    itemId: number;
    itemCode: string;
    itemName: string;
    unitName: string | null;
    trackingMode: Item["trackingMode"];
    quantity: number;
    lotNo: string;
    serialNo: string;
    remark: string;
  }>;
};

type DocumentLineForm = {
  itemId: string;
  quantity: string;
  lotNo: string;
  serialNo: string;
  remark: string;
};

const warehouseTypeLabels: Record<WarehouseType, string> = {
  raw_material: "原料仓",
  semi_finished: "半成品仓",
  finished_goods: "成品仓",
  quarantine: "待检/隔离仓",
  scrap: "不良/报废仓",
  general: "综合仓"
};

const documentMeta: Record<DocumentType, { label: string; icon: typeof PackagePlus; createPermission: string; approvePermission: string; postPermission: string }> = {
  receipt: { label: "入库单", icon: PackagePlus, createPermission: "inventory.receipts.create", approvePermission: "inventory.receipts.approve", postPermission: "inventory.receipts.post" },
  issue: { label: "出库单", icon: PackageMinus, createPermission: "inventory.issues.create", approvePermission: "inventory.issues.approve", postPermission: "inventory.issues.post" },
  transfer: { label: "调拨单", icon: ArrowLeftRight, createPermission: "inventory.transfers.create", approvePermission: "inventory.transfers.approve", postPermission: "inventory.transfers.post" },
  count: { label: "盘点单", icon: ClipboardCheck, createPermission: "inventory.counts.create", approvePermission: "inventory.counts.approve", postPermission: "inventory.counts.post" },
  scrap: { label: "报废单", icon: Trash2, createPermission: "inventory.scrap.create", approvePermission: "inventory.scrap.approve", postPermission: "inventory.scrap.post" }
};

const hasPermission = (user: User, code: string) => user.permissions.some((permission) => permission.code === code);
const today = () => new Date().toISOString().slice(0, 10);

function InventoryPageLayout({
  module,
  title,
  description,
  children
}: {
  module: "商品管理" | "库存管理";
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="inventory-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">{module}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

export function InventoryOverviewPage() {
  return (
    <InventoryPageLayout module="库存管理" title="库存工作台" description="查看授权仓库、库存数量和当天库存单据的汇总信息。">
      <InventoryOverview />
    </InventoryPageLayout>
  );
}

export function ProductItemsPage({ currentUser }: { currentUser: User }) {
  return (
    <InventoryPageLayout module="商品管理" title="商品资料" description="维护商品编码、分类、库存单位、追溯方式和动态参数。">
      <ItemsPanel currentUser={currentUser} />
    </InventoryPageLayout>
  );
}

export function ProductCategoriesPage({ currentUser }: { currentUser: User }) {
  return (
    <InventoryPageLayout module="商品管理" title="商品分类" description="按物料和成品结构维护分类，为商品资料建立统一基础。">
      <CategoriesPanel currentUser={currentUser} />
    </InventoryPageLayout>
  );
}

export function ProductUnitsPage({ currentUser }: { currentUser: User }) {
  return (
    <InventoryPageLayout module="商品管理" title="计量单位" description="维护库存记账单位及数量精度，保证收发和盘点数量一致。">
      <UnitsPanel currentUser={currentUser} />
    </InventoryPageLayout>
  );
}

export function ProductAttributesPage({ currentUser }: { currentUser: User }) {
  return (
    <InventoryPageLayout module="商品管理" title="商品属性" description="维护内置和自定义商品属性，用于描述内存条规格和物料属性。">
      <AttributesPanel currentUser={currentUser} />
    </InventoryPageLayout>
  );
}

export function InventoryWarehousesPage({ currentUser }: { currentUser: User }) {
  return (
    <InventoryPageLayout module="库存管理" title="仓库管理" description="维护仓库归属、负责人和部门数据范围。">
      <WarehousesPanel currentUser={currentUser} />
    </InventoryPageLayout>
  );
}

export function InventoryDocumentsPage({ currentUser }: { currentUser: User }) {
  return (
    <InventoryPageLayout module="库存管理" title="出入库记录" description="集中查询入库、出库、调拨、盘点和报废等全部库存业务记录。">
      <DocumentsPanel currentUser={currentUser} />
    </InventoryPageLayout>
  );
}

export function InventoryReceiptPage({ currentUser }: { currentUser: User }) {
  return (
    <InventoryPageLayout module="库存管理" title="商品入库" description="创建、提交、审批和过账正常入库单，形成可追溯的库存增加记录。">
      <DocumentsPanel currentUser={currentUser} fixedType="receipt" />
    </InventoryPageLayout>
  );
}

export function InventoryIssuePage({ currentUser }: { currentUser: User }) {
  return (
    <InventoryPageLayout module="库存管理" title="商品出库" description="创建、提交、审批和过账正常出库单，系统会校验可用库存。">
      <DocumentsPanel currentUser={currentUser} fixedType="issue" />
    </InventoryPageLayout>
  );
}

export function InventoryTransferPage({ currentUser }: { currentUser: User }) {
  return (
    <InventoryPageLayout module="库存管理" title="仓库调拨" description="在授权仓库之间调拨商品，过账后自动生成调出和调入流水。">
      <DocumentsPanel currentUser={currentUser} fixedType="transfer" />
    </InventoryPageLayout>
  );
}

export function InventoryCountPage({ currentUser }: { currentUser: User }) {
  return (
    <InventoryPageLayout module="库存管理" title="库存盘点" description="按实盘数量创建盘点单，审批过账后自动生成库存差异流水。">
      <DocumentsPanel currentUser={currentUser} fixedType="count" />
    </InventoryPageLayout>
  );
}

export function InventoryScrapPage({ currentUser }: { currentUser: User }) {
  return (
    <InventoryPageLayout module="库存管理" title="商品报废" description="按报废原因创建报废单，审批过账后扣减对应仓库库存。">
      <DocumentsPanel currentUser={currentUser} fixedType="scrap" />
    </InventoryPageLayout>
  );
}

export function InventoryBalancesPage() {
  return (
    <InventoryPageLayout module="库存管理" title="库存查询" description="查看已过账台账汇总后的实时库存余额。">
      <BalancesPanel />
    </InventoryPageLayout>
  );
}

export function InventoryLedgerPage() {
  return (
    <InventoryPageLayout module="库存管理" title="库存台账" description="查看每一笔已过账库存变动，支持完整追溯。">
      <LedgerPanel />
    </InventoryPageLayout>
  );
}

function InventoryOverview() {
  const [data, setData] = useState<{ cards: Array<{ key: string; label: string; value: number; tone: string }> } | null>(null);
  const [error, setError] = useState("");
  const load = () => request<typeof data>("/inventory/dashboard").then(setData).catch((err) => setError(errorMessage(err)));

  useEffect(() => { void load(); }, []);

  return (
    <div>
      {error && <div className="form-error page-error">{error}</div>}
      <div className="metric-grid">
        {(data?.cards ?? []).map((card) => (
          <div className="metric-card" key={card.key}>
            <div className={`metric-icon ${card.tone}`}><Package size={19} /></div>
            <div><span>{card.label}</span><strong>{formatQuantity(card.value)}</strong></div>
          </div>
        ))}
        {!data && [1, 2, 3, 4].map((item) => <div className="metric-card skeleton" key={item} />)}
      </div>
      <section className="panel inventory-guide">
        <div className="panel-heading">
          <div><span className="eyebrow">受控库存</span><h2>标准作业顺序</h2></div>
          <RefreshCw size={18} className="muted-icon" />
        </div>
        <div className="inventory-guide-list">
          <GuideStep index="01" title="建立商品资料" detail="分类、单位、条码、追溯方式和可扩展参数。" />
          <GuideStep index="02" title="建立仓库" detail="每个仓库归属一个部门，自动受部门数据范围控制。" />
          <GuideStep index="03" title="创建库存单据" detail="入库、出库、调拨、盘点和报废都必须先建单。" />
          <GuideStep index="04" title="审批并过账" detail="库存余额由台账自动汇总，禁止直接修改库存。" />
        </div>
      </section>
    </div>
  );
}

function GuideStep({ index, title, detail }: { index: string; title: string; detail: string }) {
  return <div className="guide-step"><span>{index}</span><div><strong>{title}</strong><p>{detail}</p></div></div>;
}

function CategoriesPanel({ currentUser }: { currentUser: User }) {
  const [items, setItems] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [expandedIds, setExpandedIds] = useState<number[]>([]);
  const canManage = hasPermission(currentUser, "inventory.categories.manage");
  const load = async () => {
    const result = await request<{ items: Category[] }>("/inventory/categories");
    setItems(result.items);
    setExpandedIds(result.items.map((item) => item.id));
  };
  useEffect(() => { void load(); }, []);
  const rows = useMemo(
    () => flattenCategoryTree(buildCategoryTree(items), new Set(expandedIds)),
    [items, expandedIds]
  );
  const toggleExpanded = (id: number) => {
    setExpandedIds((current) => current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]);
  };

  return (
    <MasterPanel
      title="商品分类"
      description="按实际物料和产品结构维护分类，商品编码和参数可按分类逐步规范。"
      count={`${items.length} 个`}
      canManage={canManage}
      onCreate={() => { setEditing(null); setShowForm(true); }}
      onRefresh={load}
    >
      <div className="table-wrap"><table><thead><tr><th>分类</th><th>上级分类</th><th>编码</th><th>商品数量</th><th>状态</th><th className="action-cell">操作</th></tr></thead><tbody>
        {rows.map((item) => <tr key={item.id}><td><div className="category-tree-row" style={{ paddingLeft: `${item.level * 24}px` }}>{item.children.length ? <button type="button" className={`category-tree-toggle ${expandedIds.includes(item.id) ? "expanded" : ""}`} onClick={() => toggleExpanded(item.id)} aria-label={expandedIds.includes(item.id) ? `收起${item.name}` : `展开${item.name}`} aria-expanded={expandedIds.includes(item.id)}>{expandedIds.includes(item.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button> : <span className="category-tree-toggle-spacer" />}<div><strong>{item.name}</strong><small>{item.description || "暂无描述"}</small></div></div></td><td>{item.parentName || "-"}</td><td className="code-cell">{item.code}</td><td>{item.itemCount}</td><td><StatusBadge status={item.status} /></td><td className="action-cell">{canManage && <button className="table-action" onClick={() => { setEditing(item); setShowForm(true); }}>编辑</button>}</td></tr>)}
        {!items.length && <EmptyTable colSpan={6} title="暂无商品分类" description="先建立商品分类，再创建商品资料。" />}
      </tbody></table></div>
      {showForm && <CategoryForm item={editing} categories={items} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); void load(); }} />}
    </MasterPanel>
  );
}

function UnitsPanel({ currentUser }: { currentUser: User }) {
  const [items, setItems] = useState<Unit[]>([]);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [showForm, setShowForm] = useState(false);
  const canManage = hasPermission(currentUser, "inventory.units.manage");
  const load = () => request<{ items: Unit[] }>("/inventory/units").then((result) => setItems(result.items));
  useEffect(() => { void load(); }, []);

  return (
    <MasterPanel title="计量单位" description="商品库存数量统一按库存单位记账；小数精度决定数量录入规则。" count={`${items.length} 个`} canManage={canManage} onCreate={() => { setEditing(null); setShowForm(true); }} onRefresh={load}>
      <div className="table-wrap"><table><thead><tr><th>单位名称</th><th>编码</th><th>数量精度</th><th>状态</th><th className="action-cell">操作</th></tr></thead><tbody>
        {items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td className="code-cell">{item.code}</td><td>{item.precision} 位小数</td><td><StatusBadge status={item.status} /></td><td className="action-cell">{canManage && <button className="table-action" onClick={() => { setEditing(item); setShowForm(true); }}>编辑</button>}</td></tr>)}
        {!items.length && <EmptyTable colSpan={5} title="暂无计量单位" description="创建商品前请先配置库存单位。" />}
      </tbody></table></div>
      {showForm && <UnitForm item={editing} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); void load(); }} />}
    </MasterPanel>
  );
}

function AttributesPanel({ currentUser }: { currentUser: User }) {
  const [items, setItems] = useState<AttributeDefinition[]>([]);
  const [editing, setEditing] = useState<AttributeDefinition | null>(null);
  const [showForm, setShowForm] = useState(false);
  const canManage = hasPermission(currentUser, "inventory.attributes.manage");
  const load = () => request<{ items: AttributeDefinition[] }>("/inventory/attributes").then((result) => setItems(result.items));
  useEffect(() => { void load(); }, []);

  return (
    <MasterPanel title="商品参数" description="内置容量、频率、代际、颗粒规格、ECC 等常用项，也可按业务继续新增、编辑和停用。" count={`${items.length} 项`} canManage={canManage} onCreate={() => { setEditing(null); setShowForm(true); }} onRefresh={load}>
      <div className="table-wrap"><table><thead><tr><th>参数名称</th><th>编码</th><th>输入类型</th><th>选项</th><th>状态</th><th className="action-cell">操作</th></tr></thead><tbody>
        {items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td className="code-cell">{item.code}</td><td>{valueTypeLabel(item.valueType)}</td><td className="muted-cell">{item.optionsText || "-"}</td><td><StatusBadge status={item.status} /></td><td className="action-cell">{canManage && <button className="table-action" onClick={() => { setEditing(item); setShowForm(true); }}>编辑</button>}</td></tr>)}
        {!items.length && <EmptyTable colSpan={6} title="暂无商品参数" description="可创建适用于内存条或其他物料的动态参数。" />}
      </tbody></table></div>
      {showForm && <AttributeForm item={editing} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); void load(); }} />}
    </MasterPanel>
  );
}

function ItemsPanel({ currentUser }: { currentUser: User }) {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [stockItem, setStockItem] = useState<Item | null>(null);
  const [stockBalances, setStockBalances] = useState<ItemWarehouseBalance[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState("");
  const [filters, setFilters] = useState<ItemFilters>({
    categoryId: "all",
    warehouseId: "all",
    stockStatus: "all",
    trackingMode: "all",
    status: "all"
  });
  const canManage = hasPermission(currentUser, "inventory.items.manage");
  const canViewCategories = hasPermission(currentUser, "inventory.categories.view");
  const canViewWarehouses = hasPermission(currentUser, "inventory.warehouses.view");
  const loadFilters = async () => {
    const [categoryResult, warehouseResult] = await Promise.all([
      canViewCategories ? request<{ items: Category[] }>("/inventory/categories") : Promise.resolve({ items: [] as Category[] }),
      canViewWarehouses ? request<{ items: WarehouseRow[] }>("/inventory/warehouses") : Promise.resolve({ items: [] as WarehouseRow[] })
    ]);
    setCategories(categoryResult.items);
    setWarehouses(warehouseResult.items.filter((item) => item.status === "active"));
  };
  useEffect(() => { void loadFilters(); }, [canViewCategories, canViewWarehouses]);
  const categoryOptions = useMemo(() => flattenCategoryTree(buildCategoryTree(categories)), [categories]);
  const categoryPaths = useMemo(() => buildCategoryPaths(categories), [categories]);
  const load = () => {
    const params = new URLSearchParams();
    if (filters.categoryId !== "all") params.set("categoryId", filters.categoryId);
    if (filters.warehouseId !== "all") params.set("warehouseId", filters.warehouseId);
    if (filters.stockStatus !== "all") params.set("stockStatus", filters.stockStatus);
    if (filters.trackingMode !== "all") params.set("trackingMode", filters.trackingMode);
    if (filters.status !== "all") params.set("status", filters.status);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<{ items: Item[] }>(`/inventory/items${suffix}`).then((result) => setItems(result.items));
  };
  useEffect(() => { void load(); }, [filters.categoryId, filters.warehouseId, filters.stockStatus, filters.trackingMode, filters.status]);
  const filtered = items.filter((item) => `${item.itemCode}${item.name}${item.categoryName ?? ""}${item.barcode ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const openStockDetails = async (item: Item) => {
    setStockItem(item);
    setStockBalances([]);
    setStockError("");
    setStockLoading(true);
    try {
      const result = await request<{ items: ItemWarehouseBalance[] }>(`/inventory/items/${item.id}/balances`);
      setStockBalances(result.items);
    } catch (loadError) {
      setStockError(errorMessage(loadError));
    } finally {
      setStockLoading(false);
    }
  };

  return (
    <MasterPanel title="商品资料" description="商品编码支持手动填写；留空时系统自动生成，之后可在商品编辑中修改。" count={`${items.length} 个`} canManage={canManage} onCreate={() => { setEditing(null); setShowForm(true); }} onRefresh={load}>
      <div className="toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索商品编码、名称、分类或条码" /></div></div>
      <div className="inventory-filters product-filters">
        <label>商品分类<select value={filters.categoryId} onChange={(event) => setFilters({ ...filters, categoryId: event.target.value })}><option value="all">全部分类</option>{categoryOptions.map((category) => <option value={category.id} key={category.id}>{categoryOptionLabel(category)}</option>)}</select></label>
        <label>仓库<select value={filters.warehouseId} onChange={(event) => setFilters({ ...filters, warehouseId: event.target.value })}><option value="all">全部授权仓库</option>{warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name}</option>)}</select></label>
        <label>库存状态<select value={filters.stockStatus} onChange={(event) => setFilters({ ...filters, stockStatus: event.target.value as ItemFilters["stockStatus"] })}><option value="all">全部库存</option><option value="in_stock">有库存</option><option value="out_of_stock">无库存</option></select></label>
        <label>追溯方式<select value={filters.trackingMode} onChange={(event) => setFilters({ ...filters, trackingMode: event.target.value as ItemFilters["trackingMode"] })}><option value="all">全部追溯方式</option><option value="none">仅数量</option><option value="lot">按批次</option><option value="serial">按序列号</option></select></label>
        <label>商品状态<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value as ItemFilters["status"] })}><option value="all">全部状态</option><option value="active">启用</option><option value="inactive">停用</option></select></label>
      </div>
      <div className="table-wrap"><table className="items-table"><thead><tr><th>商品</th><th>分类</th><th>库存单位</th><th>采购价格</th><th>销售价格</th><th>{filters.warehouseId === "all" ? "当前库存" : "仓库库存"}</th><th>追溯方式</th><th>参数</th><th>状态</th><th className="action-cell">操作</th></tr></thead><tbody>
        {filtered.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small className="code-cell">{item.itemCode}{item.barcode ? ` · ${item.barcode}` : ""}</small></td><td>{item.categoryId ? categoryPaths.get(item.categoryId) ?? item.categoryName ?? "-" : item.categoryName || "-"}</td><td>{item.unitName || "-"}</td><td className="price-cell">{formatPrice(item.purchasePrice)}</td><td className="price-cell">{formatPrice(item.salesPrice)}</td><td><button className="link-button quantity-link" onClick={() => void openStockDetails(item)} title="查看各仓库库存">{formatQuantity(item.stockQuantity ?? 0)}</button></td><td>{trackingLabel(item.trackingMode)}</td><td>{item.attributeCount ?? 0} 项</td><td><StatusBadge status={item.status} /></td><td className="action-cell">{canManage && <button className="table-action" onClick={() => { setEditing(item); setShowForm(true); }}>编辑</button>}</td></tr>)}
        {!filtered.length && <EmptyTable colSpan={10} title="暂无商品资料" description="建立商品后才能创建入库、出库等库存单据。" />}
      </tbody></table></div>
      {showForm && <ItemForm item={editing} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); void load(); }} />}
      {stockItem && <ItemStockModal item={stockItem} balances={stockBalances} selectedWarehouseId={filters.warehouseId === "all" ? null : Number(filters.warehouseId)} loading={stockLoading} error={stockError} onClose={() => setStockItem(null)} />}
    </MasterPanel>
  );
}

function ItemStockModal({
  item,
  balances,
  selectedWarehouseId,
  loading,
  error,
  onClose
}: {
  item: Item;
  balances: ItemWarehouseBalance[];
  selectedWarehouseId: number | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const authorizedTotal = balances.reduce((total, balance) => total + balance.quantity, 0);
  return (
    <SimpleModal title={`${item.name} · 当前库存`} onClose={onClose}>
      <div className="stock-detail">
        <div className={`stock-detail-summary ${selectedWarehouseId ? "with-scope" : ""}`}>
          <div><span>商品编码</span><strong>{item.itemCode}</strong></div>
          <div><span>{selectedWarehouseId ? "筛选仓库库存" : "授权仓库总量"}</span><strong>{formatQuantity(item.stockQuantity ?? 0)} {item.unitName || ""}</strong></div>
          {selectedWarehouseId && <div><span>授权仓库总量</span><strong>{formatQuantity(authorizedTotal)} {item.unitName || ""}</strong></div>}
        </div>
        {error && <div className="form-error">{error}</div>}
        {loading ? <div className="stock-detail-loading">正在加载各仓库库存...</div> : (
          <div className="table-wrap"><table><thead><tr><th>仓库</th><th>仓库类型</th><th>所属部门</th><th>库存数量</th><th>库存单位</th></tr></thead><tbody>
            {balances.map((balance) => <tr className={selectedWarehouseId === balance.warehouseId ? "selected-stock-row" : ""} key={balance.warehouseId}><td><strong>{balance.warehouseName}</strong><small className="code-cell">{balance.warehouseCode}</small></td><td>{warehouseTypeLabels[balance.warehouseType]}</td><td>{balance.departmentName}</td><td className="quantity-cell">{formatQuantity(balance.quantity)}</td><td>{item.unitName || "-"}</td></tr>)}
            {!balances.length && <EmptyTable colSpan={5} title="暂无可查看的仓库" description="当前账号没有授权仓库，或该商品尚未形成库存。" />}
          </tbody></table></div>
        )}
      </div>
    </SimpleModal>
  );
}

function WarehousesPanel({ currentUser }: { currentUser: User }) {
  const [items, setItems] = useState<WarehouseRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [editing, setEditing] = useState<WarehouseRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const canManage = hasPermission(currentUser, "inventory.warehouses.manage");
  const load = async () => {
    const [warehouseResult, departmentResult] = await Promise.all([
      request<{ items: WarehouseRow[] }>("/inventory/warehouses"),
      request<{ items: Department[] }>("/departments")
    ]);
    setItems(warehouseResult.items);
    setDepartments(departmentResult.items);
  };
  useEffect(() => { void load(); }, []);

  return (
    <MasterPanel title="仓库管理" description="仓库必须归属部门。部门经理和员工只会看到自身部门或获授权部门的仓库数据。" count={`${items.length} 个`} canManage={canManage} onCreate={() => { setEditing(null); setShowForm(true); }} onRefresh={load}>
      <div className="table-wrap"><table><thead><tr><th>仓库</th><th>仓库类型</th><th>所属部门</th><th>负责人</th><th>仓库地址</th><th>描述</th><th>状态</th><th className="action-cell">操作</th></tr></thead><tbody>
        {items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small className="code-cell">{item.code}</small></td><td>{warehouseTypeLabels[item.warehouseType]}</td><td>{item.departmentName}</td><td>{item.managerName || "-"}</td><td>{item.address || "-"}</td><td className="muted-cell">{item.description || "-"}</td><td><StatusBadge status={item.status} /></td><td className="action-cell">{canManage && <button className="table-action" onClick={() => { setEditing(item); setShowForm(true); }}>编辑</button>}</td></tr>)}
        {!items.length && <EmptyTable colSpan={8} title="暂无仓库" description="创建仓库后，入出库单据才能选择目标仓库。" />}
      </tbody></table></div>
      {showForm && <WarehouseForm item={editing} departments={departments} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); void load(); }} />}
    </MasterPanel>
  );
}

function BalancesPanel() {
  const [items, setItems] = useState<StockBalance[]>([]);
  const [query, setQuery] = useState("");
  const load = () => request<{ items: StockBalance[] }>("/inventory/balances").then((result) => setItems(result.items));
  useEffect(() => { void load(); }, []);
  const filtered = items.filter((item) => `${item.itemCode}${item.itemName}${item.warehouseName}${item.lotNo}${item.serialNo}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <MasterPanel title="库存余额" description="库存余额由已过账台账自动汇总；页面不提供直接修改数量的入口。" count={`${items.length} 条`} canManage={false} onCreate={() => undefined} onRefresh={load}>
      <div className="toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索商品、仓库、批次或序列号" /></div></div>
      <div className="table-wrap"><table><thead><tr><th>商品</th><th>仓库</th><th>批次 / 序列号</th><th>库存数量</th><th>单位</th></tr></thead><tbody>
        {filtered.map((item) => <tr key={`${item.itemId}-${item.warehouseId}-${item.lotNo}-${item.serialNo}`}><td><strong>{item.itemName}</strong><small className="code-cell">{item.itemCode}</small></td><td><strong>{item.warehouseName}</strong><small>{warehouseTypeLabels[item.warehouseType]}</small></td><td>{item.serialNo || item.lotNo || "-"}</td><td className="quantity-cell">{formatQuantity(item.quantity)}</td><td>{item.unitName || "-"}</td></tr>)}
        {!filtered.length && <EmptyTable colSpan={5} title="暂无库存余额" description="完成入库单过账后，库存会显示在这里。" />}
      </tbody></table></div>
    </MasterPanel>
  );
}

function LedgerPanel() {
  const [items, setItems] = useState<LedgerEntry[]>([]);
  const load = () => request<{ items: LedgerEntry[] }>("/inventory/ledger").then((result) => setItems(result.items));
  useEffect(() => { void load(); }, []);

  return (
    <MasterPanel title="库存台账" description="每一笔已过账库存单据均生成台账流水。台账只读，用于数量核对和追溯。" count={`最近 ${items.length} 条`} canManage={false} onCreate={() => undefined} onRefresh={load}>
      <div className="table-wrap"><table><thead><tr><th>时间</th><th>来源单据</th><th>商品</th><th>仓库</th><th>批次 / 序列号</th><th>数量变动</th></tr></thead><tbody>
        {items.map((item) => <tr key={item.id}><td className="muted-cell">{formatDate(item.createdAt)}</td><td><strong>{item.documentNo}</strong><small>{documentMeta[item.documentType].label}</small></td><td><strong>{item.itemName}</strong><small className="code-cell">{item.itemCode}</small></td><td><strong>{item.warehouseName}</strong><small>{warehouseTypeLabels[item.warehouseType]}</small></td><td>{item.serialNo || item.lotNo || "-"}</td><td className={item.quantityDelta >= 0 ? "quantity-positive" : "quantity-negative"}>{item.quantityDelta >= 0 ? "+" : ""}{formatQuantity(item.quantityDelta)}</td></tr>)}
        {!items.length && <EmptyTable colSpan={6} title="暂无库存台账" description="审批并过账库存单据后，这里会产生不可直接修改的流水。" />}
      </tbody></table></div>
    </MasterPanel>
  );
}

function DocumentsPanel({ currentUser, fixedType }: { currentUser: User; fixedType?: DocumentType }) {
  const [items, setItems] = useState<StockDocument[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | DocumentType>(fixedType ?? "all");
  const [statusFilter, setStatusFilter] = useState<"all" | DocumentStatus>("all");
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<StockDocumentDetail | null>(null);
  const canCreateAny = (Object.keys(documentMeta) as DocumentType[]).some((type) => hasPermission(currentUser, documentMeta[type].createPermission));
  const canCreate = fixedType ? hasPermission(currentUser, documentMeta[fixedType].createPermission) : canCreateAny;
  const title = fixedType ? documentMeta[fixedType].label : "出入库记录";
  const description = fixedType
    ? `${documentMeta[fixedType].label}按提交、审批和过账流程执行，库存变动仅在过账后生效。`
    : "入库、出库、调拨、盘点、报废统一留存并支持按类型和状态查询。";
  const load = () => {
    const params = new URLSearchParams();
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<{ items: StockDocument[] }>(`/inventory/documents${suffix}`).then((result) => setItems(result.items));
  };
  useEffect(() => { void load(); }, [typeFilter, statusFilter]);

  const runAction = async (item: StockDocument, action: "submit" | "approve" | "post" | "cancel") => {
    await request(`/inventory/documents/${item.id}/${action}`, { method: "POST" });
    await load();
  };
  const recordDocumentOutput = async (id: number, action: DocumentOutputAction) => {
    try {
      await request(`/inventory/documents/${id}/output-actions`, {
        method: "POST",
        body: JSON.stringify({ action })
      });
    } catch (auditError) {
      console.error("库存单据输出操作审计记录失败", auditError);
    }
  };
  const openDetail = async (id: number) => {
    const result = await request<{ document: StockDocumentDetail }>(`/inventory/documents/${id}`);
    setDetail(result.document);
    void recordDocumentOutput(id, "preview");
  };
  const printDocument = async (id: number) => {
    const result = await request<{ document: StockDocumentDetail }>(`/inventory/documents/${id}`);
    printStockDocument(result.document);
    void recordDocumentOutput(id, "print");
  };
  const downloadDocument = async (id: number) => {
    const result = await request<{ document: StockDocumentDetail }>(`/inventory/documents/${id}`);
    downloadStockDocument(result.document);
    void recordDocumentOutput(id, "download");
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <div><span className="eyebrow">库存作业</span><h2>{title}</h2><p>{description}</p></div>
        <div className="header-actions">
          <button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} />刷新</button>
          {canCreate && <button className="primary-button" onClick={() => setShowForm(true)}><FilePlus2 size={16} />新建{fixedType ? documentMeta[fixedType].label : "单据"}</button>}
        </div>
      </div>
      <div className="inventory-filters">
        {!fixedType && <label>单据类型<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | DocumentType)}><option value="all">全部类型</option>{(Object.keys(documentMeta) as DocumentType[]).map((type) => <option key={type} value={type}>{documentMeta[type].label}</option>)}</select></label>}
        <label>单据状态<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | DocumentStatus)}><option value="all">全部状态</option><option value="draft">草稿</option><option value="submitted">待审批</option><option value="approved">待过账</option><option value="posted">已过账</option><option value="cancelled">已取消</option></select></label>
      </div>
      <div className="table-wrap"><table className="documents-table"><thead><tr><th>单据编号</th><th>类型</th><th>部门 / 仓库</th><th>业务日期</th><th>明细</th><th>状态</th><th>创建人</th><th className="action-cell document-output-cell">单据输出</th><th className="action-cell document-workflow-cell">流程操作</th></tr></thead><tbody>
        {items.map((item) => <tr key={item.id}><td><button className="link-button" onClick={() => void openDetail(item.id)}>{item.documentNo}</button></td><td>{documentMeta[item.documentType].label}</td><td><strong>{item.departmentName}</strong><small>{documentWarehouseLabel(item)}</small></td><td>{item.businessDate}</td><td>{item.lineCount} 行</td><td><DocumentStatusBadge status={item.status} /></td><td>{item.createdByName}</td><td className="action-cell document-output-cell"><DocumentOutputActions onPreview={() => void openDetail(item.id)} onPrint={() => void printDocument(item.id)} onDownload={() => void downloadDocument(item.id)} /></td><td className="action-cell document-workflow-cell"><DocumentWorkflowActions item={item} currentUser={currentUser} onAction={runAction} /></td></tr>)}
        {!items.length && <EmptyTable colSpan={9} title="暂无库存单据" description="商品和仓库准备好后，可从正常入库单开始建立库存。" />}
      </tbody></table></div>
      {showForm && <DocumentForm currentUser={currentUser} fixedType={fixedType} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); void load(); }} />}
      {detail && <DocumentDetailModal document={detail} onClose={() => setDetail(null)} onPrint={() => { printStockDocument(detail); void recordDocumentOutput(detail.id, "print"); }} onDownload={() => { downloadStockDocument(detail); void recordDocumentOutput(detail.id, "download"); }} />}
    </section>
  );
}

function DocumentOutputActions({ onPreview, onPrint, onDownload }: { onPreview: () => void; onPrint: () => void; onDownload: () => void }) {
  return <div className="document-output-actions"><button className="table-icon-action" onClick={onPreview} title="预览单据" aria-label="预览单据"><Eye size={16} /></button><button className="table-icon-action" onClick={onPrint} title="打印单据" aria-label="打印单据"><Printer size={16} /></button><button className="table-icon-action" onClick={onDownload} title="下载单据 CSV" aria-label="下载单据 CSV"><Download size={16} /></button></div>;
}

function DocumentWorkflowActions({ item, currentUser, onAction }: { item: StockDocument; currentUser: User; onAction: (item: StockDocument, action: "submit" | "approve" | "post" | "cancel") => Promise<void> }) {
  const meta = documentMeta[item.documentType];
  return <div className="document-workflow-actions">{item.status === "draft" && hasPermission(currentUser, meta.createPermission) && <button className="table-action" onClick={() => void onAction(item, "submit")}>提交</button>}{item.status === "submitted" && hasPermission(currentUser, meta.approvePermission) && <button className="table-action" onClick={() => void onAction(item, "approve")}>审批</button>}{item.status === "approved" && hasPermission(currentUser, meta.postPermission) && <button className="table-action" onClick={() => void onAction(item, "post")}>过账</button>}{["draft", "submitted"].includes(item.status) && hasPermission(currentUser, meta.createPermission) && <button className="table-action danger-action" onClick={() => void onAction(item, "cancel")}>取消</button>}</div>;
}

function MasterPanel({ title, description, count, canManage, onCreate, onRefresh, children }: { title: string; description: string; count: string; canManage: boolean; onCreate: () => void; onRefresh: () => void; children: React.ReactNode }) {
  return <section className="panel"><div className="panel-heading"><div><span className="eyebrow">库存主数据</span><h2>{title}</h2><p>{description}</p></div><div className="header-actions"><span className="count-label">{count}</span><button className="icon-button" onClick={onRefresh} title="刷新列表" aria-label="刷新列表"><RefreshCw size={17} /></button>{canManage && <button className="primary-button" onClick={onCreate}><Plus size={16} />新建</button>}</div></div>{children}</section>;
}

function CategoryForm({ item, categories, onClose, onSaved }: { item: Category | null; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ code: item?.code ?? "", name: item?.name ?? "", parentId: item?.parentId?.toString() ?? "", description: item?.description ?? "", status: item?.status ?? "active" });
  const categoryOptions = flattenCategoryTree(buildCategoryTree(categories));
  const excludedCategoryIds = getDescendantCategoryIds(categories, item?.id);
  return <EntityModal title={item ? "编辑商品分类" : "新建商品分类"} onClose={onClose} onSubmit={async () => { const body = { ...form, parentId: form.parentId ? Number(form.parentId) : null }; await request(item ? `/inventory/categories/${item.id}` : "/inventory/categories", { method: item ? "PUT" : "POST", body: JSON.stringify(body) }); }} onSaved={onSaved}>
    <div className="form-grid"><label>分类名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>分类编码<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="留空自动生成" /></label><label>上级分类<select value={form.parentId} onChange={(event) => setForm({ ...form, parentId: event.target.value })}><option value="">无上级分类</option>{categoryOptions.filter((category) => !excludedCategoryIds.has(category.id)).map((category) => <option value={category.id} key={category.id}>{categoryOptionLabel(category)}</option>)}</select></label><label>状态<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "active" | "inactive" })}><option value="active">启用</option><option value="inactive">停用</option></select></label><label className="full-span">分类描述<textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div>
  </EntityModal>;
}

function UnitForm({ item, onClose, onSaved }: { item: Unit | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ code: item?.code ?? "", name: item?.name ?? "", precision: String(item?.precision ?? 0), status: item?.status ?? "active" });
  return <EntityModal title={item ? "编辑计量单位" : "新建计量单位"} onClose={onClose} onSubmit={async () => { await request(item ? `/inventory/units/${item.id}` : "/inventory/units", { method: item ? "PUT" : "POST", body: JSON.stringify({ ...form, precision: Number(form.precision) }) }); }} onSaved={onSaved}>
    <div className="form-grid"><label>单位名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>单位编码<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="留空自动生成" /></label><label>数量精度<select value={form.precision} onChange={(event) => setForm({ ...form, precision: event.target.value })}>{[0, 1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} 位小数</option>)}</select></label><label>状态<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "active" | "inactive" })}><option value="active">启用</option><option value="inactive">停用</option></select></label></div>
  </EntityModal>;
}

function AttributeForm({ item, onClose, onSaved }: { item: AttributeDefinition | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ code: item?.code ?? "", name: item?.name ?? "", valueType: item?.valueType ?? "text", optionsText: item?.optionsText ?? "", status: item?.status ?? "active" });
  return <EntityModal title={item ? "编辑商品参数" : "新建商品参数"} onClose={onClose} onSubmit={async () => { await request(item ? `/inventory/attributes/${item.id}` : "/inventory/attributes", { method: item ? "PUT" : "POST", body: JSON.stringify(form) }); }} onSaved={onSaved}>
    <div className="form-grid"><label>参数名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>参数编码<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="留空自动生成" /></label><label>输入类型<select value={form.valueType} onChange={(event) => setForm({ ...form, valueType: event.target.value as AttributeDefinition["valueType"] })}><option value="text">文本</option><option value="number">数字</option><option value="select">下拉选项</option></select></label><label>状态<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "active" | "inactive" })}><option value="active">启用</option><option value="inactive">停用</option></select></label><label className="full-span">下拉选项（用逗号分隔）<input value={form.optionsText} onChange={(event) => setForm({ ...form, optionsText: event.target.value })} disabled={form.valueType !== "select"} placeholder="例如：支持,不支持" /></label></div>
  </EntityModal>;
}

function ItemForm({ item, onClose, onSaved }: { item: Item | null; onClose: () => void; onSaved: () => void }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [attributes, setAttributes] = useState<AttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ itemCode: item?.itemCode ?? "", name: item?.name ?? "", categoryId: item?.categoryId?.toString() ?? "", unitId: item?.unitId?.toString() ?? "", purchasePrice: item ? String(item.purchasePrice ?? "") : "", salesPrice: item ? String(item.salesPrice ?? "") : "", barcode: item?.barcode ?? "", trackingMode: item?.trackingMode ?? "none", description: item?.description ?? "", status: item?.status ?? "active", attributeValues: {} as Record<string, string> });

  useEffect(() => {
    const load = async () => {
      const [categoryResult, unitResult, attributeResult] = await Promise.all([
        request<{ items: Category[] }>("/inventory/categories"),
        request<{ items: Unit[] }>("/inventory/units"),
        request<{ items: AttributeDefinition[] }>("/inventory/attributes")
      ]);
      setCategories(categoryResult.items.filter((entry) => entry.status === "active"));
      setUnits(unitResult.items.filter((entry) => entry.status === "active"));
      let values: Record<string, string> = {};
      if (item) {
        const detail = await request<{ item: Item; attributes: AttributeDefinition[] }>(`/inventory/items/${item.id}`);
        values = Object.fromEntries(detail.attributes.map((attribute) => [String(attribute.id), attribute.value ?? ""]));
      }
      setAttributes(attributeResult.items.filter((entry) => entry.status === "active"));
      setForm((current) => ({ ...current, attributeValues: values }));
      setLoading(false);
    };
    void load();
  }, [item]);

  const categoryOptions = useMemo(() => flattenCategoryTree(buildCategoryTree(categories)), [categories]);
  if (loading) return <SimpleModal title={item ? "编辑商品资料" : "新建商品资料"} onClose={onClose}><div className="modal-form">正在加载商品配置...</div></SimpleModal>;
  const submit = async () => {
    const body = {
      itemCode: form.itemCode,
      name: form.name,
      categoryId: Number(form.categoryId),
      unitId: Number(form.unitId),
      purchasePrice: form.purchasePrice === "" ? 0 : Number(form.purchasePrice),
      salesPrice: form.salesPrice === "" ? 0 : Number(form.salesPrice),
      barcode: form.barcode,
      trackingMode: form.trackingMode,
      description: form.description,
      status: form.status,
      attributes: Object.entries(form.attributeValues).map(([attributeId, value]) => ({ attributeId: Number(attributeId), value }))
    };
    await request(item ? `/inventory/items/${item.id}` : "/inventory/items", { method: item ? "PUT" : "POST", body: JSON.stringify(body) });
  };

  return <EntityModal title={item ? "编辑商品资料" : "新建商品资料"} onClose={onClose} onSubmit={submit} onSaved={onSaved}>
    <div className="form-grid"><label>商品名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>商品编码<input value={form.itemCode} onChange={(event) => setForm({ ...form, itemCode: event.target.value })} placeholder="手动填写；留空自动生成" /></label><label>商品分类<select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">请选择分类</option>{categoryOptions.map((category) => <option key={category.id} value={category.id}>{categoryOptionLabel(category)}</option>)}</select></label><label>库存单位<select value={form.unitId} onChange={(event) => setForm({ ...form, unitId: event.target.value })}><option value="">请选择单位</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label>采购价格<input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(event) => setForm({ ...form, purchasePrice: event.target.value })} placeholder="可选，未设置留空" /></label><label>销售价格<input type="number" min="0" step="0.01" value={form.salesPrice} onChange={(event) => setForm({ ...form, salesPrice: event.target.value })} placeholder="可选，未设置留空" /></label><label>条码<input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} /></label><label>追溯方式<select value={form.trackingMode} onChange={(event) => setForm({ ...form, trackingMode: event.target.value as Item["trackingMode"] })}><option value="none">仅数量</option><option value="lot">按批次</option><option value="serial">按序列号</option></select></label><label>状态<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "active" | "inactive" })}><option value="active">启用</option><option value="inactive">停用</option></select></label><label className="full-span">商品描述<textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div>
    <div className="attribute-form"><div className="field-label">商品参数</div><div className="parameter-grid">{attributes.map((attribute) => <label key={attribute.id}>{attribute.name}{attribute.valueType === "select" ? <select value={form.attributeValues[String(attribute.id)] ?? ""} onChange={(event) => setForm({ ...form, attributeValues: { ...form.attributeValues, [attribute.id]: event.target.value } })}><option value="">未填写</option>{attribute.optionsText.split(",").filter(Boolean).map((option) => <option value={option.trim()} key={option}>{option.trim()}</option>)}</select> : <input type={attribute.valueType === "number" ? "number" : "text"} value={form.attributeValues[String(attribute.id)] ?? ""} onChange={(event) => setForm({ ...form, attributeValues: { ...form.attributeValues, [attribute.id]: event.target.value } })} />}</label>)}</div></div>
  </EntityModal>;
}

function WarehouseForm({ item, departments, onClose, onSaved }: { item: WarehouseRow | null; departments: Department[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ code: item?.code ?? "", name: item?.name ?? "", departmentId: item?.departmentId?.toString() ?? "", warehouseType: item?.warehouseType ?? "general" as WarehouseType, address: item?.address ?? "", description: item?.description ?? "", status: item?.status ?? "active" });
  return <EntityModal title={item ? "编辑仓库" : "新建仓库"} onClose={onClose} onSubmit={async () => { await request(item ? `/inventory/warehouses/${item.id}` : "/inventory/warehouses", { method: item ? "PUT" : "POST", body: JSON.stringify({ ...form, departmentId: Number(form.departmentId) }) }); }} onSaved={onSaved}>
    <div className="form-grid"><label>仓库名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>仓库编码<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="留空自动生成" /></label><label>仓库类型<select value={form.warehouseType} onChange={(event) => setForm({ ...form, warehouseType: event.target.value as WarehouseType })}>{Object.entries(warehouseTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>所属部门<select value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })}><option value="">请选择部门</option>{departments.filter((department) => department.status === "active").map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label><label>状态<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "active" | "inactive" })}><option value="active">启用</option><option value="inactive">停用</option></select></label><label className="full-span">仓库地址<textarea rows={2} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="例如：广东省深圳市龙华区 XX 工业园 A 栋 1 楼原料仓" /></label><label className="full-span">仓库描述<textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div>
  </EntityModal>;
}

function DocumentForm({ currentUser, fixedType, onClose, onSaved }: { currentUser: User; fixedType?: DocumentType; onClose: () => void; onSaved: () => void }) {
  const availableTypes = (fixedType ? [fixedType] : Object.keys(documentMeta) as DocumentType[]).filter((type) => hasPermission(currentUser, documentMeta[type].createPermission));
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [itemCategoryId, setItemCategoryId] = useState("all");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ documentType: fixedType ?? availableTypes[0] ?? "receipt", businessDate: today(), warehouseId: "", sourceWarehouseId: "", targetWarehouseId: "", supplierName: "", purchaseOrderNo: "", referenceNo: "", reason: "", remark: "", lines: [] as DocumentLineForm[] });

  useEffect(() => {
    void Promise.all([
      request<{ items: Item[] }>("/inventory/items"),
      request<{ items: WarehouseRow[] }>("/inventory/warehouses")
    ]).then(([itemResult, warehouseResult]) => {
      setItems(itemResult.items.filter((item) => item.status === "active"));
      setWarehouses(warehouseResult.items.filter((warehouse) => warehouse.status === "active"));
    }).catch((loadError) => setError(errorMessage(loadError)));
  }, []);

  const changeLine = (index: number, field: keyof DocumentLineForm, value: string) => setForm((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line) }));
  const removeLine = (index: number) => setForm((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }));
  const activeItems = items.filter((item) => item.status === "active");
  const itemCategories = useMemo(
    () => Array.from(
      new Map(
        activeItems
          .filter((item) => item.categoryId && item.categoryName)
          .map((item) => [item.categoryId, { id: item.categoryId as number, name: item.categoryName as string }])
      ).values()
    ).sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    [items]
  );
  const filteredItems = activeItems.filter((item) => {
    const keyword = itemSearch.trim().toLowerCase();
    const matchesSearch = !keyword || `${item.itemCode}${item.name}${item.barcode ?? ""}${item.categoryName ?? ""}`.toLowerCase().includes(keyword);
    const matchesCategory = itemCategoryId === "all" || item.categoryId?.toString() === itemCategoryId;
    return matchesSearch && matchesCategory;
  });
  const selectedItemIds = useMemo(() => new Set(form.lines.map((line) => line.itemId)), [form.lines]);
  const addItem = (item: Item) => {
    if (selectedItemIds.has(item.id.toString())) return;
    setForm((current) => ({
      ...current,
      lines: [...current.lines, { itemId: item.id.toString(), quantity: "", lotNo: "", serialNo: "", remark: "" }]
    }));
    setError("");
  };
  const save = async (submit: boolean) => {
    setError("");
    if (!form.lines.length) {
      setError("请先搜索并选择至少一个商品");
      return;
    }
    const invalidQuantityIndex = form.lines.findIndex((line) => !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0);
    if (invalidQuantityIndex >= 0) {
      setError(`第 ${invalidQuantityIndex + 1} 行数量必须大于 0`);
      return;
    }
    setSaving(true);
    try {
      const created = await request<{ document: StockDocument }>("/inventory/documents", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          warehouseId: form.warehouseId ? Number(form.warehouseId) : undefined,
          sourceWarehouseId: form.sourceWarehouseId ? Number(form.sourceWarehouseId) : undefined,
          targetWarehouseId: form.targetWarehouseId ? Number(form.targetWarehouseId) : undefined,
          lines: form.lines.map((line) => ({ ...line, itemId: Number(line.itemId), quantity: Number(line.quantity) }))
        })
      });
      if (submit) await request(`/inventory/documents/${created.document.id}/submit`, { method: "POST" });
      onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };
  const singleWarehouseLabel = form.documentType === "receipt" ? "目标仓库" : form.documentType === "issue" ? "出库仓库" : form.documentType === "count" ? "盘点仓库" : "报废仓库";

  return <SimpleModal title={`新建${documentMeta[form.documentType].label}`} onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); void save(true); }}>
    <div className="form-grid">{!fixedType && <label>单据类型<select value={form.documentType} onChange={(event) => setForm({ ...form, documentType: event.target.value as DocumentType, warehouseId: "", sourceWarehouseId: "", targetWarehouseId: "" })}>{availableTypes.map((type) => <option key={type} value={type}>{documentMeta[type].label}</option>)}</select></label>}<label>业务日期<input type="date" value={form.businessDate} onChange={(event) => setForm({ ...form, businessDate: event.target.value })} /></label>{form.documentType === "transfer" ? <><label>调出仓库<select value={form.sourceWarehouseId} onChange={(event) => setForm({ ...form, sourceWarehouseId: event.target.value })}><option value="">请选择调出仓库</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouseTypeLabels[warehouse.warehouseType]} · {warehouse.departmentName}</option>)}</select></label><label>调入仓库<select value={form.targetWarehouseId} onChange={(event) => setForm({ ...form, targetWarehouseId: event.target.value })}><option value="">请选择调入仓库</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouseTypeLabels[warehouse.warehouseType]} · {warehouse.departmentName}</option>)}</select></label></> : <label className="full-span">{singleWarehouseLabel}<select value={form.warehouseId} onChange={(event) => setForm({ ...form, warehouseId: event.target.value })}><option value="">请选择仓库</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouseTypeLabels[warehouse.warehouseType]} · {warehouse.departmentName}</option>)}</select></label>}{form.documentType === "receipt" && <><label>供应商<input value={form.supplierName} onChange={(event) => setForm({ ...form, supplierName: event.target.value })} placeholder="可选" /></label><label>采购单号<input value={form.purchaseOrderNo} onChange={(event) => setForm({ ...form, purchaseOrderNo: event.target.value })} placeholder="可选" /></label></>}<label>来源单号<input value={form.referenceNo} onChange={(event) => setForm({ ...form, referenceNo: event.target.value })} placeholder="可选" /></label><label>原因 / 用途<input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder={form.documentType === "scrap" ? "报废原因" : "可选"} /></label><label className="full-span">备注<textarea rows={2} value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} /></label></div>
    <div className="document-lines">
      <div className="document-item-picker">
        <div className="document-lines-heading"><div><span className="eyebrow">选择商品</span><strong>先搜索或筛选商品，再加入{documentMeta[form.documentType].label}</strong></div><span className="document-item-count">匹配 {filteredItems.length} 个</span></div>
        <div className="document-item-filters"><label>搜索商品<input autoFocus value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="编码、名称或条码" /></label><label>商品分类<select value={itemCategoryId} onChange={(event) => setItemCategoryId(event.target.value)}><option value="all">全部分类</option>{itemCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label></div>
        <div className="document-item-results">
          {!activeItems.length ? <div className="document-item-empty"><Package size={18} /><strong>暂无商品</strong><span>请先在“商品资料”中维护启用商品后再创建单据。</span></div> : !filteredItems.length ? <div className="document-item-empty"><Search size={18} /><strong>没有匹配商品</strong><span>调整搜索条件或商品分类后重试。</span></div> : filteredItems.map((item) => {
            const selected = selectedItemIds.has(item.id.toString());
            return <button type="button" key={item.id} className="document-item-option" onClick={() => addItem(item)} disabled={selected}><span><strong>{item.name}</strong><small>{item.itemCode}{item.categoryName ? ` · ${item.categoryName}` : ""}{item.unitName ? ` · ${item.unitName}` : ""}</small></span><b>{selected ? "已加入" : "加入明细"}</b></button>;
          })}
        </div>
      </div>
      <div className="document-lines-heading"><div><span className="eyebrow">已选商品</span><strong>{form.lines.length ? `已加入 ${form.lines.length} 个商品，请填写数量和追溯信息` : "尚未选择商品"}</strong></div></div>
      {!form.lines.length ? <div className="document-lines-empty">从上方搜索结果中选择商品后，明细会显示在这里。</div> : form.lines.map((line, index) => {
        const item = activeItems.find((candidate) => candidate.id.toString() === line.itemId);
        return <div className="document-line" key={line.itemId}><div className="document-line-product"><span>{index + 1}</span><div><strong>{item?.name ?? "商品不可用"}</strong><small>{item?.itemCode ?? line.itemId}{item?.unitName ? ` · ${item.unitName}` : ""}</small></div></div><label>{form.documentType === "count" ? "实盘数量" : "数量"}<input type="number" min="0" step="any" value={line.quantity} onChange={(event) => changeLine(index, "quantity", event.target.value)} /></label><label>批次号<input value={line.lotNo} onChange={(event) => changeLine(index, "lotNo", event.target.value)} placeholder="按批次商品必填" /></label><label>序列号<input value={line.serialNo} onChange={(event) => changeLine(index, "serialNo", event.target.value)} placeholder="按序列号商品必填" /></label><label>明细备注<input value={line.remark} onChange={(event) => changeLine(index, "remark", event.target.value)} /></label><button type="button" className="icon-button danger-icon" onClick={() => removeLine(index)} title="移除商品" aria-label={`移除 ${item?.name ?? "商品"}`}><Trash2 size={16} /></button></div>;
      })}
    </div>
    {error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => void save(false)} disabled={saving}>保存草稿</button><button className="primary-button" disabled={saving}>{saving ? "正在提交..." : "提交审批"} <Check size={16} /></button></div>
  </form></SimpleModal>;
}

function downloadStockDocument(stockDocument: StockDocumentDetail) {
  const documentLabel = documentMeta[stockDocument.documentType].label;
  const rows = [
    [`${documentLabel}明细导出`],
    ["单据编号", stockDocument.documentNo],
    ["单据类型", documentLabel],
    ["单据状态", documentStatusLabel(stockDocument.status)],
    ["业务日期", stockDocument.businessDate],
    ["所属部门", stockDocument.departmentName],
    ["仓库", documentWarehouseLabel(stockDocument)],
    ["创建人", stockDocument.createdByName],
    ["供应商", stockDocument.supplierName],
    ["采购单号", stockDocument.purchaseOrderNo],
    ["来源单号", stockDocument.referenceNo],
    ["原因 / 用途", stockDocument.reason],
    ["备注", stockDocument.remark],
    [],
    ["行号", "商品编码", "商品名称", "数量", "单位", "批次号", "序列号", "明细备注"],
    ...stockDocument.lines.map((line) => [
      String(line.lineNo),
      line.itemCode,
      line.itemName,
      formatQuantity(line.quantity),
      line.unitName || "",
      line.lotNo,
      line.serialNo,
      line.remark
    ])
  ];
  const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = window.document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${stockDocument.documentNo}-${documentLabel}.csv`.replace(/[\\/:*?"<>|]/g, "-");
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function printStockDocument(stockDocument: StockDocumentDetail) {
  const printFrame = window.document.createElement("iframe");
  printFrame.className = "document-print-frame";
  printFrame.setAttribute("aria-hidden", "true");
  window.document.body.appendChild(printFrame);
  const frameDocument = printFrame.contentDocument;
  if (!frameDocument) {
    printFrame.remove();
    return;
  }
  frameDocument.open();
  frameDocument.write(buildDocumentPrintHtml(stockDocument));
  frameDocument.close();
  window.setTimeout(() => {
    const printWindow = printFrame.contentWindow;
    if (!printWindow) {
      printFrame.remove();
      return;
    }
    const cleanup = () => printFrame.remove();
    printWindow.addEventListener("afterprint", cleanup, { once: true });
    printWindow.focus();
    printWindow.print();
    window.setTimeout(cleanup, 60_000);
  }, 150);
}

function buildDocumentPrintHtml(stockDocument: StockDocumentDetail) {
  const documentLabel = documentMeta[stockDocument.documentType].label;
  const fields = [
    ["单据编号", stockDocument.documentNo],
    ["单据类型", documentLabel],
    ["单据状态", documentStatusLabel(stockDocument.status)],
    ["业务日期", stockDocument.businessDate],
    ["所属部门", stockDocument.departmentName],
    ["仓库", documentWarehouseLabel(stockDocument)],
    ["创建人", stockDocument.createdByName],
    ["创建时间", formatDateTime(stockDocument.createdAt)]
  ];
  const optionalFields = [
    ["供应商", stockDocument.supplierName],
    ["采购单号", stockDocument.purchaseOrderNo],
    ["来源单号", stockDocument.referenceNo],
    ["原因 / 用途", stockDocument.reason],
    ["备注", stockDocument.remark]
  ].filter(([, value]) => value);
  const detailRows = stockDocument.lines.map((line) => `<tr>
    <td>${line.lineNo}</td>
    <td><strong>${escapeHtml(line.itemName)}</strong><br /><span>${escapeHtml(line.itemCode)}</span></td>
    <td>${escapeHtml(formatQuantity(line.quantity))}</td>
    <td>${escapeHtml(line.unitName || "-")}</td>
    <td>${escapeHtml(line.lotNo || "-")}</td>
    <td>${escapeHtml(line.serialNo || "-")}</td>
    <td>${escapeHtml(line.remark || "-")}</td>
  </tr>`).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(stockDocument.documentNo)} - ${escapeHtml(documentLabel)}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #203247; background: #fff; font-family: "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif; font-size: 12px; }
    .sheet { width: 100%; }
    .heading { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 14px; border-bottom: 2px solid #2f6f9f; }
    .brand { color: #60788f; font-size: 11px; font-weight: 700; letter-spacing: .08em; }
    h1 { margin: 6px 0 0; color: #183c5d; font-size: 22px; letter-spacing: 0; }
    .doc-no { color: #315f85; font-family: Consolas, monospace; font-size: 13px; font-weight: 700; text-align: right; }
    .meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid #dbe5ed; border-left: 1px solid #dbe5ed; margin-top: 16px; }
    .meta div { min-height: 52px; padding: 8px 10px; border-right: 1px solid #dbe5ed; border-bottom: 1px solid #dbe5ed; }
    .meta span { display: block; color: #6d7f91; font-size: 10px; }
    .meta strong { display: block; margin-top: 5px; color: #203247; font-size: 12px; font-weight: 700; word-break: break-word; }
    .extra { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 22px; margin-top: 13px; padding: 11px 13px; background: #f7fafc; color: #526779; line-height: 1.5; }
    .extra div { min-width: 0; word-break: break-word; }
    h2 { margin: 20px 0 9px; color: #294f70; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 8px 7px; border: 1px solid #dbe5ed; vertical-align: top; text-align: left; word-break: break-word; }
    th { color: #40586d; background: #edf4f8; font-size: 10px; }
    td { color: #283d50; font-size: 11px; }
    td span { color: #71859a; font-family: Consolas, monospace; font-size: 9px; }
    th:nth-child(1), td:nth-child(1) { width: 6%; text-align: center; }
    th:nth-child(2), td:nth-child(2) { width: 25%; }
    th:nth-child(3), td:nth-child(3) { width: 10%; text-align: right; }
    th:nth-child(4), td:nth-child(4) { width: 8%; }
    th:nth-child(5), td:nth-child(5) { width: 13%; }
    th:nth-child(6), td:nth-child(6) { width: 15%; }
    th:nth-child(7), td:nth-child(7) { width: 23%; }
    .footer { display: flex; justify-content: space-between; margin-top: 22px; color: #72869a; font-size: 10px; }
    @media print { .sheet { break-inside: avoid; } }
  </style>
</head>
<body>
  <main class="sheet">
    <header class="heading">
      <div><div class="brand">内存条 ERP / MES</div><h1>${escapeHtml(documentLabel)}</h1></div>
      <div class="doc-no">${escapeHtml(stockDocument.documentNo)}</div>
    </header>
    <section class="meta">${fields.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</section>
    ${optionalFields.length ? `<section class="extra">${optionalFields.map(([label, value]) => `<div><strong>${escapeHtml(label)}：</strong>${escapeHtml(value)}</div>`).join("")}</section>` : ""}
    <h2>商品明细</h2>
    <table>
      <thead><tr><th>行号</th><th>商品</th><th>数量</th><th>单位</th><th>批次号</th><th>序列号</th><th>备注</th></tr></thead>
      <tbody>${detailRows}</tbody>
    </table>
    <footer class="footer"><span>打印时间：${escapeHtml(formatDateTime(new Date().toISOString()))}</span><span>本单据由系统自动生成</span></footer>
  </main>
</body>
</html>`;
}

function DocumentDetailModal({ document, onClose, onPrint, onDownload }: { document: StockDocumentDetail; onClose: () => void; onPrint: () => void; onDownload: () => void }) {
  return <SimpleModal title={`单据预览 · ${document.documentNo}`} onClose={onClose}><div className="document-detail"><div className="document-detail-toolbar"><div><span className="eyebrow">库存单据</span><strong>{documentMeta[document.documentType].label}</strong></div><div className="header-actions"><button className="secondary-button" onClick={onPrint}><Printer size={16} />打印</button><button className="secondary-button" onClick={onDownload}><Download size={16} />下载 CSV</button></div></div><div className="document-detail-meta"><span>类型：<strong>{documentMeta[document.documentType].label}</strong></span><span>状态：<DocumentStatusBadge status={document.status} /></span><span>部门：<strong>{document.departmentName}</strong></span><span>仓库：<strong>{documentWarehouseLabel(document)}</strong></span><span>日期：<strong>{document.businessDate}</strong></span><span>创建人：<strong>{document.createdByName}</strong></span></div>{document.supplierName && <p>供应商：{document.supplierName}</p>}{document.purchaseOrderNo && <p>采购单号：{document.purchaseOrderNo}</p>}{document.referenceNo && <p>来源单号：{document.referenceNo}</p>}{document.reason && <p>原因 / 用途：{document.reason}</p>}{document.remark && <p>备注：{document.remark}</p>}<div className="table-wrap"><table><thead><tr><th>商品</th><th>数量</th><th>单位</th><th>批次</th><th>序列号</th><th>备注</th></tr></thead><tbody>{document.lines.map((line) => <tr key={line.id}><td><strong>{line.itemName}</strong><small className="code-cell">{line.itemCode}</small></td><td>{formatQuantity(line.quantity)}</td><td>{line.unitName || "-"}</td><td>{line.lotNo || "-"}</td><td>{line.serialNo || "-"}</td><td>{line.remark || "-"}</td></tr>)}</tbody></table></div></div></SimpleModal>;
}

function EntityModal({ title, onClose, onSubmit, onSaved, children }: { title: string; onClose: () => void; onSubmit: () => Promise<void>; onSaved: () => void; children: React.ReactNode }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSubmit();
      onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };
  return <SimpleModal title={title} onClose={onClose}><form className="modal-form" onSubmit={submit}>{children}{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving}>{saving ? "保存中..." : "保存"} <Check size={16} /></button></div></form></SimpleModal>;
}

function SimpleModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="eyebrow">库存 ERP</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div>{children}</section></div>;
}

function StatusBadge({ status }: { status: "active" | "inactive" }) {
  return <span className={`status-badge ${status}`}>{status === "active" ? "启用" : "停用"}</span>;
}

function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return <span className={`document-status ${status}`}>{documentStatusLabel(status)}</span>;
}

function EmptyTable({ colSpan, title, description }: { colSpan: number; title: string; description: string }) {
  return <tr><td colSpan={colSpan}><div className="empty-state"><div className="empty-icon"><ShieldAlert size={18} /></div><strong>{title}</strong><span>{description}</span></div></td></tr>;
}

function documentWarehouseLabel(document: Pick<StockDocument, "documentType" | "warehouseName" | "sourceWarehouseName" | "targetWarehouseName">) {
  return document.documentType === "transfer" ? `${document.sourceWarehouseName || "-"} -> ${document.targetWarehouseName || "-"}` : document.warehouseName || "-";
}

function buildCategoryTree(categories: Category[]) {
  const nodes = new Map<number, CategoryTreeNode>(
    categories.map((category) => [category.id, { ...category, children: [] }])
  );
  const roots: CategoryTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (items: CategoryTreeNode[]) => {
    items.sort((left, right) => left.id - right.id);
    items.forEach((item) => sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}

function flattenCategoryTree(
  nodes: CategoryTreeNode[],
  expandedIds?: Set<number>,
  level = 0,
  visited = new Set<number>()
): CategoryTreeRow[] {
  const rows: CategoryTreeRow[] = [];
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    rows.push({ ...node, level });
    if (!expandedIds || expandedIds.has(node.id)) {
      rows.push(...flattenCategoryTree(node.children, expandedIds, level + 1, visited));
    }
  }
  return rows;
}

function categoryOptionLabel(category: CategoryTreeRow) {
  return `${"> ".repeat(category.level)}${category.name}`;
}

function buildCategoryPaths(categories: Category[]) {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const paths = new Map<number, string>();
  const resolve = (id: number, visiting = new Set<number>()): string => {
    const cached = paths.get(id);
    if (cached) return cached;
    const category = categoryById.get(id);
    if (!category) return "";
    if (visiting.has(id)) return category.name;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(id);
    const parentPath = category.parentId ? resolve(category.parentId, nextVisiting) : "";
    const path = parentPath ? `${parentPath} / ${category.name}` : category.name;
    paths.set(id, path);
    return path;
  };
  categories.forEach((category) => resolve(category.id));
  return paths;
}

function getDescendantCategoryIds(categories: Category[], rootId: number | undefined) {
  const ids = new Set<number>();
  if (!rootId) return ids;
  const pending = [rootId];
  while (pending.length) {
    const parentId = pending.pop();
    if (!parentId || ids.has(parentId)) continue;
    ids.add(parentId);
    categories.forEach((category) => {
      if (category.parentId === parentId && !ids.has(category.id)) pending.push(category.id);
    });
  }
  return ids;
}

function trackingLabel(mode: Item["trackingMode"]) {
  return mode === "lot" ? "按批次" : mode === "serial" ? "按序列号" : "仅数量";
}

function valueTypeLabel(type: AttributeDefinition["valueType"]) {
  return type === "number" ? "数字" : type === "select" ? "下拉选项" : "文本";
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value);
}

function formatPrice(value: number | null | undefined) {
  return value && value > 0
    ? new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
    : "未设置";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function documentStatusLabel(status: DocumentStatus) {
  const labels: Record<DocumentStatus, string> = { draft: "草稿", submitted: "待审批", approved: "待过账", posted: "已过账", cancelled: "已取消" };
  return labels[status];
}

function csvCell(value: string | number | undefined | null) {
  const content = String(value ?? "");
  const safeContent = /^[=+\-@]/.test(content) ? `'${content}` : content;
  return `"${safeContent.replace(/"/g, "\"\"")}"`;
}

function escapeHtml(value: string | number | undefined | null) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}
