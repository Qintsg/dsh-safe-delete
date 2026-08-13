# AGENTS.md

本项目为 **DeepSeek Harness（DSH）安全删除插件** 的源码仓库。

## 项目概览

- **名称**：dsh-safe-delete
- **类型**：DSH 插件（Cordis/Node.js 生态）
- **技术栈**：TypeScript + pnpm + Vitest + oxlint
- **构建产物**：`lib/`（host）与 `lib/client/`（client 半区，可选）

## 常用命令

```bash
pnpm install       # 安装依赖
pnpm test          # 运行单元测试（vitest）
pnpm lint          # 运行 oxlint
pnpm build         # 编译 TypeScript 到 lib/
pnpm typecheck     # 类型检查（host 与 client 双端）
```

## 语言要求

- 默认使用简体中文进行对话，代码注释使用简体中文。
- README 保持中英双语：`README.md`（英文）+ `README.zh.md`（中文）。

## 编码规范

- 除特殊说明外，使用 UTF-8 编码、LF 换行（参见 `.editorconfig`）。
- 所有代码文件需要有文件头注释；函数使用 reStructuredText 风格注释和类型标注。
- 单文件超过 500 行时默认需要拆分解耦；拆分后文件过多时使用文件夹整合。
- 新功能必须有对应的单元测试（`tests/`，vitest）。

## 目录结构

```
src/            # TypeScript 源码
  index.ts      # 插件入口（host 半区）
  config.ts     # 配置 schema（schemastery）
  client/       # 浏览器端代码（client 半区，可选）
tests/          # 单元测试
docs/           # 设计与使用文档
examples/       # 使用示例
.github/        # CI 工作流与社区模板
```

## 架构约定

- 插件通过 `peerDependencies` 依赖 `cordis`、`schemastery`、`@deepseek-ai/dsh-agent`。
- Host 半区提供 Service / Tool；Client 半区通过 Slot 注册浏览器 UI。
- 所有 Service、Tool、事件监听、定时器必须注册到当前 Fiber，可逆释放。

## 官方文档（重点参考）

- 插件开发入门：https://deepseek-harness.github.io/deepseek-harness/develop/basic/
- 工具定义 DSL：https://deepseek-harness.github.io/deepseek-harness/develop/basic/tool
- 插件配置：https://deepseek-harness.github.io/deepseek-harness/develop/basic/config
- 官方源码（实现细节以源码为准）：https://github.com/deepseek-ai/deepseek-harness
