# dsh-safe-delete

> Safe delete plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): move files into a trash area instead of permanent removal, with restore and purge support.

> Developed by Deepseek V4 Flash 0731 with DeepSeek Harness

[中文文档](./README.zh.md) · [Changelog](./CHANGELOG.md) · [Contributing](./CONTRIBUTING.md) · [License](./LICENSE)

## Features

- **Safe delete**: files and directories are moved into a trash area (`.dsh-trash/`) instead of being permanently deleted.
- **Restore**: recover "deleted" files back to their original paths, with `rename` / `skip` / `overwrite` conflict strategies.
- **Purge**: permanently erase trash contents — always behind an approval prompt.
- **Delete-command hijacking**: intercepts `rm` / `Remove-Item` in bash/pwsh via the `tools/pre-execute` hook and guides the model to `safe_delete` instead.
- **Live settings**: all options are editable in the DSH Web settings panel and take effect immediately, no restart.
- **Human-friendly trash**: `files/` mirrors the original directory tree, so anyone can drag files back manually.

## Install

```bash
pnpm add dsh-safe-delete
```

Register the plugin in your DSH composition:

```yaml
plugins:
  dsh-safe-delete:
    $include: node_modules/dsh-safe-delete/lib/index.js
```

## Usage

The plugin registers four agent tools:

| Tool | Description |
|---|---|
| `safe_delete` | Move paths into the trash (restorable). `recursive: true` for directories; `permanent: true` to delete irreversibly (requires approval). |
| `trash_list` | List trash entries, optionally filtered by `pattern` (`*.tmp`). |
| `restore` | Restore entries by `ids` or `pattern` back to their original paths. `onConflict`: `rename` (default) / `skip` / `overwrite`. |
| `purge` | Permanently delete trash entries (`ids` or `all: true`) — always requires approval. |

A system-prompt section guides the model to prefer `safe_delete` over `rm` / `Remove-Item`.

### Escape hatch

When `deleteHijack: block` intercepts a delete command, the model can still delete permanently on purpose:

```bash
# bash — force marker bypasses the hijack
DSH_FORCE_DELETE=1 rm -rf node_modules

# pwsh
$env:DSH_FORCE_DELETE=1; Remove-Item -Recurse -Force node_modules
```

Or use the structured path: `safe_delete` with `permanent: true`. Both paths still require approval — the escape hatch bypasses the trash, not the confirmation.

## Trash layout

```
.dsh-trash/                          # default trash root (session workspace)
├── files/                           # human-readable: mirrors original paths
│   ├── src/index.ts                 # first deletion
│   ├── src/index.ts.20260813T223045 # same-name re-deletion (timestamp suffix)
│   └── _external/<id>-<name>/       # files outside the workspace
├── entries/<id>.json                # per-entry metadata
├── manifest.jsonl                   # index (rebuildable from entries/)
└── README.md                        # human instructions
```

To recover files manually, open `files/` and drag them back — no tooling required.

## Configuration

All options are editable live in **DSH Web → Settings → safe-delete**.

| Option | Type | Default | Description |
|---|---|---|---|
| `trashDir` | string | `''` (workspace `.dsh-trash`) | Trash root; must be an absolute path when set. |
| `retentionDays` | number | `30` | Auto-expire entries older than this; `0` disables. |
| `maxSizeBytes` | number | `5368709120` (5 GiB) | Size cap; oldest entries are swept first; `0` disables. |
| `confirmThreshold` | number | `10` | Batch deletions at/above this count require approval; `0` always confirms. |
| `restoreConflict` | enum | `rename` | Default restore conflict strategy: `rename` / `skip` / `overwrite`. |
| `deleteHijack` | enum | `block` | Hijack delete commands in bash/pwsh: `block` / `ask` / `off`. |
| `interceptFsDelete` | boolean | `false` | Reserved: intercept future `ctx.fs` delete methods. |

## Development

```bash
pnpm install       # install dependencies
pnpm test          # run unit tests (vitest)
pnpm lint          # run oxlint
pnpm build         # compile TypeScript to lib/
pnpm typecheck     # type-check the host build
```

## Project Structure

```
dsh-safe-delete/
├── src/
│   ├── index.ts        # plugin entry (tools, hijack, settings wiring)
│   ├── config.ts       # config schema
│   ├── hijack.ts       # delete-command detection (tools/pre-execute)
│   ├── approval.ts     # approval gate (ctx.approval)
│   ├── trash/          # paths / manifest / move / ops (pure logic)
│   └── tools/          # safe_delete / trash_list / restore / purge
├── tests/              # unit tests (vitest)
├── docs/design.md      # design document
├── docs/releasing.md   # release guide (OIDC publishing)
└── examples/           # composition examples
```

## Releasing

Releases are published automatically via GitHub Actions with npm trusted
publishing (OIDC) — no tokens, no OTP. See [docs/releasing.md](./docs/releasing.md).

## License

[Apache-2.0](./LICENSE) © [Qintsg](https://github.com/Qintsg)
