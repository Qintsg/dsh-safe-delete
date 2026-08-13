# dsh-safe-delete 设计文档

> 版本：v2.1（2026-08-13）· 状态：设计定稿，待实现
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
| 劫持 | `tools/pre-execute` 钩子 | 检测 bash/pwsh 删除命令（rm / Remove-Item / del / erase / rd / rmdir / unlink 等），按配置 `block`（拒绝并提示）或 `ask`（转人工审批） |
| 配置 | settings 服务 | 注册 `safe-delete` 命名空间，DSH Web 设置面板自动渲染表单，变更实时生效（`watch`） |
| 扩展点 | fs 删除拦截（预留） | 若未来 fs 服务增加删除方法，提供 `interceptFsDelete` 开关（本期不实现） |

## 3. 回收区布局（工作区 .dsh-trash）

默认位置：**当前会话工作区下的 `.dsh-trash/`**（配置 `trashDir` 可覆盖为任意绝对路径）。

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

启发式局限（文档明示）：管道/变量拼接等复杂命令可能漏检；正则检测
不构成安全边界，仅作防误删的辅助手段。

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

## 8. DSH Web 设置面板（settings 集成）

- 注册命名空间 `safe-delete`（`settingsNamespace('safe-delete')`），
  schema 经 `describe()` 由 DSH Web 内置设置面板**自动渲染表单**。
- `applies: 'live'`（实时生效）：配置变更 → `settings/updated` → `watch`
  回调 → 热重建（回收区路径解析、劫持参数、阈值）。
- 使用官方 `installSettingsSection` 辅助：settings 服务缺失时回退到组合配置。
- 实现阶段验证点：确认 dsh-web-app 内置设置面板确实渲染该命名空间。

## 9. 配置项汇总

| 配置 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `trashDir` | string | `''`（工作区 `.dsh-trash`） | 回收区根目录（绝对路径或空） |
| `retentionDays` | number | `30` | 保留天数，`0` 不自动过期 |
| `maxSizeBytes` | number | `5368709120`（5 GiB） | 回收区大小上限，`0` 不限 |
| `confirmThreshold` | number | `10` | 单次删除条数确认阈值，`0` 始终确认 |
| `restoreConflict` | enum | `rename` | 恢复冲突默认策略：`rename` / `skip` / `overwrite` |
| `deleteHijack` | enum | `block` | 删除命令劫持：`off` / `block` / `ask` |
| `interceptFsDelete` | boolean | `false` | 预留：fs 删除拦截开关（本期不实现） |

## 10. 模块划分（src/）

```
src/
├── index.ts          # 入口：settings 注册、工具注册、劫持钩子、systemPrompt
├── config.ts         # 配置 schema + 校验
├── trash/
│   ├── paths.ts      # 回收区路径解析（工作区解析、条目 ID、相对路径映射）
│   ├── manifest.ts   # entries/meta 读写、索引重建、sweep（惰性清理）
│   ├── move.ts       # 跨盘移动（rename → copy+delete）、Windows 处理
│   └── ops.ts        # safeDelete / restore / purge / list 核心逻辑（纯函数，单测全覆盖）
├── hijack.ts         # tools/pre-execute 删除命令检测（bash/pwsh 正则表 + DSH_FORCE_DELETE 逃生标记识别）
├── approval.ts       # ctx.approval 确认封装
└── tools/
    ├── safe-delete.ts
    ├── trash-list.ts
    ├── restore.ts
    └── purge.ts
```

## 11. 实现阶段计划

- [ ] M1：`config.ts` + `trash/paths.ts` + `trash/move.ts` 基础设施（纯函数，单测）
- [ ] M2：`trash/manifest.ts` + `trash/ops.ts` 核心操作（safeDelete/restore/purge/list + sweep）
- [ ] M3：四个工具注册 + systemPrompt 引导
- [ ] M4：`hijack.ts` 删除命令检测 + settings 集成（Web 面板 + 实时生效）
- [ ] M5：确认机制（approval）+ 端到端测试
- [ ] M6：README 使用文档、examples、发布准备

## 12. 实现阶段验证点

- [ ] `ctx.approval` 的调用接口（工具内确认 vs pre-execute ask）
- [ ] dsh-web-app 内置设置面板是否自动渲染 `safe-delete` 命名空间
- [ ] `exec.agent.session.header.cwd` 在工具执行中的可用性（工作区解析）
- [ ] `deleteHijack` 正则在实际 bash/pwsh 调用中的误报率
