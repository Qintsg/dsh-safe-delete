# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)（SemVer）。

## [0.1.0] - 2026-08-13

### 新增

- **安全删除工具集**：`safe_delete`（移入回收区 / `permanent` 真删）、
  `trash_list`（检索）、`restore`（恢复，三策略冲突处理）、
  `purge`（彻底清除）。
- **回收区**：工作区 `.dsh-trash/`，`files/` 镜像原始目录树（人类可手动
  找回），`entries/` 条目元数据 + `manifest.jsonl` 索引（可重建）。
- **删除命令劫持**：`tools/pre-execute` 检测 bash/pwsh 的
  `rm` / `Remove-Item` 等，`block` / `ask` / `off` 三模式；
  `DSH_FORCE_DELETE=1` 逃生标记放行。
- **审批确认**：`purge` 与 `permanent` 删除强制审批；批量删除达到
  `confirmThreshold` 时审批（fail-closed）。
- **实时设置**：`safe-delete` settings 命名空间，DSH Web 设置面板
  修改即生效（`applies: live`）。
- **惰性清理**：过期条目（`retentionDays`）+ 大小上限（`maxSizeBytes`，
  默认 5 GiB）从旧到新清理；孤儿索引自动校正。
- **平台处理**：跨盘移动回退 copy+delete、Windows 只读属性放开、
  工作区外文件落 `_external/`。
- **基础设施**：TypeScript + pnpm + Vitest + oxlint 工具链，
  CI 工作流，社区文件全套（Contributing / Code of Conduct / Security 等）。
