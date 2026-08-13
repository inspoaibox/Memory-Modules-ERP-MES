# 内存条 ERP + MES 系统

内存条工厂 ERP 与 MES 一体化系统，当前采用 pnpm workspace 管理前后端工程：

- ERP：商品资料、分类、属性、仓库、库位、库存查询、入库、出库、调拨、盘点、报废、库存台账。
- MES：生产计划、生产工单、工艺路线、工序任务、工序报工、测试、不良维修、报废产品和生产追溯。
- 系统管理：员工账号、组织部门、角色权限、工序授权、操作审计。
- 权限模型：系统总管理员、部门经理、普通员工；菜单显示由权限控制，后端接口会再次校验。

本文档是项目的安装、部署、启动、维护、备份、升级和故障处理手册。业务方案和完整功能规划见根目录的《内存条 ERP-MES 一体化系统完整解决方案说明书.docx》及《库存ERP模块调研与分阶段建设方案.md》。

## 1. 系统架构

```text
浏览器
  |
  | 生产环境：IIS/Nginx 静态文件 + /api 反向代理
  | 开发环境：Vite 开发服务器 + /api 代理
  v
React + Vite 前端管理台
  |
  v
Fastify API
  |
  v
SQLite（WAL 模式）
```

### 1.1 目录说明

```text
apps/
  api/                 Fastify API、SQLite 初始化、权限和业务接口
    src/               后端源码
    data/              运行时 SQLite 数据库，不纳入版本控制
    dist/              后端编译产物
  web/                 React + Vite 前端管理台
    src/               前端源码
    dist/              前端构建产物
data/                  预留目录；当前 API 默认使用 apps/api/data
pnpm-lock.yaml         依赖锁定文件
package.json           根工程命令
.runtime-logs/         本地运行日志，不纳入版本控制
```

### 1.2 端口

当前端口已避开常见的 `3000`、`3001`、`5173`：

| 服务 | 默认地址 | 配置位置 |
| --- | --- | --- |
| 前端开发服务器 | `http://localhost:43128` | `apps/web/vite.config.ts` |
| 后端 API | `http://localhost:43127` | `apps/api/src/index.ts` 的 `PORT` |
| API 健康检查 | `http://localhost:43127/api/health` | 后端接口 |

如果需要改端口，必须同时修改：API 的 `PORT`、Vite 的 `server.port`、Vite 的 `/api` 代理地址以及 API 的 CORS 白名单。

## 2. 环境要求

### 2.1 推荐版本

- Windows Server 2019/2022 或 Windows 10/11。
- Node.js 20 LTS 或更高版本。当前开发环境使用 Node.js `v24.14.1`。
- pnpm `10.x`。项目锁定版本为 `10.15.0`。
- Git。
- PM2：生产进程守护和开机恢复使用。
- IIS 或 Nginx：生产环境提供前端静态文件和 API 反向代理，二选一。

SQLite 不需要单独安装，数据库由 `better-sqlite3` 使用。Windows 安装依赖时如果出现原生模块编译问题，应优先使用项目锁定的 Node.js 与 pnpm 版本，不要直接删除数据库或重新初始化系统。

### 2.2 检查版本

```powershell
node --version
pnpm --version
git --version
pm2 --version
```

没有 pnpm 时：

```powershell
corepack enable
corepack prepare pnpm@10.15.0 --activate
```

没有 PM2 时：

```powershell
pnpm add --global pm2
pm2 --version
```

## 3. 获取项目和安装依赖

### 3.1 首次安装

在部署目录执行：

```powershell
git clone <项目仓库地址> D:\Apps\Memory-Modules-ERP-MES
Set-Location D:\Apps\Memory-Modules-ERP-MES

corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install --frozen-lockfile
```

如果项目不是通过 Git 获取，将完整项目目录复制到部署目录后，从 `pnpm install --frozen-lockfile` 开始执行。生产部署不得把开发机的 `node_modules` 直接复制到服务器。

### 3.2 安装原生依赖失败

`better-sqlite3` 是原生 Node.js 模块。出现 `Cannot find module better_sqlite3.node`、`compiled\...` 或 ABI 不匹配时，按以下顺序处理：

```powershell
Set-Location D:\Apps\Memory-Modules-ERP-MES
pnpm install --force
pnpm rebuild better-sqlite3
pnpm --filter @memory/api typecheck
```

如果仍失败，确认 Node.js 主版本没有在运行中途更换，再重新安装依赖。不要删除 `apps/api/data`，数据库与依赖无关。

## 4. 配置正式环境

后端支持以下环境变量：

| 变量 | 默认值 | 正式环境要求 |
| --- | --- | --- |
| `NODE_ENV` | 空 | 设置为 `production` |
| `PORT` | `43127` | 使用未被占用的 API 端口 |
| `JWT_SECRET` | 开发密钥 | 必须设置为随机长密钥 |
| `INITIAL_ADMIN_PASSWORD` | 开发初始密码 | `NODE_ENV=production` 时必须设置 |
| `SEED_DEMO_DATA` | 空 | 正式环境不要设置为 `true` |

创建 `apps/api/.env`。该文件会在下面的 PM2 配置中通过 Node.js 的 `--env-file=.env` 显式加载：

```dotenv
NODE_ENV=production
PORT=43127
JWT_SECRET=请替换为至少32位的随机密钥
INITIAL_ADMIN_PASSWORD=请替换为正式管理员初始密码
SEED_DEMO_DATA=false
```

生成随机密钥示例：

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

安全要求：

- `.env` 不提交 Git，不发送到聊天工具，不放入前端 `apps/web`。
- 正式环境首次登录后立即修改管理员初始密码。
- `JWT_SECRET` 变更会使现有 JWT 失效，变更前应通知所有用户重新登录。
- 正式环境不要执行 `pnpm seed:demo`，不要设置 `SEED_DEMO_DATA=true`。
- 当前 SQLite 文件中包含账号、权限、库存和生产数据，应限制服务器文件权限。

## 5. 初始化和首次上线

### 5.1 构建前检查

```powershell
Set-Location D:\Apps\Memory-Modules-ERP-MES
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

构建成功后，后端产物在 `apps/api/dist`，前端产物在 `apps/web/dist`。

### 5.2 数据库初始化

API 第一次启动时会自动：

1. 创建 `apps/api/data` 目录。
2. 创建 `erp-mes.db`。
3. 创建表、索引、权限目录、系统总管理员角色和基础数据。
4. 执行已内置的数据库结构升级。

生产环境第一次启动前，确认 `.env` 已配置。初始化完成后使用管理员账号登录，按系统内流程创建：

1. 部门和岗位职责。
2. 员工账号。
3. 角色和权限。
4. 工序定义和工艺路线。
5. 商品分类、属性、商品资料。
6. 仓库、仓库地址和库位。
7. 通过正常入库流程建立上线后的第一批库存。

本系统是新系统，不能把历史期初库存直接写进数据库；上线库存应通过正常入库单据形成业务记录和审计记录。

### 5.3 演示数据

演示数据只适用于开发和测试环境：

```powershell
$env:NODE_ENV = "development"
$env:SEED_DEMO_DATA = "true"
pnpm seed:demo
```

演示账号首次登录需要修改密码。正式环境不要执行上述命令。`pnpm seed:demo` 不负责清空数据，也不应用于生产数据修复。

## 6. 开发环境启动

### 6.1 启动前后端

```powershell
Set-Location D:\软件开发项目\Memory-Modules-ERP-MES
pnpm dev
```

访问：

- 前端：`http://localhost:43128`
- API：`http://localhost:43127/api/health`

开发环境启动的是 Vite 热更新服务器和 `tsx watch` 后端，不适合生产运行。

### 6.2 分开启动

后端：

```powershell
pnpm --filter @memory/api dev
```

前端：

```powershell
pnpm --filter @memory/web dev
```

### 6.3 开发环境关闭

在运行 `pnpm dev` 的终端按 `Ctrl+C`。如果端口仍被占用：

```powershell
Get-NetTCPConnection -LocalPort 43127,43128 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess

Get-Process -Id <进程号>
Stop-Process -Id <进程号>
```

只停止确认属于本项目的进程。不要通过结束所有 `node.exe` 的方式处理，否则会影响其他项目。

## 7. 生产构建和 PM2 启动

### 7.1 推荐生产拓扑

推荐使用：

```text
IIS/Nginx : 80 或 443
  ├── /           -> apps/web/dist 静态文件
  └── /api/*      -> http://127.0.0.1:43127

PM2
  └── @memory/api -> node apps/api/dist/index.js
```

前端不需要由 PM2 运行。PM2 只守护后端 API，前端由 IIS/Nginx 提供静态文件，性能和维护都更稳定。

### 7.2 编译生产代码

```powershell
Set-Location D:\Apps\Memory-Modules-ERP-MES
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

### 7.3 PM2 配置文件

在项目根目录创建 `ecosystem.config.cjs`。该文件只描述进程，不包含密码：

```javascript
module.exports = {
  apps: [
    {
      name: "memory-erp-mes-api",
      cwd: "D:/Apps/Memory-Modules-ERP-MES/apps/api",
      script: "dist/index.js",
      interpreter: "node",
      node_args: "--env-file=.env",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      time: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "43127",
        SEED_DEMO_DATA: "false"
      }
    }
  ]
};
```

`JWT_SECRET` 和 `INITIAL_ADMIN_PASSWORD` 放在 `apps/api/.env`，不要明文写入 PM2 配置。当前源码不会自动读取 `.env`；如果直接用 `node dist/index.js` 启动，需要先通过系统环境变量或 Node.js 的 `--env-file` 注入这些变量。

### 7.4 启动、查看和停止

```powershell
Set-Location D:\Apps\Memory-Modules-ERP-MES
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
pm2 logs memory-erp-mes-api --lines 100
```

验证 API：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:43127/api/health
```

常用维护命令：

```powershell
pm2 restart memory-erp-mes-api
pm2 reload memory-erp-mes-api
pm2 stop memory-erp-mes-api
pm2 delete memory-erp-mes-api
pm2 monit
```

### 7.5 Windows 开机自启动

PM2 在 Windows 下的自启动需要通过系统任务计划或 PM2 Windows 启动工具完成。建议使用任务计划程序：

1. 打开“任务计划程序”，创建基本任务 `Memory ERP MES PM2`。
2. 触发器选择“计算机启动时”。
3. 操作选择启动程序。
4. 程序填写 `pm2.cmd` 的绝对路径，可通过 `Get-Command pm2` 查询。
5. 参数填写 `resurrect`。
6. 起始位置填写 `D:\Apps\Memory-Modules-ERP-MES`。
7. 选择“使用最高权限运行”，并配置为无论用户是否登录都运行。

也可以使用 PM2 的启动脚本，但必须在目标 Windows 服务器上实际验证重启后的恢复：

```powershell
pm2 save
pm2 resurrect
```

### 7.6 前端静态部署

构建后的前端目录是：

```text
D:\Apps\Memory-Modules-ERP-MES\apps\web\dist
```

IIS/Nginx 应将站点根目录指向该目录，并将 `/api` 反向代理到 `http://127.0.0.1:43127`。前端使用相对路径请求 `/api`，因此不要把 API 地址写成公网数据库或开发机地址。

IIS 需要启用 URL Rewrite 和 Application Request Routing；Nginx 配置的核心示例：

```nginx
server {
    listen 80;
    server_name erp.example.com;
    root D:/Apps/Memory-Modules-ERP-MES/apps/web/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:43127;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

生产环境应使用 HTTPS，并限制 API 端口只允许本机或内网访问，不要把 `43127` 直接暴露到公网。

## 8. 数据库和文件备份

### 8.1 需要备份的内容

至少备份：

```text
apps/api/data/erp-mes.db
apps/api/.env
ecosystem.config.cjs
apps/web/dist/       （可由版本重新构建，也建议保留上线版本）
```

`erp-mes.db-shm` 和 `erp-mes.db-wal` 是 SQLite WAL 运行文件。数据库备份必须使用 SQLite 在线备份或停机后复制完整文件，不能只复制正在运行中的 `.db` 主文件。

### 8.2 推荐：停机一致性备份

维护窗口内执行：

```powershell
Set-Location D:\Apps\Memory-Modules-ERP-MES
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "D:\Backups\Memory-ERP-MES\$stamp"
New-Item -ItemType Directory -Force $backup | Out-Null

pm2 stop memory-erp-mes-api
Copy-Item apps\api\data\erp-mes.db $backup\erp-mes.db
Copy-Item apps\api\.env $backup\api.env -ErrorAction SilentlyContinue
pm2 start memory-erp-mes-api

Get-ChildItem $backup
```

停机后如果目录中仍有 `.db-shm` 或 `.db-wal`，应一并保留；正常关闭后 WAL 通常会被合并或清理。

### 8.3 在线备份：SQLite VACUUM INTO

项目服务器已安装 SQLite 命令行时，可以不停止 API，执行 SQLite 在线备份：

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "D:\Backups\Memory-ERP-MES\$stamp"
New-Item -ItemType Directory -Force $backup | Out-Null

sqlite3.exe apps\api\data\erp-mes.db "PRAGMA wal_checkpoint(PASSIVE); VACUUM INTO '$($backup.Replace('\','/'))/erp-mes.db';"
Copy-Item apps\api\.env $backup\api.env -ErrorAction SilentlyContinue
```

路径含空格时请使用绝对路径并注意命令引号。在线备份执行后必须检查目标文件存在且大小合理。

### 8.4 备份策略

建议生产环境：

| 项目 | 建议 |
| --- | --- |
| 频率 | 每日全量备份；重要上线或批量导入前立即备份 |
| 保留 | 最近 7 天每日备份、最近 4 周每周备份、每月保留 6 个月 |
| 位置 | 服务器本机 + 独立磁盘或 NAS；不要只保留一份 |
| 安全 | 备份目录限制管理员访问，异地副本加密 |
| 验证 | 每月至少执行一次恢复演练，并验证能登录和查询业务数据 |

备份完成不等于备份可恢复。每次重要版本上线前，都应做一次备份并记录备份路径、时间和文件大小。

## 9. 数据恢复和回滚

### 9.1 恢复前要求

- 先停止 API，避免恢复过程中数据库继续写入。
- 保留当前故障数据库副本，不要直接覆盖后丢失现场。
- 确认备份对应的版本和时间点。
- 恢复后需要重新验证账号、权限、库存余额、生产工单和审计记录。

### 9.2 从备份恢复

```powershell
Set-Location D:\Apps\Memory-Modules-ERP-MES
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$data = "apps\api\data"

pm2 stop memory-erp-mes-api
Copy-Item $data\erp-mes.db "D:\Backups\Memory-ERP-MES\before-restore-$stamp.db"
Copy-Item "D:\Backups\Memory-ERP-MES\<备份时间>\erp-mes.db" "$data\erp-mes.db" -Force
Remove-Item "$data\erp-mes.db-shm","$data\erp-mes.db-wal" -Force -ErrorAction SilentlyContinue
pm2 start memory-erp-mes-api

Invoke-WebRequest -UseBasicParsing http://127.0.0.1:43127/api/health
pm2 logs memory-erp-mes-api --lines 100
```

如果恢复的是与当前程序结构不同的旧版本数据库，应先在隔离环境启动验证，不要直接在生产环境尝试自动升级。

## 10. 系统升级流程

所有升级都应先在测试环境验证，再进入生产环境。推荐流程如下：

### 10.1 发布前

1. 记录当前 Git commit、版本号和数据库文件大小。
2. 阅读变更说明，重点检查数据库结构、权限、库存和生产流程变化。
3. 备份数据库、`.env` 和当前前端 `dist`。
4. 在测试环境使用生产同版本数据库副本验证升级。
5. 通知用户维护时间，禁止升级期间创建入库、出库、盘点、报废和生产报工单据。

### 10.2 更新代码

```powershell
Set-Location D:\Apps\Memory-Modules-ERP-MES
pm2 stop memory-erp-mes-api

git fetch --all --prune
git checkout <目标版本或commit>
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

API 启动时会执行代码中已实现的数据库结构升级。升级后不要重复执行演示种子脚本。

### 10.3 启动和验收

```powershell
pm2 start ecosystem.config.cjs
pm2 save

Invoke-WebRequest -UseBasicParsing http://127.0.0.1:43127/api/health
pm2 status
pm2 logs memory-erp-mes-api --lines 100
```

至少验收：

- 登录、退出登录和修改密码。
- 系统管理员、部门经理、普通员工的菜单和接口权限。
- 商品资料、分类树、仓库和库位。
- 入库、出库、调拨、盘点、报废的预览、打印、下载和状态流转。
- 生产工单的暂停、继续、停止、终止、关闭和删除规则。
- 芯片测试、不良维修、维修报废和报废产品数据流转。
- 库存余额、库存台账、审计日志。

### 10.4 失败回滚

如果 API 无法启动、健康检查失败或业务验收失败：

```powershell
pm2 stop memory-erp-mes-api
git checkout <上一个稳定版本>
pnpm install --frozen-lockfile
pnpm build
pm2 start ecosystem.config.cjs
```

如果问题来自数据库结构变更，先停止服务，再从升级前备份恢复数据库。代码回滚和数据库回滚必须作为一个整体评估，不能只回滚其中一项。

## 11. 日常维护

### 11.1 服务状态

```powershell
pm2 status
pm2 describe memory-erp-mes-api
pm2 logs memory-erp-mes-api --lines 200
```

### 11.2 端口检查

```powershell
Get-NetTCPConnection -LocalPort 43127,43128 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

### 11.3 健康检查

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:43127/api/health
```

预期返回类似：

```json
{"ok":true,"service":"memory-erp-mes-api","timestamp":"..."}
```

### 11.4 日志管理

PM2 日志目录和文件由实际 PM2 配置决定。建议定期查看并限制日志大小：

```powershell
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

如果暂不安装日志轮转，至少每周检查日志目录大小，并在确认已备份后清理旧日志。不要清理数据库文件。

### 11.5 磁盘和数据库检查

```powershell
Get-PSDrive -PSProvider FileSystem
Get-ChildItem apps\api\data -Force | Select-Object Name,Length,LastWriteTime
```

SQLite 数据库出现异常时，先备份现场，再进行只读完整性检查：

```powershell
sqlite3.exe apps\api\data\erp-mes.db "PRAGMA integrity_check;"
```

返回 `ok` 才表示 SQLite 结构检查通过；业务数据正确性仍需通过系统页面和业务台账核对。

## 12. 故障排查

### 12.1 登录请求失败

先检查 API 是否运行：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:43127/api/health
pm2 status
pm2 logs memory-erp-mes-api --lines 100
```

- 健康检查连接失败：API 未启动、端口被占用或进程崩溃。
- 健康检查正常但前端失败：检查 IIS/Nginx 的 `/api` 代理和浏览器请求地址。
- 返回“账号或密码错误”：核对账号状态和密码，不要直接重置数据库。
- 返回“必须先修改初始密码”：使用当前初始密码修改一个符合要求的新密码。
- 返回 CORS 错误：检查前端地址是否为 `43128`，并同步 API CORS 白名单。

### 12.2 `EADDRINUSE` 端口被占用

```powershell
Get-NetTCPConnection -LocalPort 43127 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess
Get-Process -Id <进程号>
```

确认是本项目重复进程后，使用 PM2 管理的服务应执行：

```powershell
pm2 restart memory-erp-mes-api
```

不要随意结束所有 Node.js 进程。

### 12.3 `better_sqlite3.node` 加载失败

```powershell
node --version
pnpm --version
pnpm rebuild better-sqlite3
pnpm --filter @memory/api typecheck
```

确认 API 使用的是当前项目的 `node_modules`，并且 Node.js 版本没有频繁切换。

### 12.4 API 启动后立即退出

```powershell
pm2 logs memory-erp-mes-api --err --lines 200
```

常见原因：

- `.env` 中正式环境缺少 `INITIAL_ADMIN_PASSWORD`。
- `PORT` 非数字或端口已被占用。
- SQLite 文件目录无读写权限。
- 原生模块和 Node.js ABI 不匹配。
- 新版本数据库升级失败。

保留错误日志和数据库副本后再处理，不要先删除 `apps/api/data`。

### 12.5 前端页面空白或接口 404

- 确认 `apps/web/dist/index.html` 存在。
- 确认 IIS/Nginx 根目录指向 `apps/web/dist`。
- SPA 路由必须回退到 `index.html`。
- `/api` 必须代理到 `http://127.0.0.1:43127`。
- 重新执行 `pnpm build`，确认构建无错误。

## 13. 权限和数据安全基线

- 系统总管理员只授予极少数可信人员。
- 部门经理可管理其授权部门，不默认拥有其他部门数据权限。
- 普通员工只授予岗位必需的查看、创建或执行权限。
- 角色调整后使用不同账号实际验证菜单和接口，不以“按钮隐藏”作为唯一判断。
- 生产操作、库存过账、审批、报废和权限修改必须保留操作审计。
- 不允许负库存；异常库存必须通过盘点、调拨、报废等有审计的业务流程处理。
- 生产报工中投放、合格、不良、维修合格、维修不良和报废数量必须满足业务数量平衡。
- 备份文件与 `.env` 文件不能放在前端静态目录。
- 生产 API 端口只监听内网或本机，公网访问由 HTTPS 网关承接。

## 14. 版本发布记录模板

每次发布建议填写以下信息：

```text
版本号：
发布时间：
代码 commit：
数据库备份路径：
变更内容：
数据库结构变更：是 / 否
权限变更：是 / 否
执行人：
验收人：
回滚版本：
异常记录：
```

## 15. 当前验证命令

提交代码或发布前至少执行：

```powershell
pnpm typecheck
pnpm build
```

启动后执行：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:43127/api/health
```

## 16. 后续建设方向

1. 完善班组、工位、设备和更细的数据范围授权。
2. 建立物料、产品、BOM、工艺路线和测试规范主数据闭环。
3. 完善生产派工、工序报工、工序数据采集和设备接口。
4. 完善质量检验、不良、维修、复测、放行和批次追溯。
5. 增加报表、统计分析、导入导出、消息通知和接口集成。
6. 增加正式数据库迁移工具、自动备份任务、恢复演练和发布流水线。
