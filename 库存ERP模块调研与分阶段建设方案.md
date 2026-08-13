# 库存 ERP 模块调研与分阶段建设方案

## 1. 文档目的

本文件用于将成熟库存 ERP 的通用能力，与本项目已确定的内存条生产、质量、仓储和权限底座结合，明确库存 ERP 的页面、数据、单据、权限和实施边界。

本阶段只定义方案，不直接开发库存业务页面和库存变动逻辑。

## 1.1 已确认业务规则

| 事项 | 已确认规则 | 系统实现要求 |
| --- | --- | --- |
| 系统起点 | 全新系统，无历史数据迁移 | 不建设历史库存导入和期初数据转换流程；所有库存均先建立商品，再通过正常入库单手工入库建立。 |
| 负库存 | 默认不允许 | 所有出库、调拨出库、报废和调整减少库存时，系统必须校验可用库存；不足时禁止提交或过账。 |
| 最高权限 | 系统总管理员 | 可维护全局主数据、账号、角色、权限、跨部门数据范围和全局审批规则。 |
| 部门管理 | 部门经理可管理多个部门 | 通过“经理 - 部门”授权关系维护管理范围；部门经理在每个获授权部门范围内拥有最高业务权限，但不具备全局系统管理权限。 |
| 普通员工 | 按岗位授予普通操作权限 | 只能操作已授权的功能、仓库/库位、单据状态和本部门数据范围。 |

## 2. 调研结论

成熟库存 ERP 的核心不是“当前库存数量”，而是以下五层能力：

1. 商品主数据：分类、编码、单位、规格、条码、启停状态和追溯方式。
2. 仓储主数据：仓库、库区、库位、用途和允许的作业动作。
3. 库存单据：入库、出库、调拨、盘点、调整、报废和退货。
4. 库存台账：每次已过账单据都产生不可直接修改的库存流水。
5. 追溯与控制：批次、序列号、质量状态、审批、权限范围和审计记录。

通用 ERP 通常将仓库与库位分开管理；产品可以按数量、批次或唯一序列号追溯；盘点差异、补货和内部调拨均通过业务单据完成，不应由用户直接改写库存余额。

## 3. 与本项目既有方案的对齐

已确认的生产主线为：

```text
芯片拆卸植球
  -> 芯片测试
  -> 委外加工
  -> 芯片复测
  -> SMT 贴片
  -> 成品测试与老化
  -> 不良品维修与复测
  -> 目检放行
  -> 成品入库
```

因此库存模块必须支持以下受控存放位置，而不能只维护一个“可用库存”数字：

- 原料待检区
- 原料合格区
- 半成品合格区
- 委外在途或委外仓
- 待检或待判区
- 维修区
- 报废隔离区
- 成品合格仓

库存状态建议由“仓库 + 库位用途”决定。物料同一时刻只能位于一个受控库位，避免同时显示为合格、待检和可领用。

## 4. 库存 ERP 页面地图

### 4.1 第一批：库存主数据与查询

| 页面 | 核心功能 | 本阶段优先级 |
| --- | --- | --- |
| 库存工作台 | 库存总览、待处理单据、低库存、冻结库存、盘点任务 | 高 |
| 商品分类 | 分类树、分类编码、启停、默认追溯方式 | 高 |
| 商品资料 | 商品编码、名称、分类、库存单位、条码、规格、启停、追溯方式 | 高 |
| 单位管理 | 基本单位及换算关系 | 高 |
| 仓库管理 | 仓库编码、名称、负责人、启停 | 高 |
| 库位管理 | 隶属仓库、父级库位、用途、是否允许收货/发货/盘点 | 高 |
| 库存余额 | 按商品、仓库、库位、批次、状态查询现存量、可用量、冻结量 | 高 |
| 库存台账 | 每一笔库存增减与来源单据的流水查询 | 高 |

### 4.2 第二批：库存作业单据

| 页面 | 核心功能 | 前置条件 |
| --- | --- | --- |
| 入库单 | 采购收货、生产完工、退料、委外回料等入库 | 商品、仓库、库位 |
| 出库单 | 生产领料、销售发货、委外发料、报废出库等出库 | 商品、仓库、库位 |
| 调拨单 | 仓库间、库位间、状态间的受控移动 | 商品、仓库、库位 |
| 盘点单 | 创建盘点任务、录入实盘数、形成差异 | 库存余额 |
| 调整单 | 有原因、有审批的正负调整 | 库存台账、审批规则 |
| 报废单 | 物料或成品报废申请、审批、过账 | 隔离/报废库位 |
| 退货单 | 采购退货、生产退料、销售退货 | 对应入出库单 |

### 4.3 第三批：追溯与库存计划

| 页面 | 核心功能 |
| --- | --- |
| 批次档案 | 芯片及关键物料批次的来源、数量、所在库位、流转历史 |
| 序列号档案 | 成品内存条唯一序列号的生产、测试、维修、入出库履历 |
| 库存预留 | 工单、销售订单或委外单对库存的占用与释放 |
| 补货建议 | 安全库存、最低库存、采购提前期、生产提前期 |
| 库存账龄 | 批次或库位维度的库存滞留时长 |
| 异常报表 | 负库存、超储、临期、冻结、超期委外和盘点差异 |

## 5. 推荐的第一开发切片

不要一次实现全部库存单据。建议下一步只完成“商品和仓储主数据 + 库存查询骨架”：

1. 商品分类。
2. 单位管理。
3. 商品资料。
4. 仓库管理。
5. 库位管理。
6. 库存余额页面。
7. 库存台账页面。
8. 库存 ERP 权限与菜单。

这一切片不允许人工编辑库存余额，也不先实现采购、销售、财务、工单扣料或设备采集。它的目标是把后续所有库存动作依赖的编码、库位、权限和查询界面先建立好。

## 6. 数据模型建议

### 6.1 主数据

```text
item_categories
  id, parent_id, code, name, status, created_at, updated_at

units
  id, code, name, precision, status

items
  id, item_code, name, category_id, inventory_unit_id,
  barcode, tracking_mode, status, description, created_at, updated_at

item_attribute_definitions
  id, code, name, data_type, applies_to_category_id, status

item_attribute_values
  item_id, attribute_definition_id, value

warehouses
  id, code, name, manager_user_id, status, description

warehouse_locations
  id, warehouse_id, parent_id, code, name, location_type,
  allow_receipt, allow_issue, allow_count, status
```

`tracking_mode` 仅建议预留为 `none`、`lot`、`serial` 三种值。是否由具体物料启用批次或序列号，必须依据业务确认，不应批量猜测。

### 6.2 后续库存单据与台账

```text
stock_documents
  id, document_no, document_type, status, business_date,
  source_warehouse_id, source_location_id,
  target_warehouse_id, target_location_id,
  reason_code, remark, created_by, submitted_by, approved_by

stock_document_lines
  id, document_id, line_no, item_id, unit_id,
  quantity, lot_no, serial_no, source_location_id, target_location_id, remark

stock_ledger_entries
  id, posted_at, item_id, warehouse_id, location_id,
  lot_no, serial_no, quantity_delta, document_type, document_id,
  source_document_no, operator_id
```

设计原则：

- 已过账单据生成库存台账，不直接修改库存余额。
- 库存余额由库存台账汇总得到；后续如需性能优化，再维护可重建的余额汇总表。
- 已过账单据禁止物理删除；撤销必须生成反向流水并记录原因。
- 盘点差异、报废、调整必须使用独立单据和审批权限。

## 7. 权限设计

现有权限模型可直接扩展，不需要新建登录体系。建议新增以下权限代码：

```text
inventory.dashboard.view

inventory.categories.view
inventory.categories.manage
inventory.units.view
inventory.units.manage
inventory.items.view
inventory.items.manage
inventory.warehouses.view
inventory.warehouses.manage
inventory.locations.view
inventory.locations.manage

inventory.balance.view
inventory.ledger.view
inventory.traceability.view

inventory.receipts.view
inventory.receipts.create
inventory.receipts.submit
inventory.receipts.approve

inventory.issues.view
inventory.issues.create
inventory.issues.submit
inventory.issues.approve

inventory.transfers.view
inventory.transfers.create
inventory.transfers.submit
inventory.transfers.approve

inventory.counts.view
inventory.counts.create
inventory.counts.submit
inventory.counts.approve

inventory.adjustments.view
inventory.adjustments.create
inventory.adjustments.approve
inventory.scrap.approve
```

除功能权限外，后续还需增加数据范围授权：

- 可操作仓库。
- 可操作库位。
- 可查询仓库。
- 可审批的仓库或单据类型。
- 是否允许查看成本字段。

### 7.1 组织权限边界

```text
系统总管理员
  - 全局：账号、角色、权限、所有部门、所有仓库、所有库存单据
  - 全局审批与异常处理

部门经理
  - 获授权部门：业务主数据、单据审批、任务分配和业务查询
  - 仅能操作授权仓库、库位和单据类型
  - 不可修改全局角色、跨部门数据范围或其他部门单据

部门员工
  - 本岗位：创建、提交或查询已授权业务
  - 仅能操作授权仓库、库位、工位和本人/本部门范围内数据
  - 不具备高风险审批、库存调整审批、跨部门授权等权限
```

部门经理不是单独的超级角色，而是“部门范围 + 业务管理/审批权限”的组合。经理与部门采用多对多授权关系，以支持一名经理管理多个部门，同时避免部门经理默认获得系统管理员权限。

## 8. 单据状态建议

所有库存单据统一采用以下主状态：

```text
草稿 -> 待提交 -> 待审批 -> 已过账
                 \-> 已驳回
草稿/待提交/待审批 -> 已取消
已过账 -> 冲销完成
```

第一阶段可根据实际岗位简化为“草稿、已提交、已过账、已取消”，但不能允许普通操作员直接修改已过账库存。

## 9. 现有框架的适配方式

当前系统已具备：

- 独立员工账号。
- 角色和权限分配。
- 后端接口权限校验。
- 菜单按权限显示。
- 操作审计日志。
- SQLite 数据库和 Fastify API。

下一阶段应在现有 `warehouse` 预留入口上扩展为“库存 ERP”模块。建议将现有仓储权限逐步迁移为上文的细粒度 `inventory.*` 权限，同时保留旧权限一段时间以完成兼容迁移。

当前数据库运行时文件位于 `apps/api/data/`，后续应明确开发、测试、正式环境的数据库路径与备份策略，避免将运行数据混入源码目录。

## 10. 开发验收标准

第一开发切片完成时，至少应满足：

1. 管理员可维护商品分类、单位、商品、仓库和库位。
2. 商品可配置库存单位、条码和追溯方式。
3. 库位必须归属一个仓库，并具有明确用途。
4. 不同角色只能看到授权的库存菜单和操作入口。
5. 所有主数据新增、修改、停用都进入审计日志。
6. 库存余额与库存台账页面可以查询，但没有任何“直接修改库存”按钮。
7. 每个后续库存单据都预留来源、去向、操作人、状态和过账时间字段。
8. 商品建立完成后，仓库人员可通过正常入库单选择商品、数量和目标仓库建立第一笔库存。

## 11. 编码前必须确认的业务问题

以下问题不能由系统开发自行猜测，需要业务负责人确认：

1. 商品编码规则：是否使用现有料号，还是系统自动生成。
2. 商品分类树：原料、半成品、成品、辅料、包装、耗材等实际分类和编码。
3. 单位体系：颗、片、条、套、盘、箱等单位及换算规则。
4. 仓库与库位清单：真实仓库、货架、区域、委外仓和隔离区名称。
5. 哪些物料必须按批次追溯，哪些成品必须按序列号追溯。
6. 已确认首批需要普通入库单；仍需确认入库、出库、调拨、盘点、报废、退货中其余首批要启用哪些单据。
7. 是否存在极少数允许“预占”但不允许实际负库存的特殊场景。
8. 各类库存单据由哪个部门经理审批；是否需要系统总管理员二次审批。
9. 是否使用条码枪，以及商品和库位条码的打印规则。
10. 是否需要记录库存成本；如需要，采用移动平均、先进先出还是仅记录数量，必须由财务确认。

## 12. 调研参考

- Odoo Inventory 文档：仓库、库位、盘点、补货规则、批次和序列号追溯。
- ERPNext 官方介绍和开源仓库：库存、采购、销售和制造模块的集成边界。
- 本项目《内存条 ERP-MES 一体化系统完整解决方案说明书》：人工 MES、库存状态、批次/序列号及质量追溯要求。
