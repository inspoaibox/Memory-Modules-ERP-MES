import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  Eye,
  FilePlus2,
  Package,
  Pencil,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  X
} from "lucide-react";
import { User, request } from "./api";

type SalesStatus = "draft" | "submitted" | "approved" | "partial_shipped" | "completed" | "cancelled";
type SalesOutputAction = "preview" | "print" | "download";

type Item = {
  id: number;
  itemCode: string;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  unitName: string | null;
  salesPrice: number;
  barcode: string | null;
  trackingMode: "none" | "lot" | "serial";
  status: "active" | "inactive";
};

type WarehouseType = "raw_material" | "semi_finished" | "finished_goods" | "quarantine" | "scrap" | "general";

type Warehouse = {
  id: number;
  code: string;
  name: string;
  warehouseType: WarehouseType;
  departmentName: string;
  status: "active" | "inactive";
};

type SalesUserOption = {
  id: number;
  displayName: string;
  employeeNo: string;
};

type SalesOrderRow = {
  id: number;
  salesOrderNo: string;
  status: SalesStatus;
  businessDate: string;
  customerName: string;
  customerContact: string;
  customerPhone: string;
  totalQuantity: number;
  totalAmount: number;
  totalShippedQuantity: number;
  createdBy: number;
  createdByName: string;
  salesUserName: string | null;
  createdAt: string;
  lineCount: number;
};

type SalesOrderDetail = Omit<SalesOrderRow, "customerContact" | "customerPhone" | "lineCount"> & {
  customerContact: string;
  customerPhone: string;
  customerAddress: string;
  salesUserId: number | null;
  salesUserName: string | null;
  remark: string;
  submittedBy: number | null;
  approvedBy: number | null;
  submittedAt: string | null;
  approvedAt: string | null;
  updatedAt: string;
  lines: SalesOrderLine[];
  issueDocuments: Array<{
    id: number;
    documentNo: string;
    status: string;
    warehouseId: number | null;
    warehouseName: string | null;
  }>;
};

type SalesOrderLine = {
  id: number;
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  unitName: string | null;
  trackingMode: Item["trackingMode"];
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

type SalesLineForm = {
  key: string;
  itemId: string;
  warehouseId: string;
  quantity: string;
  unitPrice: string;
  lotNo: string;
  serialNo: string;
  remark: string;
};

const statusLabels: Record<SalesStatus, string> = {
  draft: "草稿",
  submitted: "待审批",
  approved: "待发货",
  partial_shipped: "部分发货",
  completed: "已完成",
  cancelled: "已取消"
};

const warehouseTypeLabels: Record<WarehouseType, string> = {
  raw_material: "原料仓",
  semi_finished: "半成品仓",
  finished_goods: "成品仓",
  quarantine: "待检/隔离仓",
  scrap: "不良/报废仓",
  general: "综合仓"
};

const today = () => new Date().toISOString().slice(0, 10);
const hasPermission = (user: User, code: string) => user.permissions.some((permission) => permission.code === code);

export function SalesOrdersPage({ currentUser }: { currentUser: User }) {
  const [items, setItems] = useState<SalesOrderRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SalesStatus>("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SalesOrderDetail | null>(null);
  const [detail, setDetail] = useState<SalesOrderDetail | null>(null);
  const [error, setError] = useState("");
  const canManage = hasPermission(currentUser, "sales.orders.manage");
  const canApprove = hasPermission(currentUser, "sales.orders.approve");

  const load = () => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (keyword.trim()) params.set("keyword", keyword.trim());
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<{ items: SalesOrderRow[] }>(`/sales/orders${suffix}`)
      .then((result) => {
        setItems(result.items);
        setError("");
      })
      .catch((loadError) => setError(errorMessage(loadError)));
  };

  useEffect(() => { void load(); }, [statusFilter]);

  const openDetail = async (id: number) => {
    const result = await request<{ order: SalesOrderDetail }>(`/sales/orders/${id}`);
    setDetail(result.order);
    void recordOutput(id, "preview");
  };

  const openEdit = async (id: number) => {
    const result = await request<{ order: SalesOrderDetail }>(`/sales/orders/${id}`);
    setEditing(result.order);
    setShowForm(true);
  };

  const runAction = async (order: SalesOrderRow, action: "submit" | "approve" | "cancel") => {
    await request(`/sales/orders/${order.id}/${action}`, { method: "POST" });
    await load();
  };

  const recordOutput = async (id: number, action: SalesOutputAction) => {
    try {
      await request(`/sales/orders/${id}/output-actions`, {
        method: "POST",
        body: JSON.stringify({ action })
      });
    } catch (auditError) {
      console.error("销售单输出操作审计记录失败", auditError);
    }
  };

  const printOrderById = async (id: number) => {
    const result = await request<{ order: SalesOrderDetail }>(`/sales/orders/${id}`);
    printSalesOrder(result.order);
    void recordOutput(id, "print");
  };

  const downloadOrderById = async (id: number) => {
    const result = await request<{ order: SalesOrderDetail }>(`/sales/orders/${id}`);
    downloadSalesOrder(result.order);
    void recordOutput(id, "download");
  };

  return (
    <div className="inventory-page sales-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">销售管理</span>
          <h1>销售跟单</h1>
          <p>建立销售单并跟踪审批、出库草稿、仓库过账和发货完成进度。</p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div><span className="eyebrow">销售单据</span><h2>销售单列表</h2><p>销售单用于跟踪客户、商品、金额和发货进度；库存扣减仍以销售出库单过账为准。</p></div>
          <div className="header-actions">
            <button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} />刷新</button>
            {canManage && <button className="primary-button" onClick={() => { setEditing(null); setShowForm(true); }}><FilePlus2 size={16} />新建销售单</button>}
          </div>
        </div>
        <div className="inventory-filters product-filters">
          <label>销售单状态<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | SalesStatus)}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="sales-keyword-filter">搜索销售单<input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="单号、销售方或电话" /></label>
          <button className="secondary-button" onClick={() => void load()}><Search size={16} />查询</button>
        </div>
        {error && <div className="form-error page-error">{error}</div>}
        <div className="table-wrap"><table className="sales-orders-table"><thead><tr><th>销售单号</th><th>销售方</th><th>业务日期</th><th>商品明细</th><th>数量</th><th>金额</th><th>发货进度</th><th>状态</th><th>负责人</th><th className="action-cell document-output-cell">单据输出</th><th className="action-cell sales-workflow-cell">流程操作</th></tr></thead><tbody>
          {items.map((order) => <tr key={order.id}><td><button className="link-button" onClick={() => void openDetail(order.id)}>{order.salesOrderNo}</button></td><td><strong>{order.customerName}</strong><small>{[order.customerContact, order.customerPhone].filter(Boolean).join(" / ") || "-"}</small></td><td>{order.businessDate}</td><td>{order.lineCount} 行</td><td className="quantity-cell">{formatQuantity(order.totalQuantity)}</td><td className="price-cell">{formatMoney(order.totalAmount)}</td><td><strong>{formatQuantity(order.totalShippedQuantity)} / {formatQuantity(order.totalQuantity)}</strong><small>未发 {formatQuantity(Math.max(order.totalQuantity - order.totalShippedQuantity, 0))}</small></td><td><SalesStatusBadge status={order.status} /></td><td><strong>{order.salesUserName || order.createdByName}</strong><small>制单：{order.createdByName}</small></td><td className="action-cell document-output-cell"><OutputActions onPreview={() => void openDetail(order.id)} onPrint={() => void printOrderById(order.id)} onDownload={() => void downloadOrderById(order.id)} /></td><td className="action-cell sales-workflow-cell"><SalesWorkflowActions order={order} canManage={canManage} canApprove={canApprove} onEdit={openEdit} onAction={runAction} /></td></tr>)}
          {!items.length && <EmptyTable colSpan={11} title="暂无销售单" description="新建销售单后，可在这里跟踪审批、出库和发货完成情况。" />}
        </tbody></table></div>
      </section>
      {showForm && <SalesOrderForm order={editing} onClose={() => { setShowForm(false); setEditing(null); }} onSaved={() => { setShowForm(false); setEditing(null); void load(); }} />}
      {detail && <SalesDetailModal order={detail} onClose={() => setDetail(null)} onPrint={() => { printSalesOrder(detail); void recordOutput(detail.id, "print"); }} onDownload={() => { downloadSalesOrder(detail); void recordOutput(detail.id, "download"); }} />}
    </div>
  );
}

function SalesWorkflowActions({
  order,
  canManage,
  canApprove,
  onEdit,
  onAction
}: {
  order: SalesOrderRow;
  canManage: boolean;
  canApprove: boolean;
  onEdit: (id: number) => Promise<void>;
  onAction: (order: SalesOrderRow, action: "submit" | "approve" | "cancel") => Promise<void>;
}) {
  return <div className="document-workflow-actions sales-workflow-actions">{order.status === "draft" && canManage && <button className="table-action" onClick={() => void onEdit(order.id)}><Pencil size={13} />编辑</button>}{order.status === "draft" && canManage && <button className="table-action" onClick={() => void onAction(order, "submit")}>提交</button>}{order.status === "submitted" && canApprove && <button className="table-action" onClick={() => void onAction(order, "approve")}>审批</button>}{["draft", "submitted"].includes(order.status) && canManage && <button className="table-action danger-action" onClick={() => void onAction(order, "cancel")}>取消</button>}</div>;
}

function OutputActions({ onPreview, onPrint, onDownload }: { onPreview: () => void; onPrint: () => void; onDownload: () => void }) {
  return <div className="document-output-actions"><button className="table-icon-action" onClick={onPreview} title="预览销售单" aria-label="预览销售单"><Eye size={16} /></button><button className="table-icon-action" onClick={onPrint} title="打印销售单" aria-label="打印销售单"><Printer size={16} /></button><button className="table-icon-action" onClick={onDownload} title="下载销售单 CSV" aria-label="下载销售单 CSV"><Download size={16} /></button></div>;
}

function SalesOrderForm({ order, onClose, onSaved }: { order: SalesOrderDetail | null; onClose: () => void; onSaved: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [users, setUsers] = useState<SalesUserOption[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [itemCategoryId, setItemCategoryId] = useState("all");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    businessDate: order?.businessDate ?? today(),
    customerName: order?.customerName ?? "",
    customerContact: order?.customerContact ?? "",
    customerPhone: order?.customerPhone ?? "",
    customerAddress: order?.customerAddress ?? "",
    salesUserId: order?.salesUserId?.toString() ?? "",
    remark: order?.remark ?? "",
    lines: (order?.lines ?? []).map((line) => ({
      key: `line-${line.id}`,
      itemId: String(line.itemId),
      warehouseId: String(line.warehouseId),
      quantity: String(line.quantity),
      unitPrice: String(line.unitPrice),
      lotNo: line.lotNo,
      serialNo: line.serialNo,
      remark: line.remark
    })) as SalesLineForm[]
  });

  useEffect(() => {
    void Promise.all([
      request<{ items: Item[] }>("/inventory/items"),
      request<{ items: Warehouse[] }>("/inventory/warehouses"),
      request<{ users: SalesUserOption[] }>("/sales/options")
    ]).then(([itemResult, warehouseResult, optionResult]) => {
      setItems(itemResult.items.filter((item) => item.status === "active"));
      setWarehouses(warehouseResult.items.filter((warehouse) => warehouse.status === "active"));
      setUsers(optionResult.users);
    }).catch((loadError) => setError(errorMessage(loadError)));
  }, []);

  const itemCategories = useMemo(
    () => Array.from(
      new Map(
        items
          .filter((item) => item.categoryId && item.categoryName)
          .map((item) => [item.categoryId, { id: item.categoryId as number, name: item.categoryName as string }])
      ).values()
    ).sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    [items]
  );
  const filteredItems = items.filter((item) => {
    const keyword = itemSearch.trim().toLowerCase();
    const matchesSearch = !keyword || `${item.itemCode}${item.name}${item.barcode ?? ""}${item.categoryName ?? ""}`.toLowerCase().includes(keyword);
    const matchesCategory = itemCategoryId === "all" || item.categoryId?.toString() === itemCategoryId;
    return matchesSearch && matchesCategory;
  });
  const totalQuantity = form.lines.reduce((sum, line) => sum + toNumber(line.quantity), 0);
  const totalAmount = form.lines.reduce((sum, line) => sum + toNumber(line.quantity) * toNumber(line.unitPrice), 0);

  const addLine = (item: Item) => {
    setForm((current) => ({
      ...current,
      lines: [
        ...current.lines,
        {
          key: `${item.id}-${Date.now()}-${current.lines.length}`,
          itemId: String(item.id),
          warehouseId: "",
          quantity: "",
          unitPrice: item.salesPrice > 0 ? String(item.salesPrice) : "0",
          lotNo: "",
          serialNo: "",
          remark: ""
        }
      ]
    }));
    setError("");
  };

  const changeLine = (index: number, field: keyof SalesLineForm, value: string) => {
    setForm((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line) }));
  };
  const removeLine = (index: number) => setForm((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }));

  const save = async (submit: boolean) => {
    setError("");
    if (!form.customerName.trim()) {
      setError("销售方名称不能为空");
      return;
    }
    if (!form.lines.length) {
      setError("请先选择至少一个销售商品");
      return;
    }
    const invalidLineIndex = form.lines.findIndex((line) => !line.warehouseId || toNumber(line.quantity) <= 0 || toNumber(line.unitPrice) < 0);
    if (invalidLineIndex >= 0) {
      setError(`第 ${invalidLineIndex + 1} 行需要选择仓库，数量必须大于 0，单价不能小于 0`);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        salesUserId: form.salesUserId ? Number(form.salesUserId) : null,
        lines: form.lines.map((line) => ({
          itemId: Number(line.itemId),
          warehouseId: Number(line.warehouseId),
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice || 0),
          lotNo: line.lotNo,
          serialNo: line.serialNo,
          remark: line.remark
        }))
      };
      const saved = await request<{ order: SalesOrderDetail }>(order ? `/sales/orders/${order.id}` : "/sales/orders", {
        method: order ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      if (submit) await request(`/sales/orders/${saved.order.id}/submit`, { method: "POST" });
      onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return <SalesModal title={order ? `编辑销售单 · ${order.salesOrderNo}` : "新建销售单"} onClose={onClose}><form className="modal-form sales-order-form" onSubmit={(event) => { event.preventDefault(); void save(true); }}>
    <div className="form-grid"><label>业务日期<input type="date" value={form.businessDate} onChange={(event) => setForm({ ...form, businessDate: event.target.value })} /></label><label>销售负责人<select value={form.salesUserId} onChange={(event) => setForm({ ...form, salesUserId: event.target.value })}><option value="">不指定</option>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName} · {user.employeeNo}</option>)}</select></label><label>销售方名称<input autoFocus value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} /></label><label>联系人<input value={form.customerContact} onChange={(event) => setForm({ ...form, customerContact: event.target.value })} placeholder="可选" /></label><label>联系电话<input value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} placeholder="可选" /></label><label>销售方地址<input value={form.customerAddress} onChange={(event) => setForm({ ...form, customerAddress: event.target.value })} placeholder="可选" /></label><label className="full-span">备注<textarea rows={2} value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} /></label></div>
    <div className="document-item-picker">
      <div className="document-lines-heading"><div><span className="eyebrow">选择商品</span><strong>搜索商品后加入销售明细，再逐行选择发货仓库</strong></div><span className="document-item-count">匹配 {filteredItems.length} 个</span></div>
      <div className="document-item-filters"><label>搜索商品<input value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="编码、名称或条码" /></label><label>商品分类<select value={itemCategoryId} onChange={(event) => setItemCategoryId(event.target.value)}><option value="all">全部分类</option>{itemCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div>
      <div className="document-item-results">
        {!items.length ? <div className="document-item-empty"><Package size={18} /><strong>暂无商品</strong><span>请先在商品资料中维护启用商品。</span></div> : !filteredItems.length ? <div className="document-item-empty"><Search size={18} /><strong>没有匹配商品</strong><span>调整搜索条件或商品分类后重试。</span></div> : filteredItems.map((item) => <button type="button" key={item.id} className="document-item-option" onClick={() => addLine(item)}><span><strong>{item.name}</strong><small>{item.itemCode}{item.categoryName ? ` · ${item.categoryName}` : ""}{item.unitName ? ` · ${item.unitName}` : ""}</small></span><b>加入明细</b></button>)}
      </div>
    </div>
    <div className="entry-table-section sales-lines-section">
      <div className="document-lines-heading"><div><span className="eyebrow">销售明细</span><strong>{form.lines.length ? `已加入 ${form.lines.length} 行商品` : "尚未选择商品"}</strong></div><span className="entry-table-hint">合计数量 {formatQuantity(totalQuantity)} · 合计金额 {formatMoney(totalAmount)}</span></div>
      <div className="entry-table-wrap"><table className="entry-table sales-line-entry-table"><thead><tr><th>#</th><th>商品</th><th>发货仓库</th><th>数量</th><th>销售单价</th><th>金额</th><th>批次号</th><th>序列号</th><th>备注</th><th>操作</th></tr></thead><tbody>
        {form.lines.map((line, index) => {
          const item = items.find((candidate) => candidate.id.toString() === line.itemId);
          return <tr key={line.key}><td className="entry-index-cell">{index + 1}</td><td><strong>{item?.name ?? "商品不可用"}</strong><small className="code-cell">{item?.itemCode ?? line.itemId}{item?.unitName ? ` · ${item.unitName}` : ""}</small></td><td><select value={line.warehouseId} onChange={(event) => changeLine(index, "warehouseId", event.target.value)}><option value="">选择仓库</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouseTypeLabels[warehouse.warehouseType]}</option>)}</select></td><td className="entry-number-cell"><input type="number" min="0" step="any" value={line.quantity} onChange={(event) => changeLine(index, "quantity", event.target.value)} /></td><td className="entry-number-cell"><input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => changeLine(index, "unitPrice", event.target.value)} /></td><td className="price-cell">{formatMoney(toNumber(line.quantity) * toNumber(line.unitPrice))}</td><td><input value={line.lotNo} onChange={(event) => changeLine(index, "lotNo", event.target.value)} placeholder="按批次必填" /></td><td><input value={line.serialNo} onChange={(event) => changeLine(index, "serialNo", event.target.value)} placeholder="按序列号必填" /></td><td><input value={line.remark} onChange={(event) => changeLine(index, "remark", event.target.value)} /></td><td><button type="button" className="icon-button danger-icon" onClick={() => removeLine(index)} title="移除明细" aria-label="移除明细"><Trash2 size={16} /></button></td></tr>;
        })}
        {!form.lines.length && <EmptyTable colSpan={10} title="暂无销售明细" description="从上方商品列表加入商品后，在表格里填写仓库、数量和价格。" />}
      </tbody></table></div>
    </div>
    {error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => void save(false)} disabled={saving}>保存草稿</button><button className="primary-button" disabled={saving}>{saving ? "正在提交..." : "提交审批"} <Check size={16} /></button></div>
  </form></SalesModal>;
}

function SalesDetailModal({ order, onClose, onPrint, onDownload }: { order: SalesOrderDetail; onClose: () => void; onPrint: () => void; onDownload: () => void }) {
  return <SalesModal title={`销售单预览 · ${order.salesOrderNo}`} onClose={onClose}><div className="document-detail sales-detail"><div className="document-detail-toolbar"><div><span className="eyebrow">销售跟单</span><strong>{order.customerName}</strong></div><div className="header-actions"><button className="secondary-button" onClick={onPrint}><Printer size={16} />打印</button><button className="secondary-button" onClick={onDownload}><Download size={16} />下载 CSV</button></div></div><div className="document-detail-meta"><span>状态：<SalesStatusBadge status={order.status} /></span><span>业务日期：<strong>{order.businessDate}</strong></span><span>销售负责人：<strong>{order.salesUserName || "-"}</strong></span><span>联系人：<strong>{order.customerContact || "-"}</strong></span><span>联系电话：<strong>{order.customerPhone || "-"}</strong></span><span>制单人：<strong>{order.createdByName}</strong></span><span>合计数量：<strong>{formatQuantity(order.totalQuantity)}</strong></span><span>已发货：<strong>{formatQuantity(order.totalShippedQuantity)}</strong></span><span>合计金额：<strong>{formatMoney(order.totalAmount)}</strong></span></div>{order.customerAddress && <p>销售方地址：{order.customerAddress}</p>}{order.remark && <p>备注：{order.remark}</p>}<div className="table-wrap"><table className="sales-detail-table"><thead><tr><th>商品</th><th>仓库</th><th>数量</th><th>已发货</th><th>未发</th><th>单价</th><th>金额</th><th>批次</th><th>序列号</th><th>备注</th></tr></thead><tbody>{order.lines.map((line) => <tr key={line.id}><td><strong>{line.itemName}</strong><small className="code-cell">{line.itemCode}</small></td><td>{line.warehouseName}</td><td className="quantity-cell">{formatQuantity(line.quantity)}</td><td className="quantity-positive">{formatQuantity(line.shippedQuantity)}</td><td className="quantity-negative">{formatQuantity(Math.max(line.quantity - line.shippedQuantity, 0))}</td><td className="price-cell">{formatMoney(line.unitPrice)}</td><td className="price-cell">{formatMoney(line.amount)}</td><td>{line.lotNo || "-"}</td><td>{line.serialNo || "-"}</td><td>{line.remark || "-"}</td></tr>)}</tbody></table></div>{order.issueDocuments.length > 0 && <div className="sales-linked-docs"><span className="eyebrow">关联销售出库单</span><div>{order.issueDocuments.map((document) => <span className="tag" key={document.id}>{document.documentNo} · {document.warehouseName || "-"} · {inventoryStatusLabel(document.status)}</span>)}</div></div>}</div></SalesModal>;
}

function SalesModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="eyebrow">销售管理</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div>{children}</section></div>;
}

function SalesStatusBadge({ status }: { status: SalesStatus }) {
  return <span className={`sales-status ${status}`}>{statusLabels[status]}</span>;
}

function EmptyTable({ colSpan, title, description }: { colSpan: number; title: string; description: string }) {
  return <tr><td colSpan={colSpan}><div className="empty-state"><div className="empty-icon"><ShieldAlert size={18} /></div><strong>{title}</strong><span>{description}</span></div></td></tr>;
}

function downloadSalesOrder(order: SalesOrderDetail) {
  const rows = [
    ["销售单明细导出"],
    ["销售单号", order.salesOrderNo],
    ["状态", statusLabels[order.status]],
    ["业务日期", order.businessDate],
    ["销售方", order.customerName],
    ["联系人", order.customerContact],
    ["联系电话", order.customerPhone],
    ["销售方地址", order.customerAddress],
    ["销售负责人", order.salesUserName || ""],
    ["合计数量", formatQuantity(order.totalQuantity)],
    ["合计金额", formatMoney(order.totalAmount)],
    ["备注", order.remark],
    [],
    ["行号", "商品编码", "商品名称", "仓库", "数量", "已发货", "未发货", "单位", "单价", "金额", "批次号", "序列号", "备注"],
    ...order.lines.map((line) => [
      String(line.lineNo),
      line.itemCode,
      line.itemName,
      line.warehouseName,
      formatQuantity(line.quantity),
      formatQuantity(line.shippedQuantity),
      formatQuantity(Math.max(line.quantity - line.shippedQuantity, 0)),
      line.unitName || "",
      formatMoney(line.unitPrice),
      formatMoney(line.amount),
      line.lotNo,
      line.serialNo,
      line.remark
    ])
  ];
  const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = window.document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${order.salesOrderNo}-销售单.csv`.replace(/[\\/:*?"<>|]/g, "-");
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function printSalesOrder(order: SalesOrderDetail) {
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
  frameDocument.write(buildSalesPrintHtml(order));
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

function buildSalesPrintHtml(order: SalesOrderDetail) {
  const fields = [
    ["销售单号", order.salesOrderNo],
    ["状态", statusLabels[order.status]],
    ["业务日期", order.businessDate],
    ["销售方", order.customerName],
    ["销售负责人", order.salesUserName || "-"],
    ["联系人", order.customerContact || "-"],
    ["联系电话", order.customerPhone || "-"],
    ["制单人", order.createdByName]
  ];
  const optionalFields = [
    ["销售方地址", order.customerAddress],
    ["备注", order.remark]
  ].filter(([, value]) => value);
  const detailRows = order.lines.map((line) => `<tr>
    <td>${line.lineNo}</td>
    <td><strong>${escapeHtml(line.itemName)}</strong><br /><span>${escapeHtml(line.itemCode)}</span></td>
    <td>${escapeHtml(line.warehouseName)}</td>
    <td>${escapeHtml(formatQuantity(line.quantity))}</td>
    <td>${escapeHtml(formatQuantity(line.shippedQuantity))}</td>
    <td>${escapeHtml(line.unitName || "-")}</td>
    <td>${escapeHtml(formatMoney(line.unitPrice))}</td>
    <td>${escapeHtml(formatMoney(line.amount))}</td>
    <td>${escapeHtml(line.lotNo || "-")}</td>
    <td>${escapeHtml(line.serialNo || "-")}</td>
    <td>${escapeHtml(line.remark || "-")}</td>
  </tr>`).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(order.salesOrderNo)} - 销售单</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #203247; background: #fff; font-family: "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif; font-size: 12px; }
    .heading { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 14px; border-bottom: 2px solid #2f6f9f; }
    .brand { color: #60788f; font-size: 11px; font-weight: 700; letter-spacing: .08em; }
    h1 { margin: 6px 0 0; color: #183c5d; font-size: 22px; letter-spacing: 0; }
    .doc-no { color: #315f85; font-family: Consolas, monospace; font-size: 13px; font-weight: 700; text-align: right; }
    .meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid #dbe5ed; border-left: 1px solid #dbe5ed; margin-top: 16px; }
    .meta div { min-height: 50px; padding: 8px 10px; border-right: 1px solid #dbe5ed; border-bottom: 1px solid #dbe5ed; }
    .meta span { display: block; color: #6d7f91; font-size: 10px; }
    .meta strong { display: block; margin-top: 5px; color: #203247; font-size: 12px; font-weight: 700; word-break: break-word; }
    .extra { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 22px; margin-top: 13px; padding: 11px 13px; background: #f7fafc; color: #526779; line-height: 1.5; }
    h2 { margin: 18px 0 9px; color: #294f70; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 7px 6px; border: 1px solid #dbe5ed; vertical-align: top; text-align: left; word-break: break-word; }
    th { color: #40586d; background: #edf4f8; font-size: 10px; }
    td { color: #283d50; font-size: 11px; }
    td span { color: #71859a; font-family: Consolas, monospace; font-size: 9px; }
    th:nth-child(1), td:nth-child(1) { width: 5%; text-align: center; }
    th:nth-child(2), td:nth-child(2) { width: 19%; }
    th:nth-child(3), td:nth-child(3) { width: 13%; }
    th:nth-child(4), td:nth-child(4), th:nth-child(5), td:nth-child(5), th:nth-child(6), td:nth-child(6), th:nth-child(7), td:nth-child(7), th:nth-child(8), td:nth-child(8) { width: 8%; text-align: right; }
    th:nth-child(9), td:nth-child(9), th:nth-child(10), td:nth-child(10) { width: 10%; }
    th:nth-child(11), td:nth-child(11) { width: 13%; }
    .footer { display: flex; justify-content: space-between; margin-top: 18px; color: #72869a; font-size: 10px; }
  </style>
</head>
<body>
  <main>
    <header class="heading">
      <div><div class="brand">内存条 ERP / MES</div><h1>销售单</h1></div>
      <div class="doc-no">${escapeHtml(order.salesOrderNo)}</div>
    </header>
    <section class="meta">${fields.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</section>
    ${optionalFields.length ? `<section class="extra">${optionalFields.map(([label, value]) => `<div><strong>${escapeHtml(label)}：</strong>${escapeHtml(value)}</div>`).join("")}</section>` : ""}
    <h2>销售明细</h2>
    <table>
      <thead><tr><th>行号</th><th>商品</th><th>仓库</th><th>数量</th><th>已发货</th><th>单位</th><th>单价</th><th>金额</th><th>批次</th><th>序列号</th><th>备注</th></tr></thead>
      <tbody>${detailRows}</tbody>
    </table>
    <footer class="footer"><span>打印时间：${escapeHtml(formatDateTime(new Date().toISOString()))}</span><span>本单据由系统自动生成</span></footer>
  </main>
</body>
</html>`;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value || 0);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function inventoryStatusLabel(status: string) {
  const labels: Record<string, string> = { draft: "草稿", submitted: "待审批", approved: "待过账", posted: "已过账", cancelled: "已取消" };
  return labels[status] ?? status;
}

function toNumber(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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
