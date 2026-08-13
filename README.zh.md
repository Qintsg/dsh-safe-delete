# dsh-safe-delete

> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）安全删除插件：文件删除时移入回收区而非直接销毁，支持恢复与彻底清除。

> 通过DeepSeek Harness使用Deepseek V4 Flash 0731开发  

[English](./README.md) · [更新日志](./CHANGELOG.md) · [参与贡献](./CONTRIBUTING.md) · [开源协议](./LICENSE)

## 功能特性

- **安全删除**：文件/目录移入回收区（`.dsh-trash/`）而非永久删除。
- **恢复**：将已"删除"的文件恢复到原路径，支持 `rename` / `skip` / `overwrite` 三种冲突策略。
- **彻底清除**：永久清空回收区内容——任何清除操作都需经过审批确认。
- **删除命令劫持**：经 `tools/pre-execute` 钩子拦截 bash/pwsh 中的 `rm` / `Remove-Item`，引导模型改用 `safe_delete`。
- **设置实时生效**：全部选项可在 DSH Web 设置面板中修改，无需重启即生效。
- **人类友好回收区**：`files/` 镜像原始目录结构，任何人都可以直接拖回文件。

## 安装

```bash
pnpm add dsh-safe-delete
```

在 DSH 组合配置中注册插件：

```yaml
plugins:
  dsh-safe-delete:
    $include: node_modules/dsh-safe-delete/lib/index.js
```

## 使用说明

插件注册四个 agent 工具：

| 工具 | 说明 |
|---|---|
| `safe_delete` | 将路径移入回收区（可恢复）。目录需 `recursive: true`；`permanent: true` 时直接真删（需审批）。 |
| `trash_list` | 列出回收区条目，可按 `pattern`（如 `*.tmp`）过滤。 |
| `restore` | 按 `ids` 或 `pattern` 恢复到原路径。`onConflict`：`rename`（默认）/ `skip` / `overwrite`。 |
| `purge` | 永久清除回收区条目（`ids` 或 `all: true`）——始终需审批。 |

系统提示词会引导模型优先使用 `safe_delete` 而非 `rm` / `Remove-Item`。

### 逃生舱（防阻断）

`deleteHijack: block` 拦截删除命令时，模型仍可明确执行永久删除：

```bash
# bash — 强制标记绕过劫持
DSH_FORCE_DELETE=1 rm -rf node_modules

# pwsh
$env:DSH_FORCE_DELETE=1; Remove-Item -Recurse -Force node_modules
```

或走结构化路径：`safe_delete` 加 `permanent: true`。两条路径**仍须审批**——
逃生舱绕过的只是回收区，不是确认环节。

## 回收区结构

```
.dsh-trash/                          # 默认回收区（会话工作区下）
├── files/                           # 人类可读：镜像原始路径
│   ├── src/index.ts                 # 首次删除
│   ├── src/index.ts.20260813T223045 # 同名再次删除（时间戳后缀）
│   └── _external/<id>-<name>/       # 工作区外的文件
├── entries/<id>.json                # 条目元数据
├── manifest.jsonl                   # 索引（可由 entries/ 重建）
└── README.md                        # 人工找回指引
```

手动找回：直接打开 `files/` 把文件拖回原位置即可，无需任何工具。

## 配置项

全部选项可在 **DSH Web → 设置 → safe-delete** 中实时修改。

| 配置 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `trashDir` | string | `''`（工作区 `.dsh-trash`） | 回收区根目录；设置时须为绝对路径 |
| `retentionDays` | number | `30` | 超过该天数的条目自动清理；`0` 关闭 |
| `maxSizeBytes` | number | `5368709120`（5 GiB） | 大小上限，超出后从旧到新清理；`0` 关闭 |
| `confirmThreshold` | number | `10` | 单次删除达到该条数需审批；`0` 始终确认 |
| `restoreConflict` | enum | `rename` | 恢复冲突默认策略：`rename` / `skip` / `overwrite` |
| `deleteHijack` | enum | `block` | 劫持 bash/pwsh 删除命令：`block` / `ask` / `off` |
| `interceptFsDelete` | boolean | `false` | 预留：拦截未来 `ctx.fs` 删除方法 |

## 开发

```bash
pnpm install       # 安装依赖
pnpm test          # 运行单元测试（vitest）
pnpm lint          # 运行 oxlint
pnpm build         # 编译 TypeScript 到 lib/
pnpm typecheck     # 类型检查（host 构建）
```

## 项目结构

```
dsh-safe-delete/
├── src/
│   ├── index.ts        # 插件入口（工具/劫持/settings 接线）
│   ├── config.ts       # 配置 schema
│   ├── hijack.ts       # 删除命令检测（tools/pre-execute）
│   ├── approval.ts     # 审批门禁（ctx.approval）
│   ├── trash/          # paths / manifest / move / ops（纯逻辑）
│   └── tools/          # safe_delete / trash_list / restore / purge
├── tests/              # 单元测试（vitest）
├── docs/design.md      # 设计文档
└── examples/           # 组合配置示例
```

## 开源协议

[Apache-2.0](./LICENSE) © [Qintsg](https://github.com/Qintsg)
