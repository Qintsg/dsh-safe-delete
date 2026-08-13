# 参与贡献（Contributing）

欢迎对本项目贡献代码、文档或反馈问题！请先阅读本指南。

## 行为准则

参与本项目即表示同意遵守 [行为准则](./CODE_OF_CONDUCT.md)。

## 开发环境

- Node.js `^22.19.0 || >=24.0.0`
- pnpm `11.x`（推荐使用 [corepack](https://nodejs.org/api/corepack.html) 启用）

```bash
corepack enable
pnpm install
```

## 常用命令

| 命令             | 说明                         |
| ---------------- | ---------------------------- |
| `pnpm test`      | 运行单元测试（vitest）       |
| `pnpm lint`      | 运行 oxlint 静态检查         |
| `pnpm build`     | 编译 TypeScript 到 `lib/`    |
| `pnpm typecheck` | 类型检查（host 与 client）   |

## 编码规范

- 默认使用简体中文进行交流，代码注释使用简体中文。
- 遵循 `.editorconfig`（UTF-8、LF 换行、2 空格缩进）。
- 所有代码文件需包含文件头注释；函数使用 reStructuredText 风格注释与类型标注。
- 单文件超过 500 行时需拆分解耦；拆分后文件过多时使用文件夹与路由整合。
- 提交前确保 `pnpm lint && pnpm test && pnpm build` 全部通过。

## 提交流程

1. Fork 本仓库并创建特性分支：`feat/xxx` 或 `fix/xxx`。
2. 编写代码与对应单元测试（新功能必须有测试覆盖）。
3. 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范。
4. 发起 Pull Request，填写 [PR 模板](./.github/PULL_REQUEST_TEMPLATE.md)。

## Issue 报告

请使用 [Bug 报告模板](./.github/ISSUE_TEMPLATE/bug_report.yml) 与
[功能建议模板](./.github/ISSUE_TEMPLATE/feature_request.yml) 提交 Issue。
