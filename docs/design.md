# dsh-safe-delete 设计文档

> 版本：v1（2026-08-13）· 状态：设计讨论中

## 1. 目标与范围

让 DSH 中模型执行的文件删除**可逆**：删除时先移入回收区（带元数据），
可恢复、可经确认后彻底清除，避免模型误删造成不可挽回的损失。

- 范围：本地文件系统路径（绝对路径）。
- 非目标：远程后端（workspace URI）、系统回收站集成。

## 2. 总体架构：混合拦截

现实约束：DSH 的 `ctx.fs` 服务**只有读写方法**（readText/streamText/writeText/edit/
stat/listDir/resolve），**没有删除与移动方法**；文件删除发生在终端工具
（bash `rm` / pwsh `Remove-Item`）中，无法安全解析拦截。

因此混合方案落地为三层：

| 层 | 机制 | 说明 |
|---|---|---|
| 核心 | 独立 agent 工具 | `safe_delete` / `trash_list` / `restore` / `purge`，经 `ctx.tools.register(defineTool(...))` 注册 |
| 软拦截 | systemPrompt 引导 | 通过 `ctx.systemPrompt.section` 注入使用指导：删除文件应使用 `safe_delete` 而非 `rm`（官方同款做法，如 read 工具的 "not shell commands like cat"） |
| 扩展点 | fs 删除拦截开关（预留） | 若未来 fs 服务增加删除方法，提供配置开关 `interceptFsDelete` 包装拦截；本期不实现 |

## 3. 回收区布局（自建 + manifest 驱动）

默认位置：`$DSH_HOME/trash`（可用配置 `trashDir` 覆盖）。

```
trash/
├── entries/
│   └── <entryId>/
│       ├── meta.json      # 条目元数据（自包含，损坏只影响单条目）
│       └── data/          # 被删除的文件/目录（保留原名与结构）
├── manifest.jsonl         # 索引缓存（追加式，可由 entries/ 重建）
└── .gitkeep
```

- `entryId`：毫秒时间戳 + 随机后缀（如 `20260813T223045-3f2a`），保证唯一。
- 同一卷内 `rename` 原子移动；跨卷（EXDEV）回退 **copy + delete**。
- 每个条目自包含 `meta.json`，`manifest.jsonl` 仅作索引，损坏时可重建。

### 条目元数据（meta.json）

```jsonc
{
  "id": "20260813T223045-3f2a",
  "originalPath": "E:/Projects/demo/old-file.txt",  // 原始绝对路径
  "deletedAt": "2026-08-13T22:30:45.123Z",          // 删除时间（ISO）
  "type": "file" | "directory",
  "sizeBytes": 12345,                                // 目录为递归估算
  "sourceSession": "agent-xxx"                       // 来源会话（如有）
}
```

## 4. 工具接口

统一命名空间 `safe_delete`，四个工具：

### 4.1 safe_delete

移入回收区（核心工具）。

```jsonc
// 参数
{
  "paths": ["<绝对路径>", ...],       // 必填，1..N 个文件或目录
  "recursive": true                    // 可选，目录删除需为 true
}
// 输出
{ "entries": [{ "id", "originalPath", "deletedAt" }], "skipped": [{ "path", "reason" }] }
```

- 不存在/越界（沙箱拒绝）的路径记入 `skipped`，不中断整体。
- 单次条目数 ≥ `confirmThreshold` 时需确认（见 §6）。

### 4.2 trash_list

查看回收区（恢复前的检索）。

```jsonc
// 参数
{ "pattern": "*.tmp", "limit": 50 }   // 均可选；pattern 匹配 originalPath 尾部
// 输出
{ "entries": [{ "id", "originalPath", "deletedAt", "type", "sizeBytes" }] }
```

### 4.3 restore

恢复条目到原路径。

```jsonc
// 参数
{
  "ids": ["<entryId>", ...],          // 与 pattern 二选一
  "pattern": "*.tmp",
  "onConflict": "rename"              // skip | overwrite | rename（默认 rename）
}
// 输出
{ "restored": [{ "id", "path" }], "failed": [{ "id", "reason" }] }
```

- 原路径已存在时按 `onConflict` 处理；`rename` 自动追加 ` (1)` 后缀。
- 原路径已不存在时按原路径恢复。

### 4.4 purge

彻底清除（不可逆，强制确认）。

```jsonc
// 参数
{ "ids": ["<entryId>", ...], "all": false }   // ids 与 all 二选一
// 输出
{ "purged": [{ "id" }], "failed": [{ "id", "reason" }] }
```

- 必须经确认机制批准后才执行（见 §6）。

## 5. 保留策略（惰性清理 + 大小上限）

在每次工具操作（safe_delete / restore / purge）前顺带执行 `sweep()`：

1. 删除 `deletedAt` 早于 `now - retentionDays` 的条目（`retentionDays: 0` 表示不过期清理）。
2. 若回收区总大小超过 `maxSizeBytes`，按 `deletedAt` 从旧到新清除，直到低于上限。
3. `sweep` 内失败不影响主操作，仅记录日志。

配置默认值：`retentionDays: 30`、`maxSizeBytes: 5 GiB`（可配 0 表示不限）。

## 6. 确认机制

- **触发条件**：`safe_delete` 单次条目数 ≥ `confirmThreshold`（默认 10），或任何 `purge` 调用。
- **机制**：经 DSH 审批服务（`@deepseek-ai/dsh-user-approval`，实现阶段确认接口）发起确认请求；拒绝则操作不执行。
- `confirmThreshold: 0` 表示始终确认。

## 7. 平台处理

- **跨盘移动**：`rename` 抛 `EXDEV` 时回退 copy + delete（校验校验和后删除源）。
- **Windows**：大小写不敏感路径比较（恢复冲突检测）；只读文件移入回收区前去除只读属性。
- **符号链接**：删除符号链接本身，不跟随目标。
- 尽力保留 mtime/权限位。

## 8. 配置项汇总

| 配置 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `trashDir` | string | `''`（= `$DSH_HOME/trash`） | 回收区根目录 |
| `retentionDays` | number | `30` | 保留天数，`0` 不自动过期 |
| `maxSizeBytes` | number | `5 GiB` | 回收区大小上限，`0` 不限 |
| `confirmThreshold` | number | `10` | 单次删除条数阈值，`0` 始终确认 |
| `interceptFsDelete` | boolean | `false` | 预留：fs 删除拦截开关（本期不实现） |

## 9. 模块划分（src/）

```
src/
├── index.ts          # 入口：name/inject/Config/apply，注册工具与 systemPrompt
├── config.ts         # 配置 schema + 校验
├── paths.ts          # 回收区路径解析、条目 ID 生成、路径规范化
├── manifest.ts       # manifest.jsonl 读写、条目扫描、sweep（惰性清理）
├── move.ts           # 跨盘移动（rename → copy+delete）、Windows 处理
├── tools/
│   ├── safe-delete.ts
│   ├── trash-list.ts
│   ├── restore.ts
│   └── purge.ts
└── errors.ts         # 错误类型（回收区损坏、路径越界等）
```

## 10. 实现阶段计划

- [ ] M1：`paths.ts` + `manifest.ts` + `move.ts` 基础设施（纯函数，单测全覆盖）
- [ ] M2：`safe_delete` 工具 + systemPrompt 引导 + 惰性清理
- [ ] M3：`trash_list` / `restore` / `purge` 工具
- [ ] M4：确认机制接入（approval）+ 端到端测试
- [ ] M5：README 使用文档、examples、发布准备

## 11. 开放问题

- [ ] 确认机制的具体接口（`@deepseek-ai/dsh-user-approval` 的调用方式）
- [ ] 沙箱配合：safe_delete 是否应尊重 fs 沙箱边界（实现阶段查 `ctx.fs.sandboxMode`）
- [ ] `sourceSession` 是否采集（需要 session 服务注入）
