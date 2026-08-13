# 发版指南（Releasing）

> 本文档说明 dsh-safe-delete 的版本管理与发布流程。
> 发布通道：**GitHub Actions + npm trusted publishing（OIDC）**——
> 无需 token、无需 OTP，自动生成 provenance 签名。

## 版本号规则

遵循[语义化版本](https://semver.org/lang/zh-CN/)（SemVer）：

| 变更类型 | 示例 | 版本 |
|---|---|---|
| 破坏性变更 / 主版本 | `0.1.0` → `1.0.0` | 主版本 +1 |
| 新功能（向后兼容） | `0.1.0` → `0.2.0` | 次版本 +1 |
| Bug 修复（向后兼容） | `0.1.0` → `0.1.1` | 补丁 +1 |

**铁律**：`package.json` 的 `version` 与 git tag **必须一致**（`v` 前缀 + 版本号，
如 `v0.1.1`）。CI 会校验，不一致直接失败。

## 发版流程（标准路径）

### 1. 更新版本与变更记录

```bash
# 编辑 package.json：version → 0.1.1
# 同时在 CHANGELOG.md 顶部添加 [0.1.1] 条目（Keep a Changelog 格式）
```

### 2. 提交并推送代码

```bash
git add package.json CHANGELOG.md
git commit -m "chore: bump version to 0.1.1"
git push origin main
```

### 3. 打 tag 并推送（触发发布）

```bash
git tag v0.1.1
git push origin v0.1.1
```

### 4. 等待 CI 自动完成

[GitHub Actions](https://github.com/Qintsg/dsh-safe-delete/actions) 中
`Publish` workflow 依次执行：

```
Verify tag matches package version → Lint → Test → Build → npm publish
```

发布成功输出 `+ dsh-safe-delete@0.1.1`。

### 5. 验证发布

```bash
npm view dsh-safe-delete version
npm view dsh-safe-delete dist-tags --json
# 校验 provenance 签名
npm audit signatures
```

## 发布机制说明

### Trusted publishing（OIDC）

- CI 通过 GitHub Actions 的 **OIDC 短期凭证** 认证发布（`permissions: id-token: write`），
  **不存在任何长寿命 token**，泄露面为零。
- 前提：npmjs.com 包设置页已配置 Trusted Publisher
  （`Qintsg/dsh-safe-delete` + workflow `release.yml` + 允许 `npm publish`）。
- 每次发布自动生成 **Sigstore provenance 签名**（源码来源可验证）。

### 手动发布（备用路径）

仅在 CI 不可用时的应急手段（需要交互式 2FA）：

```bash
npm publish --registry https://registry.npmjs.org
```

## 常见问题

| 问题 | 处理 |
|---|---|
| `You cannot publish over the previously published versions: x.y.z` | 版本已存在。**bump 版本号**后重试；npm 不允许覆盖已发布版本 |
| `Verify tag matches package version` 失败 | tag 与 `package.json` version 不一致，检查 `v` 前缀与版本号 |
| `ENEEDAUTH` / 认证失败 | Trusted Publisher 配置不匹配：检查 npmjs.com 上的 owner/repo/workflow 文件名是否与仓库完全一致（区分大小写） |
| 想撤回错误版本 | npm **不支持覆盖**。用 `npm deprecate` 标记弃用，或发新版本修复 |
| 测试版发布 | 用 prerelease 版本号（如 `0.2.0-rc.1`）并打对应 tag |

## 安全检查（可选但推荐）

```bash
# 校验所有已安装包的签名与 provenance
npm audit signatures
```

## 相关链接

- npm trusted publishing 文档：https://docs.npmjs.com/trusted-publishers
- npm provenance 文档：https://docs.npmjs.com/generating-provenance-statements
- 发布 workflow 源码：`.github/workflows/release.yml`
- 2FA-bypass token 弃用公告：https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/
