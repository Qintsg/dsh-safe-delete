# dsh-safe-delete

> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）安全删除插件：文件删除时移入回收区而非直接销毁，支持恢复与彻底清除。

[English](./README.md) · [更新日志](./CHANGELOG.md) · [参与贡献](./CONTRIBUTING.md) · [开源协议](./LICENSE)

## 功能特性

- **安全删除**：拦截文件/目录删除操作，移入回收区而非永久删除。
- **恢复**：将已"删除"的文件恢复到原始位置。
- **彻底清除**：经明确确认后，永久清空回收区内容。
- **可配置**：回收区位置、保留策略、确认阈值等均可配置。

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

_开发中，敬请期待。_

## 开发

```bash
pnpm install       # 安装依赖
pnpm test          # 运行单元测试（vitest）
pnpm lint          # 运行 oxlint
pnpm build         # 编译 TypeScript 到 lib/
pnpm typecheck     # 类型检查（host 与 client 双端）
```

## 项目结构

```
dsh-safe-delete/
├── src/            # TypeScript 源码（host 插件 + client 半区）
│   ├── index.ts    # 插件入口
│   └── client/     # 浏览器端代码（可选）
├── tests/          # 单元测试（vitest）
├── docs/           # 设计与使用文档
├── examples/       # 使用示例
├── .github/        # CI 工作流与社区模板
└── package.json
```

## 开源协议

[MIT](./LICENSE) © [Qintsg](https://github.com/Qintsg)
