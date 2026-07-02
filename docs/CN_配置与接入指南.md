# Tesla MCP 中国区配置与接入指南

本文档记录 **中国区（CN）Tesla Fleet API** 从零到接入小智 MCP Broker 的完整流程。  
基于 fork：[phil-QS/tesla-mcp](https://github.com/phil-QS/tesla-mcp)（上游：[scald/tesla-mcp](https://github.com/scald/tesla-mcp)）。

---

## 零、先看这段（部署 + Token + 注册总结）

把流程分成三层最不容易混淆：

1. **应用级一次性**：`get-token` + `register`
2. **每辆车一次性**：Tesla App 完成第三方应用/虚拟钥匙配对
3. **日常运行**：启动 `tesla-http-proxy`（本机 4443）+ 启动 `mcp_broker.js`

### 0.1 最小命令清单（按顺序）

```powershell
# tesla-mcp
npm install
npm run get-token
npm run register
npm run build
npm run test-api

# Vehicle Command 代理（控车需要）
# Windows：npm run command-proxy:setup && npm run command-proxy
# Linux：node scripts/generate-proxy-tls.mjs && docker compose -f docker-compose.command-proxy.yml up -d

# mcd_mcp
node mcp_broker.js
```

### 0.2 Token 怎么获取

1. 在 `tesla-mcp/.env` 配置：
   - `TESLA_REGION=CN`
   - `TESLA_CLIENT_ID`
   - `TESLA_CLIENT_SECRET`
   - `TESLA_REDIRECT_URI`（通常 `http://localhost:3000/callback`）
2. 在 [developer.tesla.cn](https://developer.tesla.cn) 把 Redirect URI 配成和 `.env` 完全一致。
3. 运行 `npm run get-token`，浏览器授权后，脚本会把 `TESLA_REFRESH_TOKEN` 写回 `.env`。

### 0.3 注册怎么做（register）

1. `npm run register` 会生成 `keys/private-key.pem` 与 `keys/public-key.pem`。
2. 需要让 Tesla 能访问：
   `https://你的域名/.well-known/appspecific/com.tesla.3p.public-key.pem`
3. register 成功后，通常同一个 Client ID 不用重复注册。

### 0.4 三个关键证书/密钥文件分别是什么

- `keys/private-key.pem`：Tesla 控车签名私钥（最关键，泄露要立即轮换）。
- `config/tls-key.pem`：`tesla-http-proxy` 本地 HTTPS 私钥。
- `config/tls-cert.pem`：`tesla-http-proxy` 本地 HTTPS 证书。

### 0.5 端口与暴露策略（重要）

- `3000`（get-token 回调）和 `4000`（register 服务）只在初始化阶段需要。
- `4443` 是 `tesla-http-proxy` 本机端口，**不需要暴露公网**（建议仅 `127.0.0.1`）。
- 生产环境长期需要公网可访问的是公钥 URL（`.well-known/...public-key.pem`），不是 4443。

---

## 一、整体架构

```
小智设备 ──WebSocket──► mcp_broker.js (mcd_mcp)
                              │
                              ├── stdio ──► tesla-mcp (本地子进程)
                              ├── streamablehttp ──► 瑞幸 my-coffee
                              ├── sse ──► mcdonalds-mcp (可选，需单独启动)
                              └── local ──► geo_amap 高德搜 POI
```

- **tesla-mcp** 由 Broker 以 **stdio** 方式拉起，无需单独 `npm start`。
- 凭证写在 `tesla-mcp/.env`，**不要提交到 Git**（已在 `.gitignore` 中）。

---

## 二、前置条件

| 项目 | 说明 |
|------|------|
| Node.js | 18+ |
| OpenSSL | 用于 `register` 生成 EC 密钥对 |
| Tesla 账号 | 中国区账号，[developer.tesla.cn](https://developer.tesla.cn) 已创建应用 |
| 车辆 | 账号下已绑定车辆（无车时 API 可连上但返回 0 辆车） |
| 花生壳 / 内网穿透 | **仅 register 阶段**需要，将本机 4000 端口映射到公网 HTTPS 域名 |
| mcp_market 仓库 | `tesla-mcp` 与 `mcd_mcp` 在同一父目录下 |

---

## 三、安装与构建

```powershell
# 克隆 fork（或已在 mcp_market 工作区内则跳过）
git clone https://github.com/phil-QS/tesla-mcp.git
cd tesla-mcp

npm install
npm run build
```

---

## 四、在 Tesla 开发者平台创建应用

1. 打开 [https://developer.tesla.cn](https://developer.tesla.cn)，登录中国区 Tesla 账号。
2. 创建应用（示例名称：`xatom`），记下 **Client ID** 和 **Client Secret**。
3. 配置 **允许的重定向 URI**（get-token 用）：
   ```
   http://localhost:3000/callback
   ```
   必须与 `get-token` 脚本使用的地址**完全一致**（含协议、端口、路径）。
4. register 阶段还需在开发者后台填写 **Allowed Origin** 为花生壳公网地址（见第六节）。

---

## 五、配置 `.env`

在 `tesla-mcp` **根目录**（不是 `src/`）创建 `.env`：

```env
TESLA_REGION=CN
TESLA_CLIENT_ID=你的Client_ID
TESLA_CLIENT_SECRET=你的Client_Secret
TESLA_REFRESH_TOKEN=                          # 下一步 get-token 自动写入
```

可选变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TESLA_CALLBACK_PORT` | `3000` | OAuth 本地回调端口 |
| `TESLA_REDIRECT_URI` | `http://localhost:3000/callback` | 与开发者后台重定向 URI 一致 |

中国区 API 端点（由 `TESLA_REGION=CN` 自动选择，无需手写）：

- 认证：`https://auth.tesla.cn/oauth2/v3`
- Fleet API：`https://fleet-api.prd.cn.vn.cloud.tesla.cn`

---

## 六、获取 Refresh Token（`get-token`）

```powershell
cd tesla-mcp
npm run get-token
```

流程：

1. 终端打印授权 URL，浏览器自动打开（或手动复制打开）。
2. 使用**有车**的 Tesla 中国区账号登录并授权。
3. 浏览器跳转到 `http://localhost:3000/callback?code=...`。
4. 脚本将 `TESLA_REFRESH_TOKEN` 写入 `.env`（中国区 token 通常以 `CN_` 开头）。

**常见问题：**

- `redirect_uri mismatch` → 检查 developer.tesla.cn 中重定向 URI 是否与 `TESLA_REDIRECT_URI` 一致。
- `.env` 未更新 → 确认 `.env` 在 `tesla-mcp/` 根目录，而非 `src/.env`。

---

## 七、注册应用（`register`）

Fleet API 要求第三方应用完成 **Partner 注册**（上传公钥域名）。只需在**应用级别做一次**，同一 Client ID 下多个车主换 `REFRESH_TOKEN` 时**不必重复 register**。

### 7.1 准备花生壳

1. 安装并登录 [花生壳](https://hsk.oray.com/)（或其他内网穿透）。
2. 将公网 HTTPS 域名映射到本机 **4000** 端口（register 服务默认端口）。
3. 记下公网地址，例如：`https://eh6ow6848595.vicp.fun`

### 7.2 运行注册

```powershell
cd tesla-mcp
npm run register
```

脚本会：

1. 在 `tesla-mcp/keys/` 生成 EC 密钥对（已 gitignore）。
2. 在本机 4000 端口启动 HTTP 服务，暴露公钥路径：
   ```
   https://你的域名/.well-known/appspecific/com.tesla.3p.public-key.pem
   ```
3. 提示你去 developer.tesla.cn 更新 **Allowed Origin** 为花生壳地址。
4. 确认后调用 Tesla Partner API 完成注册。

**注册成功标志：** 终端输出 `Application registered successfully with Tesla API!`

**说明：** `This account does not have access to xxx.vicp.fun` 在注册前出现属正常；注册完成后日常控车**不需要**保持花生壳和 4000 端口在线。

---

## 八、验证 API 连接

```powershell
npm run test-api
```

**期望输出（有车且已授权）：**

```
Tesla region: CN, fleet API: https://fleet-api.prd.cn.vn.cloud.tesla.cn
Success! Connected to Tesla API.
Found 1 vehicle(s):
...
```

**当前无车 / 未授权时：**

```
Success! Connected to Tesla API.
Found 0 vehicle(s):
```

这表示 **OAuth 已成功**，但账号下没有可供 Fleet API 访问的车辆。下周有车的同事只需重新 `get-token` + Tesla App 内授权车辆即可。

### 车辆授权（有车后必做）

1. 打开 **Tesla App**（中国区）。
2. 进入 **安全** → **第三方应用**，找到你的应用（如 `xatom`）。
3. 勾选要控制的车辆。
4. 按 App 提示完成 **虚拟密钥** 配对（中国区 Fleet API 要求）。

---

## 九、接入 mcp_broker（小智）

### 9.1 目录结构

```
mcp_market/
├── mcd_mcp/
│   ├── mcp_broker.js
│   ├── mcp_market.json
│   └── xiaozhi_config.json
└── tesla-mcp/
    ├── .env
    ├── build/index.js
    └── keys/
```

### 9.2 `mcp_market.json` 配置

`mcd_mcp/mcp_market.json` 中已包含：

```json
"tesla-mcp": {
  "type": "stdio",
  "command": "node",
  "args": ["build/index.js"],
  "cwd": "../tesla-mcp",
  "envFile": ".env"
}
```

- `cwd` 相对 `mcp_broker.js` 所在目录。
- `envFile` 相对于 `cwd`，即 `tesla-mcp/.env`。

### 9.3 启动 Broker

```powershell
cd mcp_market/mcd_mcp
node mcp_broker.js
```

**正常日志示例：**

```
[Broker] ✅ [my-coffee] (StreamableHTTP) 接入成功！共提供 8 个工具
[Broker] ✅ [tesla-mcp] (stdio) 接入成功！共提供 3 个工具
[Broker-xxx] 响应: 已动态将 12 个授权工具 (全部) 推送给小智
```

| 工具来源 | 数量 | 说明 |
|----------|------|------|
| my-coffee | 8 | 瑞幸点单 |
| tesla-mcp | 3 | `wake_up` / `refresh_vehicles` / `debug_vehicles` |
| geo_amap | 1 | 高德搜 POI（Broker 内置） |
| mcdonalds-mcp | 若干 | 需另开 `node mcdonalds.js`（3002 端口） |

> **注意：** 若 API 返回 0 辆车，tesla-mcp 的 `listTools` 会返回 **0 个工具**，小智侧看不到 Tesla 工具。有车并授权后重启 Broker 即可出现 3 个工具。

### 9.4 小智 Agent 角色配置

将 `mcd_mcp/tesla_skill_prompt.md` 的内容**手动粘贴**到小智 Agent 的角色设定 / 技能说明中（Broker 不会自动推送该文件）。

---

## 十、多用户使用说明

| 层级 | 是否支持多用户 | 说明 |
|------|----------------|------|
| 小智多设备 | ✅ | `xiaozhi_config.json` 的 `devices` 数组，每台设备独立 token |
| Tesla 控车 | ⚠️ 单账号 | 当前一份 `tesla-mcp/.env` 只绑定一个 `TESLA_REFRESH_TOKEN` |

**同事有车时（推荐流程）：**

1. **Client ID / Secret 不变**（共用开发者应用）。
2. **register 一般不必重做**（应用级注册一次即可）。
3. 同事用自己的账号执行 `npm run get-token`，更新 `.env` 中的 `TESLA_REFRESH_TOKEN`。
4. 在 Tesla App 中授权其车辆。
5. `npm run test-api` 确认 `Found N vehicle(s)`，重启 Broker。

若要 **多人同时各控各的车**，需扩展 Broker：按设备配置不同 `.env` 或每人独立部署一套 Broker。

---

## 十一、验收清单

| 步骤 | 命令 / 操作 | 通过标准 |
|------|-------------|----------|
| 1 | developer.tesla.cn 创建应用 | 拿到 Client ID / Secret |
| 2 | 填写 `.env` | `TESLA_REGION=CN` 等 |
| 3 | `npm run get-token` | `.env` 出现 `CN_...` refresh token |
| 4 | `npm run register` | 注册成功， `keys/` 有密钥 |
| 5 | `npm run build` | `build/index.js` 存在 |
| 6 | `npm run test-api` | `Success! Connected` |
| 7 | `node mcp_broker.js` | tesla-mcp stdio 接入成功 |
| 8 | 小智 tools/list | 含 Tesla 工具（有车后） |
| 9 | 粘贴 `tesla_skill_prompt.md` | Agent 能正确调用工具 |

---

## 十二、故障排查

### OAuth / Token

| 现象 | 处理 |
|------|------|
| `redirect_uri mismatch` | 对齐 developer.tesla.cn 与 `TESLA_REDIRECT_URI` |
| Token 刷新失败 | 重新 `get-token`；确认 `TESLA_REGION=CN` |
| `.env` 不生效 | 文件必须在 `tesla-mcp/` 根目录 |

### 车辆

| 现象 | 处理 |
|------|------|
| `Found 0 vehicle(s)` | Tesla App 授权第三方应用 + 虚拟密钥；确认登录账号有车 |
| Broker 显示 tesla **0 个工具** | 同上；有车后重启 Broker |
| `Application is not registered` | 执行 `npm run register` |

### Broker

| 现象 | 处理 |
|------|------|
| `mcdonalds-mcp ECONNREFUSED 3002` | 在 `mcd_mcp` 运行 `node mcdonalds.js`，或从 `mcp_market.json` 移除该项 |
| tesla stdio 启动失败 | 先 `npm run build`；检查 `cwd` 路径 |

### 安全

- **切勿**将 `.env`、`keys/` 提交到 Git。
- Client Secret、Refresh Token 泄露后应在开发者后台轮换并重新 `get-token`。
- 推送前可运行：`./check-secrets.sh`（Linux/macOS）或人工确认 git status 无敏感文件。

---

## 十三、Vehicle Command 控车（锁门 / 空调 / 鸣笛）

2024 年起新车必须通过 [Vehicle Command Protocol](https://github.com/teslamotors/vehicle-command) 发控车命令。tesla-mcp 通过官方 **tesla-http-proxy** 实现。

### 首次配置

```powershell
cd tesla-mcp
npm run command-proxy:setup   # 生成 config/tls-cert.pem（需 OpenSSL）
npm run command-proxy         # Docker 启动代理，监听 https://127.0.0.1:4443
```

前提：`keys/private-key.pem` 已存在（`npm run register`），Docker Desktop 已安装。

### 新增 MCP 工具（有车时共 12 个）

| 工具 | 说明 |
|------|------|
| `check_command_proxy` | 检查代理是否在线 |
| `get_vehicle_data` | 电量、续航、空调状态 |
| `door_lock` / `door_unlock` | 锁门 / 解锁 |
| `honk_horn` / `flash_lights` | 鸣笛 / 闪灯 |
| `climate_on` / `climate_off` | 开空调 / 关空调 |
| `set_climate_temp` | 设置温度（driver_temp °C） |

### 调试

```powershell
npm run test-command              # 默认 flash_lights
npm run test-command -- honk_horn
```

`.env` 可选：

```env
TESLA_COMMAND_PROXY_URL=https://127.0.0.1:4443
TESLA_COMMAND_PROXY_CA=config/tls-cert.pem
TESLA_COMMAND_MODE=proxy          # proxy | direct | proxy-only
```

重启 Broker 后小智应看到 **12 个 Tesla 工具**（原 3 个 + 9 个控车相关）。

---

## 十四、常用命令速查

```powershell
cd tesla-mcp

npm install          # 安装依赖
npm run get-token    # OAuth 获取 refresh token
npm run register     # Partner 注册（需花生壳）
npm run build        # 编译 TypeScript
npm run test-api     # 测试 API 与车辆列表
npm run test-command # 测试 Vehicle Command 代理
npm run command-proxy:setup
npm run command-proxy  # 启动控车代理（需 Docker）
npm start            # 单独运行 MCP（调试用；Broker 场景不需要）

cd ../mcd_mcp
node mcp_broker.js   # 启动小智 MCP 桥接
```

---

## 十四、相关文件

| 路径 | 用途 |
|------|------|
| `tesla-mcp/.env` | Tesla 凭证（不提交） |
| `tesla-mcp/keys/` | 注册密钥对（不提交） |
| `tesla-mcp/src/teslaRegion.ts` | CN/NA/EU 区域配置 |
| `mcd_mcp/mcp_market.json` | 下游 MCP 服务列表 |
| `mcd_mcp/xiaozhi_config.json` | 小智设备与瑞幸等 per-device 配置 |
| `mcd_mcp/tesla_skill_prompt.md` | 小智 Agent 技能说明（需手动粘贴） |

---

*文档版本：2026-06-26 · 基于中国区实机跑通流程整理*
