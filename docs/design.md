# dsh-safe-delete 设计文档

> 版本：v2.1（2026-08-13）· 状态：**已实现**（M1–M5 完成，README 见仓库根目录）
> v2 变更：回收区移至工作区 `.dsh-trash`；新增删除命令劫持（`tools/pre-execute`）；
> 新增 DSH Web 设置面板 + 实时生效（settings 服务）；恢复冲突策略细化。
> v2.1 变更：新增逃生舱设计（`DSH_FORCE_DELETE` 命令标记 + `safe_delete permanent` 参数 + 拒绝引导），防阻断型 bug。

## 1. 目标与范围

让 DSH 中模型执行的文件删除**可逆**：删除时先移入回收区（带元数据），
可恢复、可经确认后彻底清除，避免模型误删造成不可挽回的损失。

- 范围：本地文件系统路径（绝对路径）。
- 非目标：远程后端（workspace URI）、系统回收站集成。

## 2. 总体架构

| 层 | 机制 | 说明 |
|---|---|---|
| 核心 | 独立 agent 工具 | `safe_delete` / `trash_list` / `restore` / `purge`，经 `ctx.tools.register(defineTool(...))` 注册 |
| 引导 | systemPrompt | `ctx.systemPrompt.section` 注入：删除文件应使用 `safe_delete` 而非 `rm`（始终生效） |
| 劫持 | `tools/pre-execute` 钩子 | 检测 bash/pwsh 删除命令（rm / Remove-Item / del / erase / rd / rmdir / unlink 等），按配置 `block`（拒绝并提示）或 `ask`（转人工审批）；`ssh`/`scp` 远程命令完全放行 |
| 配置 | settings 服务 | 注册 `safe-delete` 命名空间，DSH Web 设置面板自动渲染表单，变更实时生效（`watch`） |
| 扩展点 | fs 删除拦截（预留） | 若未来 fs 服务增加删除方法，提供 `interceptFsDelete` 开关（本期不实现） |

## 3. 回收区布局（工作区 .dsh-trash）

默认位置：**三级解析链**——显式配置 `trashDir` 优先，其次当前会话工作区下的
`.dsh-trash/`，最后回退到 **`$DSH_HOME/.dsh-safe-delete-trash/` 全局回收区**
（未分组/无工作区会话，如 `SessionHeader.cwd` 缺失的会话）。全局回收区由
官方 `@deepseek-ai/dsh-home-paths` 的 `dshHomePath()` 解析，所有无工作区
会话共享，四工具同链解析一致；fallback 场景下工具输出标注回收区位置。

```
.dsh-trash/                          # 工作区回收区（建议加入 .gitignore）
├── files/                           # 人类可读区：镜像原始相对路径树
│   ├── src/index.ts                 # 首次删除
│   ├── src/index.ts.20260813T223045 # 同名再次删除：追加删除时间戳后缀
│   └── docs/old-notes.md
├── entries/                         # 条目元数据（机器可读，每删除一次一个文件）
│   └── 20260813T223045-3f2a.json
├── manifest.jsonl                   # 索引缓存（追加式，可由 entries/ 重建）
└── README.md                        # 人类说明：这里是回收区，如何手动找回
```

设计要点：

- **人类回滚**：打开 `files/` 即可看到熟悉的目录树，直接拖回原位置即可
  （结构直观、无需任何工具）。
- **模型回滚**：`trash_list` 读 `manifest.jsonl` → `restore` 按条目 ID 恢复。
- **工作区外文件**（删除目标不在工作区内）：`files/_external/<entryId>-<basename>/`，
  避免 `../` 逃逸相对路径。
- 相对路径由工作区（`exec.agent.session.header.cwd`）解析；工作区不可用时
  全部落入 `_external/`。
- 恢复/清除操作以文件系统实际存在为准，`manifest.jsonl` 损坏或人类手动
  移动过文件时自动降级（按 `entries/*.json` 重建索引）。

### 条目元数据（entries/<entryId>.json）

```jsonc
{
  "id": "20260813T223045-3f2a",
  "originalPath": "E:/Projects/demo/src/index.ts",  // 原始绝对路径
  "trashPath": "src/index.ts",                      // 回收区相对路径（files/ 下）
  "deletedAt": "2026-08-13T22:30:45.123Z",          // 删除时间（ISO）
  "type": "file" | "directory",
  "sizeBytes": 12345,                               // 目录为递归估算
  "sourceSession": "agent-xxx"                      // 来源会话（如有）
}
```

## 4. 工具接口

统一命名空间 `safe_delete`，四个工具：

### 4.1 safe_delete

```jsonc
// 参数
{
  "paths": ["<绝对路径>", ...],       // 必填，1..N 个文件或目录
  "recursive": true,                   // 可选，目录删除需为 true
  "permanent": false                   // 可选，true 时跳过回收区直接真删（仍走审批确认）
}
// 输出
{ "entries": [{ "id", "originalPath", "trashPath", "deletedAt" }], "skipped": [{ "path", "reason" }] }
```

- 不存在/越界的路径记入 `skipped`，不中断整体。
- 单次条目数 ≥ `confirmThreshold`（默认 10）时经审批确认后执行。
- 同名冲突：`files/<relpath>` 已存在 → 追加 `.yyyyMMddTHHmmss` 后缀。
- `permanent: true`：直接永久删除（`purge` 同级不可逆操作，必须经审批确认），
  用于模型明确表达"不要进回收区"的场景（如清理 `node_modules`、构建产物）。

### 4.2 trash_list

```jsonc
// 参数
{ "pattern": "*.tmp", "limit": 50, "sort": "deletedAt" }   // 均可选
// 输出
{ "entries": [{ "id", "originalPath", "trashPath", "deletedAt", "type", "sizeBytes" }], "total": 42 }
```

### 4.3 restore

```jsonc
// 参数
{
  "ids": ["<entryId>", ...],          // 与 pattern 二选一
  "pattern": "*.tmp",
  "onConflict": "rename"              // skip | overwrite | rename（默认取配置 restoreConflict）
}
// 输出
{ "restored": [{ "id", "path" }], "failed": [{ "id", "reason" }] }
```

- 原路径已不存在 → 按原路径恢复。
- 原路径已存在 → 按 `onConflict`：`rename` 自动命名 `name (1).ext`（递增）；
  `skip` 跳过并报告；`overwrite` 覆盖（危险，需确认）。

### 4.4 purge

```jsonc
// 参数
{ "ids": ["<entryId>", ...], "all": false }   // ids 与 all 二选一
// 输出
{ "purged": [{ "id" }], "failed": [{ "id", "reason" }] }
```

- **任何 purge 调用都必须经审批确认**（不可逆操作）。

## 5. 删除命令劫持（tools/pre-execute）

监听 `tools/pre-execute`，当目标工具为 `bash` / `pwsh` 时对 `command`
做删除命令检测（启发式正则，尽力避免误报）：

| 平台 | 检测命令 |
|---|---|
| bash | `rm`、`rmdir`、`unlink`、`del`、`erase`、`rm -rf` 等（词边界匹配，排除注释/引号内文本） |
| pwsh | `Remove-Item`、`del`、`erase`、`rd`、`rmdir`、`rm` 及别名（含 `-Recurse -Force` 组合） |

配置 `deleteHijack`：

| 值 | 行为 |
|---|---|
| `off` | 不检测（仅保留 systemPrompt 引导） |
| `block`（默认） | 检测到删除命令 → `{ kind: 'deny', reason: '请使用 safe_delete 工具…' }` |
| `ask` | 检测到 → `ask` 决策，转 `ctx.approval` 人工确认 |

启发式局限（文档明示）：管道/变量拼接等复杂命令可能漏检；删除命令
写在**脚本文件内部**（`clean.sh` 的 `rm`、`clean.ps1` 的
`Remove-Item`、Node/Python 脚本的删除 API）再执行脚本时，命令文本
不含删除关键字，完全绕过检测；正则检测不构成安全边界，仅作防误删的
辅助手段。systemPrompt 引导模型不将删除写进脚本、优先使用
`safe_delete`。

### 远程命令放行

`ssh` / `scp` 等远程执行客户端**完全放行**，不进入删除检测——远程删除
发生在远端主机，由远端自行管理，本地劫持不干预。判定为命令文本词边界
匹配 `ssh` / `scp`（含 `.exe` 变体），此时整个命令直接放行，无论
引号包裹还是裸 `rm`：

```bash
ssh user@host "rm -rf /var/www"   # 放行
ssh user@host rm -rf /var/www     # 放行
```

边界：引号内的 `ssh` 字样（如 `echo "use ssh"`）不构成远程命令；
子串（如 `wssh`）不命中词边界。该判定与删除检测同为文本级启发式，
不构成安全边界。

### 超大文件容量策略

删除目标总大小超过回收区容量上限（`maxSizeBytes`，默认 5 GiB）时，
回收区放不下，按会话权限执行独立策略（防止无声撑爆回收区）：

| 会话权限（`ctx.sandboxPolicy.resolve()`） | 行为 |
|---|---|
| 非 `danger-full-access`（受限） | 转 `ask` 人工审批（`safe_delete` 路径走 `requestApproval`）；批准即放行永久删除/移入回收区 |
| `danger-full-access`（full access） | 仅携带 `DSH_FORCE_DELETE=1`（或 `safe_delete permanent: true`）时放行永久删除；否则 `deny` 并提示（调大 `maxSizeBytes` / 清空回收区 / 加标记） |

- 劫持路径：解析 `rm`/`Remove-Item` 命令的目标路径（`extractRmTargets`，
  跳过命令词与 flag），对存在路径递归估算大小（`sumTargetSize`），
  与 `maxSizeBytes` 比较后决策。
- 工具路径：`safe_delete` 预检时累计有效条目大小，超限且非 full access
  需审批，full access 拒绝移入回收区并提示。
- 判定为启发式：引号包裹的路径会被空白拆分、管道/变量拼接可能漏检，
  不构成安全边界（文档明示）。
- 权限获取：`ctx.sandboxPolicy`（`dsh-sandbox-policy` 服务）按调用会话
  解析；服务不可用（旧部署）时按受限会话处理（fail-closed → 审批）。

### 逃生舱（防阻断设计）

`block` 模式下模型可能确需永久删除（清理 `node_modules`、清空构建产物），
或 `safe_delete` 因回收区异常失败——若无逃生路径，模型会被卡死在
"想真删却删不掉"的状态，形成阻断型 bug。为此提供三层逃生机制：

1. **命令级强制标记**：命令前缀携带 `DSH_FORCE_DELETE=1` 时检测器放行，
   执行真实删除。
   - bash：`DSH_FORCE_DELETE=1 rm -rf node_modules`
   - pwsh：`$env:DSH_FORCE_DELETE=1; Remove-Item -Recurse -Force node_modules`
   - 标记必须显式（模型不会无意打出），故不会成为常态绕过路径；
     同时是劫持误报时的保险丝。
2. **工具级永久删除**：`safe_delete` 的 `permanent: true`（见 §4.1），
   结构化表达"不进回收区"，仍走审批确认。
3. **拒绝信息引导**：`block` 的 deny reason 明确写出两条逃生路径，
   避免模型被拦后反复重试同一命令形成循环。

逃生路径的永久删除仍受审批约束（见 §7），逃生不等于裸奔。

## 6. 保留策略（惰性清理 + 大小上限）

每次工具操作（safe_delete / restore / purge）前顺带执行 `sweep()`：

1. 删除 `deletedAt` 早于 `now - retentionDays` 的条目（`retentionDays: 0` 表示不过期清理）。
2. 回收区总大小超过 `maxSizeBytes` 时，按 `deletedAt` 从旧到新清除至低于上限。
3. `sweep` 内失败不影响主操作，仅记录日志。
4. 同时校验 `files/` 与索引一致性（人类手动删除后清理孤儿索引）。

## 7. 确认机制

- 触发：任何 `purge`；`safe_delete` 单次条目数 ≥ `confirmThreshold`；`deleteHijack: 'ask'`。
- 机制：`ctx.approval`（实现阶段确认调用接口；`tools/pre-execute` 的 `ask` 决策
  与工具内确认两条路径）。
- `confirmThreshold: 0` 表示始终确认。

## 8. DSH Web 设置面板（设置卡片 + host 路由）

- Host 侧注册命名空间 `safe-delete`（`settingsNamespace` + `installSettingsSection`），
  `applies: 'live'`：配置变更 → `settings/updated` → `watch` → 热重建
  （回收区路径解析、劫持参数、阈值），无需重启。
- **设置卡片（client 半区）**：官方 `settings.plugin.item` 卡片位需插件
  显式注册（非自动渲染）——本插件注册 `id: 'safe-delete'` 卡片，渲染
  7 项配置表单（文本/数字/下拉/开关），文案跟随 DSH 语言（i18n 字典）。
- **读写通道**：`/_dsh/safe-delete/settings` 同源 HTTP 路由
  （GET 快照 / POST 保存），经 settings 服务的 schema + validate 双重校验；
  revision 冲突返回 409、跨源返回 403。
- client 半区构建：tsc（commonjs + react-jsx）→ 多文件合并内联
  （scripts/build-client.mjs）→ `lib/client.js`（ModuleLoader 包装），
  零官方 client 包依赖。

## 8.1 实测验证记录（0.1.x）

- 0.1.2：卡片 + 路由首版（路由注册时序 bug → 0.1.3 修复 inject 等待）
- 0.1.4：i18n 字典（locale 字段修正 → 0.1.6 用 `LocaleSnapshot.active`）
- 0.1.5：多文件打包合并（i18n.ts 引入的 require 解析问题）
- 0.1.7：文案细节修正

## 9. 配置项汇总

| 配置 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `trashDir` | string | `''`（工作区 `.dsh-trash`，无工作区时 `$DSH_HOME/.dsh-safe-delete-trash`） | 回收区根目录（绝对路径或空） |
| `retentionDays` | number | `30` | 保留天数，`0` 不自动过期 |
| `maxSizeBytes` | number | `5368709120`（5 GiB） | 回收区大小上限，`0` 不限 |
| `confirmThreshold` | number | `10` | 单次删除条数确认阈值，`0` 始终确认 |
| `restoreConflict` | enum | `rename` | 恢复冲突默认策略：`rename` / `skip` / `overwrite` |
| `deleteHijack` | enum | `block` | 删除命令劫持：`off` / `block` / `ask` |
| `interceptFsDelete` | boolean | `false` | 预留：fs 删除拦截开关（本期不实现） |

## 10. 模块划分（src/）

```
src/
├── index.ts             # 入口：settings 注册、工具注册、劫持钩子、路由安装
├── config.ts            # 配置 schema + 校验
├── settings-route.ts    # 设置卡片后端路由（GET 快照 / POST 保存，同源校验）
├── hijack.ts            # tools/pre-execute 删除命令检测（bash/pwsh 正则 + 逃生标记）
├── approval.ts          # ctx.approval 确认封装（fail-closed）
├── trash/
│   ├── paths.ts         # 回收区路径解析（三级链：显式 > 工作区 > DSH_HOME）、条目 ID、映射
│   ├── manifest.ts      # entries/meta 读写、索引重建、sweep（惰性清理）
│   ├── move.ts          # 跨盘移动（rename → copy+delete）、Windows 处理
│   └── ops.ts           # safeDelete / restore / purge / list 核心逻辑（纯函数，单测全覆盖）
├── tools/
│   ├── safe-delete.ts
│   ├── trash-list.ts
│   ├── restore.ts
│   └── purge.ts
└── client/              # 浏览器半区（设置卡片）
    ├── index.tsx        # settings.plugin.item 卡片注册 + 表单
    └── i18n.ts          # 中英文案字典（跟随 DSH 语言）
scripts/
└── build-client.mjs     # client 多文件合并打包（ModuleLoader 包装）
```

## 11. 实现阶段计划

- [x] M1：`config.ts` + `trash/paths.ts` + `trash/move.ts` 基础设施（纯函数，单测）
- [x] M2：`trash/manifest.ts` + `trash/ops.ts` 核心操作（safeDelete/restore/purge/list + sweep）
- [x] M3：四个工具注册 + systemPrompt 引导
- [x] M4：`hijack.ts` 删除命令检测 + settings 集成（Web 面板 + 实时生效）
- [x] M5：确认机制（approval）+ 端到端测试
- [x] M6：README 使用文档、examples、发布准备
- [x] M7（追加）：client 设置卡片 + i18n + 发布链路（0.1.x 系列）

## 12. 实现阶段验证点

- [x] `ctx.approval` 的调用接口（工具内确认，fail-closed；`deleteHijack: ask` 决策）
- [x] 设置渲染：`settings.plugin.item` 需显式注册卡片（非自动），已自研卡片 + 路由
- [x] `exec.agent.session.header.cwd` 在工具执行中的可用性（工作区解析 + fallback）
- [x] `deleteHijack` 正则在实际 bash/pwsh 调用中的误报率（含 pwsh 嵌入 bash -c 检测）
