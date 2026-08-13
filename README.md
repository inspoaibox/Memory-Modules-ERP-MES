# 内存条 ERP + MES 系统

内存条工厂 ERP 与 MES 一体化系统。当前工程包括：

- ERP：商品资料、商品分类、商品属性、仓库、仓库地址、库位、库存查询、入库、出库、调拨、盘点、报废、库存台账。
- MES：生产计划、生产工单、工艺路线、工序任务、芯片测试、不良维修、报废产品、生产追溯。
- 系统管理：员工账号、组织部门、角色权限、工序授权、操作审计。
- 权限模型：系统总管理员、部门经理、普通员工；前端控制菜单，后端接口再次校验权限。

业务方案见根目录：

- `内存条ERP-MES一体化系统完整解决方案说明书.docx`
- `库存ERP模块调研与分阶段建设方案.md`

本文档是实际部署手册。生产服务器使用 Linux `/root` 目录示例；Windows 命令只出现在最后的本地开发章节。

## 1. 生产架构

生产环境不是分别运行两个开发服务器，而是：

```text
浏览器
  |
  v
Caddy : 80/443
  |-- /              -> apps/web/dist 静态前端
  |-- /api/*         -> 127.0.0.1:43127
  |
  +-- PM2 -> apps/api/dist/index.js
                |
                v
        SQLite: apps/api/data/erp-mes.db
```

说明：

- PM2 只守护后端 API。
- 前端构建为静态文件，由 Caddy 提供，不需要使用 `vite dev` 或 `vite preview`。
- SQLite 是应用内置数据库，不需要安装 MySQL、PostgreSQL 或单独启动数据库服务。
- API 第一次启动时自动创建数据库目录、数据库文件、表、权限、系统管理员和内置基础数据。
- 数据库路径取决于 API 的工作目录。项目提供的 PM2 配置会把工作目录固定为 `apps/api`，因此生产数据库路径为：

```text
/root/Memory-Modules-ERP-MES/apps/api/data/erp-mes.db
```

## 2. 版本和端口

| 项目 | 当前值 |
| --- | --- |
| Node.js | 24.x，建议生产与开发保持同一主版本 |
| pnpm | 10.26.0 |
| API | 43127 |
| 前端开发服务器 | 43128，仅本地开发使用 |
| 生产入口 | Caddy 80/443 |
| 数据库 | SQLite + better-sqlite3 |
| PM2 进程名 | `memory-erp-mes-api` |

端口说明：

- 生产对外只开放 Caddy 的 80/443。
- API 的 43127 只监听本机或内网，不要直接暴露到公网。
- 43128 是 Vite 开发端口，生产环境不启动。

## 3. Linux 服务器首次安装

以下命令适用于 Debian/Ubuntu 系 Linux，并假设使用当前服务器的 `root` 账号。

### 3.1 安装系统依赖

```bash
apt-get update
apt-get install -y ca-certificates curl gnupg git build-essential python3 make g++ sqlite3 acl
```

这些依赖的用途：

- `git`：获取和更新项目。
- `build-essential`、`python3`、`make`、`g++`：编译 `better-sqlite3` 等 Node.js 原生依赖。
- `sqlite3`：执行数据库检查、在线备份和恢复验证。
- `acl`：允许 Caddy 服务账号读取 `/root` 下的前端构建目录。

### 3.2 安装 Caddy

Caddy 使用官方 Debian/Ubuntu 软件源安装，并作为 systemd 服务运行：

```bash
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
  gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' |
  tee /etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
chmod o+r /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy
```

检查 Caddy 服务：

```bash
caddy version
systemctl status caddy --no-pager
```

### 3.3 安装 Node.js 24

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
```

检查 Node.js 和 npm：

```bash
node --version
npm --version
```

### 3.4 安装 pnpm 10.26.0

```bash
corepack enable
corepack prepare pnpm@10.26.0 --activate
pnpm --version
```

如果服务器提示没有 `corepack`，执行：

```bash
npm install --global corepack
corepack enable
corepack prepare pnpm@10.26.0 --activate
pnpm --version
```

### 3.5 安装 PM2

```bash
npm install --global pm2
pm2 --version
```

### 3.6 最终检查

```bash
node --version
pnpm --version
git --version
pm2 --version
sqlite3 --version
caddy version
```

在这一步之前不要执行项目的 `pnpm install`。如果 `node`、`pnpm` 或 `pm2` 仍然显示 `command not found`，先处理系统安装和 PATH，不要继续启动项目。

## 4. 获取项目

### 4.1 使用 Git 获取

把 `<仓库地址>` 替换为真实 Git 仓库地址：

```bash
mkdir -p /root
cd /root
git clone <仓库地址> Memory-Modules-ERP-MES
cd /root/Memory-Modules-ERP-MES
```

### 4.2 项目通过压缩包上传

将完整项目上传并解压到以下目录：

```text
/root/Memory-Modules-ERP-MES
```

确认目录中能看到：

```bash
cd /root/Memory-Modules-ERP-MES
ls -la
```

至少应存在 `package.json`、`pnpm-lock.yaml`、`apps/api` 和 `apps/web`。

生产环境不要直接复制 Windows 的 `node_modules`。Linux 必须在服务器上重新执行 `pnpm install`，否则很容易出现 `better_sqlite3.node` 或 Node.js ABI 不匹配。

## 5. 安装项目依赖

```bash
cd /root/Memory-Modules-ERP-MES
pnpm install --frozen-lockfile
```

如果安装结果出现：

```text
Ignored build scripts: better-sqlite3, esbuild
```

项目在 `pnpm-workspace.yaml` 中通过 `allowBuilds` 放行这两个原生依赖的安装构建脚本。该配置要求 pnpm `10.26.0` 或更高的 10.x 版本；服务器升级 pnpm 后重新安装和构建：

```bash
cd /root/Memory-Modules-ERP-MES
corepack prepare pnpm@10.26.0 --activate
hash -r
pnpm --version
pnpm install --force
pnpm rebuild better-sqlite3 esbuild
```

确认 `pnpm-workspace.yaml` 中包含：

```yaml
allowBuilds:
  better-sqlite3: true
  esbuild: true
```

不要只用 `require('better-sqlite3')` 判断成功，必须实际创建 SQLite 实例：

```bash
cd /root/Memory-Modules-ERP-MES/apps/api
node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); console.log('better-sqlite3 runtime OK'); db.close()"
```

只有看到 `better-sqlite3 runtime OK` 后，才启动 PM2。

如果出现原生模块错误：

```bash
cd /root/Memory-Modules-ERP-MES
pnpm rebuild better-sqlite3
pnpm install --frozen-lockfile
```

如果仍然失败，检查：

```bash
node --version
pnpm --version
which node
which pnpm
```

确认运行中的 Node.js 与安装依赖时使用的是同一个版本。不要通过删除数据库目录解决依赖问题，依赖和数据库是两件事。

## 6. 配置生产环境

### 6.1 创建 API 环境变量

项目已经提供模板：

```text
/root/Memory-Modules-ERP-MES/apps/api/.env.example
```

复制为正式配置：

```bash
cd /root/Memory-Modules-ERP-MES
cp apps/api/.env.example apps/api/.env
chmod 600 apps/api/.env
nano apps/api/.env
```

正式环境至少配置：

```dotenv
NODE_ENV=production
PORT=43127
JWT_SECRET=请替换为随机长密钥
INITIAL_ADMIN_PASSWORD=请替换为正式管理员初始密码
SEED_DEMO_DATA=false
```

生成随机 JWT 密钥：

```bash
openssl rand -hex 48
```

把命令输出复制到 `JWT_SECRET`。`INITIAL_ADMIN_PASSWORD` 是第一次创建 `admin` 账号时使用的初始密码，首次登录后必须在系统内修改。

安全要求：

- `.env` 不能提交 Git，不能放到 `apps/web/dist`。
- `JWT_SECRET` 变更后，所有现有登录令牌都会失效。
- 正式环境不能执行 `pnpm seed:demo`，不能设置 `SEED_DEMO_DATA=true`。
- 生产服务器必须限制 `/root/Memory-Modules-ERP-MES/apps/api/data` 和 `.env` 的访问权限。

### 6.2 数据库初始化

本系统使用内置 SQLite，不需要执行 `apt install mysql-server`，也没有 MySQL 服务需要启动。

第一次启动 API 后会自动创建：

```text
/root/Memory-Modules-ERP-MES/apps/api/data/erp-mes.db
/root/Memory-Modules-ERP-MES/apps/api/data/erp-mes.db-wal
/root/Memory-Modules-ERP-MES/apps/api/data/erp-mes.db-shm
```

新系统库存从零开始。上线后的第一批库存必须通过商品资料、仓库、入库单等正常业务流程建立，不要直接修改 SQLite 文件。

## 7. 编译和首次启动

### 7.1 类型检查和构建

```bash
cd /root/Memory-Modules-ERP-MES
pnpm typecheck
pnpm build
```

构建产物：

```text
/root/Memory-Modules-ERP-MES/apps/api/dist
/root/Memory-Modules-ERP-MES/apps/web/dist
```

### 7.2 使用 PM2 启动后端

项目根目录提供 `ecosystem.config.cjs`，它会：

- 使用 `apps/api` 作为工作目录，确保 SQLite 路径正确。
- 使用 Node.js `--env-file=.env` 加载生产环境变量。
- 以 `memory-erp-mes-api` 进程名启动 API。
- 自动重启异常退出的 API。

首次启动：

```bash
cd /root/Memory-Modules-ERP-MES
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
```

检查 API：

```bash
curl http://127.0.0.1:43127/api/health
```

预期返回包含：

```json
{"ok":true,"service":"memory-erp-mes-api"}
```

检查数据库是否创建：

```bash
ls -lh /root/Memory-Modules-ERP-MES/apps/api/data
```

查看后端日志：

```bash
pm2 logs memory-erp-mes-api --lines 100
```

如果服务器同时安装了多个 Node.js 版本，启动前先把当前 Node.js 的绝对路径传给 PM2：

```bash
cd /root/Memory-Modules-ERP-MES
NODE_BINARY="$(readlink -f "$(command -v node)")"
NODE_BINARY="$NODE_BINARY" pm2 start ecosystem.config.cjs
```

首次初始化完成后，使用账号 `admin` 和 `.env` 中的 `INITIAL_ADMIN_PASSWORD` 登录，然后立即修改密码。

### 7.3 如果提示 `ecosystem.config.cjs not found`

这表示服务器当前目录没有同步项目根目录的 PM2 配置文件，不是前端或后端构建失败。先检查：

```bash
cd /root/Memory-Modules-ERP-MES
pwd
git status --short
git log -1 --oneline
ls -l ecosystem.config.cjs
```

如果项目是 Git 克隆的，并且服务器没有需要保留的本地修改：

```bash
cd /root/Memory-Modules-ERP-MES
git fetch origin
git pull --ff-only origin main
ls -l ecosystem.config.cjs
```

如果项目是压缩包或文件上传方式部署，请把根目录的 `ecosystem.config.cjs` 上传到：

```text
/root/Memory-Modules-ERP-MES/ecosystem.config.cjs
```

然后使用标准命令：

```bash
cd /root/Memory-Modules-ERP-MES
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
```

如果需要立即启动、但暂时无法同步配置文件，可以直接使用等效的 PM2 命令。注意必须让 PM2 和 `better-sqlite3` 使用同一个 Node.js 可执行文件：

```bash
cd /root/Memory-Modules-ERP-MES
NODE_BIN="$(readlink -f "$(command -v node)")"
PATH="$(dirname "$NODE_BIN"):$PATH" NODE_BINARY="$NODE_BIN" pm2 start /root/Memory-Modules-ERP-MES/apps/api/dist/index.js \
  --name memory-erp-mes-api \
  --cwd /root/Memory-Modules-ERP-MES/apps/api \
  --interpreter "$NODE_BIN" \
  --node-args="--env-file=/root/Memory-Modules-ERP-MES/apps/api/.env" \
  --time \
  --max-memory-restart 512M
pm2 save
pm2 status
```

这个临时命令和 `ecosystem.config.cjs` 使用相同的 API 工作目录、环境变量文件、进程名和内存限制。配置文件同步后，项目配置会自动使用启动 PM2 的 `process.execPath`，避免 Node.js 22/24 ABI 不一致。不要重复启动第二个 API 进程；先检查：

```bash
pm2 status
```

如果已经存在 `memory-erp-mes-api`，继续使用它即可。只有确认没有该进程时，才执行 `pm2 start ecosystem.config.cjs`。

## 8. 配置 Caddy

如果服务器之前安装过 Nginx，必须先停止并禁止其开机启动，否则会和 Caddy 争用 80/443 端口：

```bash
systemctl stop nginx 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true
```

项目放在 `/root` 下时，Caddy 的 `caddy` 服务账号默认可能无法读取 root 家目录。只给 Caddy 静态前端目录读取权限，不要把 `.env` 或数据库目录开放给 Caddy：

```bash
setfacl -m u:caddy:--x /root
setfacl -m u:caddy:--x /root/Memory-Modules-ERP-MES
setfacl -m u:caddy:--x /root/Memory-Modules-ERP-MES/apps
setfacl -m u:caddy:--x /root/Memory-Modules-ERP-MES/apps/web
setfacl -R -m u:caddy:rX /root/Memory-Modules-ERP-MES/apps/web/dist
```

项目根目录已经提供 `Caddyfile`，当前生产域名为 `erp.ossgar.com`。如果更换域名，需要同步修改 Caddyfile；如果暂时只用 IP，可改成 `:80`，但不会自动申请公网 HTTPS 证书：

```bash
cd /root/Memory-Modules-ERP-MES
nano Caddyfile
```

将配置安装到 Caddy 默认配置路径：

```bash
install -o root -g caddy -m 640 Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
systemctl restart caddy
```

检查 Caddy：

```bash
systemctl status caddy --no-pager
journalctl -u caddy -n 100 --no-pager
curl -I http://127.0.0.1/
curl http://127.0.0.1/api/health
```

访问地址：

```text
https://你的域名/
```

使用真实域名且 DNS 已指向服务器时，Caddy 会自动申请和续期 HTTPS 证书。API 的 43127 不需要被浏览器直接访问，浏览器统一访问 Caddy 的 `/api`。

## 9. PM2 开机自启动和维护

使用当前 root 用户配置 systemd：

```bash
pm2 startup systemd -u root --hp /root
```

PM2 会输出一条需要复制执行的 `sudo env ... pm2 startup ...` 命令。按终端输出执行，然后保存进程列表：

```bash
pm2 save
systemctl status pm2-root
```

常用命令：

```bash
pm2 status
pm2 describe memory-erp-mes-api
pm2 logs memory-erp-mes-api --lines 200
pm2 restart memory-erp-mes-api --update-env
pm2 reload memory-erp-mes-api --update-env
pm2 stop memory-erp-mes-api
pm2 start ecosystem.config.cjs
pm2 delete memory-erp-mes-api
pm2 monit
```

生产环境不要使用以下开发命令：

```bash
pnpm --filter @memory/api dev
pnpm --filter @memory/web dev
```

这两个命令只用于本地开发热更新。生产环境后端由 PM2 管理，前端由 Caddy 管理。

## 10. 数据库备份和恢复

### 10.1 在线备份

SQLite 运行在 WAL 模式，推荐使用 `sqlite3` 的在线备份，不要只复制运行中的 `.db` 主文件。

```bash
cd /root/Memory-Modules-ERP-MES
BACKUP_DIR="/root/backups/memory-erp-mes/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
sqlite3 apps/api/data/erp-mes.db ".backup '$BACKUP_DIR/erp-mes.db'"
cp -p apps/api/.env "$BACKUP_DIR/api.env"
cp -p ecosystem.config.cjs "$BACKUP_DIR/ecosystem.config.cjs"
ls -lh "$BACKUP_DIR"
```

### 10.2 停机备份

```bash
cd /root/Memory-Modules-ERP-MES
BACKUP_DIR="/root/backups/memory-erp-mes/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
pm2 stop memory-erp-mes-api
cp -p apps/api/data/erp-mes.db "$BACKUP_DIR/erp-mes.db"
cp -p apps/api/.env "$BACKUP_DIR/api.env"
pm2 start ecosystem.config.cjs
```

建议：

- 每天至少一次全量备份。
- 重要升级、权限批量调整、库存批量操作前立即备份。
- 服务器本机和另一台服务器、NAS 或对象存储至少各保留一份。
- 每月执行一次恢复演练，不能只看备份文件是否存在。

### 10.3 恢复数据库

恢复前保留当前故障现场：

```bash
cd /root/Memory-Modules-ERP-MES
RESTORE_DIR="/root/backups/memory-erp-mes/<备份时间>"
BEFORE_DIR="/root/backups/memory-erp-mes/before-restore-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BEFORE_DIR"

pm2 stop memory-erp-mes-api
cp -p apps/api/data/erp-mes.db "$BEFORE_DIR/erp-mes.db"
cp -p "$RESTORE_DIR/erp-mes.db" apps/api/data/erp-mes.db
rm -f apps/api/data/erp-mes.db-wal apps/api/data/erp-mes.db-shm
pm2 start ecosystem.config.cjs
```

恢复后检查：

```bash
curl http://127.0.0.1:43127/api/health
sqlite3 apps/api/data/erp-mes.db "PRAGMA integrity_check;"
pm2 logs memory-erp-mes-api --lines 100
```

只有返回 `ok` 且业务验收通过，才算恢复完成。

## 11. 升级和回滚

### 11.1 升级前

1. 记录当前 Git commit、PM2 状态和数据库文件大小。
2. 执行一次数据库在线备份。
3. 记录当前 `.env`、`ecosystem.config.cjs` 和前端版本。
4. 通知用户暂停入库、出库、盘点、报废和生产报工。

### 11.2 Linux 生产升级

```bash
cd /root/Memory-Modules-ERP-MES
pm2 stop memory-erp-mes-api

git fetch --all --prune
git pull --ff-only
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build

pm2 start ecosystem.config.cjs
pm2 save
curl http://127.0.0.1:43127/api/health
pm2 status
```

如果只是修改环境变量：

```bash
cd /root/Memory-Modules-ERP-MES
pm2 restart memory-erp-mes-api --update-env
```

### 11.3 回滚代码

```bash
cd /root/Memory-Modules-ERP-MES
pm2 stop memory-erp-mes-api
git checkout <上一个稳定版本或commit>
pnpm install --frozen-lockfile
pnpm build
pm2 start ecosystem.config.cjs
pm2 save
curl http://127.0.0.1:43127/api/health
```

如果升级包含数据库结构变更，代码回滚和数据库回滚必须一起评估。不能只回滚代码而忽略数据库版本。

## 12. 日常检查

```bash
cd /root/Memory-Modules-ERP-MES
pm2 status
curl http://127.0.0.1:43127/api/health
df -h
du -sh apps/api/data
du -sh /root/.pm2/logs
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl status caddy --no-pager
```

可选安装 PM2 日志轮转：

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 save
```

## 13. 故障排查

### 13.1 `node: command not found`

说明 Node.js 没有安装或 PATH 没有生效：

```bash
which node
node --version
apt-get update
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
```

### 13.2 `pnpm: command not found`

```bash
corepack enable
corepack prepare pnpm@10.26.0 --activate
pnpm --version
```

### 13.3 `pm2: command not found`

```bash
npm install --global pm2
pm2 --version
```

### 13.4 `better_sqlite3.node` 加载失败

不要删除数据库，先重新编译当前 Linux 环境的原生依赖：

```bash
cd /root/Memory-Modules-ERP-MES
apt-get install -y build-essential python3 make g++
pnpm install --force
pnpm rebuild better-sqlite3 esbuild
cd apps/api
node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); console.log('better-sqlite3 runtime OK'); db.close()"
```

### 13.5 API 启动失败

```bash
pm2 logs memory-erp-mes-api --err --lines 200
```

重点检查：

- `apps/api/.env` 是否存在且权限为 `600`。
- `NODE_ENV=production` 时是否配置 `INITIAL_ADMIN_PASSWORD`。
- 43127 是否被其他程序占用。
- `apps/api/data` 是否可读写。
- Node.js 主版本与安装依赖时是否一致。

### 13.6 登录请求失败

先分层检查：

```bash
curl http://127.0.0.1:43127/api/health
pm2 status
pm2 logs memory-erp-mes-api --lines 100
curl -I http://127.0.0.1/
```

- API 健康检查失败：检查 PM2、端口、环境变量和 SQLite 原生模块。
- API 健康检查正常但页面请求失败：检查 Caddy `/api/*` 反向代理。
- 页面能打开但提示账号密码错误：核对账号状态和密码。
- 首次登录提示必须修改密码：使用 `INITIAL_ADMIN_PASSWORD` 登录后修改。

### 13.7 端口冲突

```bash
ss -lntp | grep -E ':43127|:80|:443'
```

确认属于本项目的旧进程后优先使用：

```bash
pm2 restart memory-erp-mes-api
```

不要随意执行 `killall node`，以免影响服务器上的其他项目。

### 13.8 前端空白或接口 404

检查：

```bash
test -f /root/Memory-Modules-ERP-MES/apps/web/dist/index.html
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
curl -I http://127.0.0.1/
curl http://127.0.0.1/api/health
```

确认 Caddy 根目录为 `apps/web/dist`，并且 `/api/*` 代理目标为 `127.0.0.1:43127`。SPA 路由必须保留 `try_files {path} /index.html`。

### 13.9 首页返回 HTTP 403

403 通常表示 Caddy 进程没有权限读取 `/root/Memory-Modules-ERP-MES/apps/web/dist`，或 `/etc/caddy/Caddyfile` 的域名没有配置为当前访问域名。依次执行：

```bash
cd /root/Memory-Modules-ERP-MES
grep -n . /etc/caddy/Caddyfile
namei -l /root/Memory-Modules-ERP-MES/apps/web/dist/index.html
test -f apps/web/dist/index.html
```

确认配置第一行是：

```caddyfile
erp.ossgar.com {
```

给 Caddy 只读前端目录权限：

```bash
apt-get install -y acl
setfacl -m u:caddy:--x /root
setfacl -m u:caddy:--x /root/Memory-Modules-ERP-MES
setfacl -m u:caddy:--x /root/Memory-Modules-ERP-MES/apps
setfacl -m u:caddy:--x /root/Memory-Modules-ERP-MES/apps/web
setfacl -R -m u:caddy:rX /root/Memory-Modules-ERP-MES/apps/web/dist
sudo -u caddy test -r /root/Memory-Modules-ERP-MES/apps/web/dist/index.html
```

重新校验并加载：

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
journalctl -u caddy -n 100 --no-pager
curl -I -H 'Host: erp.ossgar.com' http://127.0.0.1/
```

如果日志出现 `permission denied`，继续检查 `/root`、项目目录和 `dist` 目录的权限；不要给 Caddy 开放 `.env` 或 `apps/api/data`。

### 13.10 `better_sqlite3.node` 加载失败

日志中如果出现 `node-v137-linux-x64`、`Cannot find module better_sqlite3.node` 或 `new Database` 启动失败，说明原生模块没有按当前 Linux 的 Node.js 版本安装。API 不会正常启动，Caddy 的 `/api/*` 也无法反代。

```bash
cd /root/Memory-Modules-ERP-MES
node --version
node -p "process.versions.modules"
pnpm --version
apt-get install -y build-essential python3 make g++
corepack prepare pnpm@10.26.0 --activate
hash -r
pnpm install --force
pnpm rebuild better-sqlite3 esbuild
cd apps/api
node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); console.log('better-sqlite3 runtime OK'); db.close()"
```

如果重编译仍失败：

```bash
cd /root/Memory-Modules-ERP-MES
corepack prepare pnpm@10.26.0 --activate
hash -r
pnpm install --force
pnpm rebuild better-sqlite3 esbuild
cd apps/api
node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); console.log('better-sqlite3 runtime OK'); db.close()"
```

确认模块加载成功后，再重启 PM2：

```bash
pm2 status
pm2 restart memory-erp-mes-api --update-env
curl http://127.0.0.1:43127/api/health
pm2 logs memory-erp-mes-api --lines 100
```

如果手动执行 `node -e "require('better-sqlite3')"` 成功，但 PM2 启动后 `curl http://127.0.0.1:43127/api/health` 仍然连接失败，检查 PM2 和当前终端使用的 Node.js 是否一致：

```bash
command -v node
node --version
readlink -f "$(command -v node)"
pm2 report | grep -E "Node.js version|Runtime Binary"
```

如果终端是 Node.js 24、PM2 却显示 Node.js 22，执行：

```bash
cd /root/Memory-Modules-ERP-MES
NODE_BIN="$(readlink -f "$(command -v node)")"
pm2 delete memory-erp-mes-api 2>/dev/null || true
PATH="$(dirname "$NODE_BIN"):$PATH" NODE_BINARY="$NODE_BIN" pm2 start /root/Memory-Modules-ERP-MES/apps/api/dist/index.js \
  --name memory-erp-mes-api \
  --cwd /root/Memory-Modules-ERP-MES/apps/api \
  --interpreter "$NODE_BIN" \
  --node-args="--env-file=/root/Memory-Modules-ERP-MES/apps/api/.env"
pm2 save
curl http://127.0.0.1:43127/api/health
```

## 14. 权限和数据安全

- 系统总管理员只授予少数可信人员。
- 部门经理可以管理被授权的一个或多个部门。
- 普通员工只授予岗位必需的查看、创建和执行权限。
- 角色权限调整后，必须用系统管理员、部门经理、普通员工账号分别验证菜单和接口。
- 库存不允许负库存；库存变化必须通过入库、出库、调拨、盘点或报废单据产生。
- 生产报工必须满足投放、合格、不良、维修合格、维修不良和报废数量平衡。
- 生产工单的暂停、继续、停止、终止、关闭和删除必须遵守状态规则。
- 商品、仓库、库存单据、生产工单、维修和权限修改必须保留审计记录。
- `.env`、SQLite 数据库和备份文件不得放进前端静态目录。
- API 端口只允许本机或内网访问，公网通过 Caddy HTTPS 访问。
- 生产环境不需要安装或运行 Nginx，避免与 Caddy 争用 80/443 端口。

## 15. Windows 本地开发

本节只用于开发人员在 Windows 电脑运行源码，不用于 Linux 生产部署。

安装 Node.js 24 后，在 PowerShell 执行：

```powershell
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm add --global pm2
```

进入项目目录：

```powershell
Set-Location D:\软件开发项目\Memory-Modules-ERP-MES
pnpm install
```

同时启动前后端开发服务器：

```powershell
pnpm dev
```

开发地址：

- 前端：`http://localhost:43128`
- API 健康检查：`http://localhost:43127/api/health`

也可以分开启动，但仅限开发调试：

```powershell
# 后端
pnpm --filter @memory/api dev

# 另开一个 PowerShell 窗口启动前端
pnpm --filter @memory/web dev
```

开发环境的数据库路径为当前 API 工作目录下的 `data/erp-mes.db`。生产环境使用 PM2 配置的 `apps/api` 工作目录，路径为 `/root/Memory-Modules-ERP-MES/apps/api/data/erp-mes.db`。

## 16. 发布前验收

每次发布至少执行：

```bash
cd /root/Memory-Modules-ERP-MES
pnpm typecheck
pnpm build
pm2 restart memory-erp-mes-api --update-env
curl http://127.0.0.1:43127/api/health
```

业务验收至少包括：

- 登录、退出登录、修改初始密码。
- 系统总管理员、部门经理、普通员工的权限边界。
- 商品分类树、商品属性、商品资料和采购价/销售价。
- 仓库地址、仓库类型、库位和库存查询。
- 入库、出库、调拨、盘点、报废及单据预览、打印、下载。
- 生产计划、生产工单、暂停、继续、停止、终止、关闭和删除规则。
- 芯片测试、不良维修、维修进度、维修报废和报废产品。
- 库存余额、库存台账、工单数量平衡和操作审计。

## 17. 发布记录模板

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
