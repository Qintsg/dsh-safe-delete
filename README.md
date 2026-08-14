# dsh-safe-delete

> Safe delete plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): move files into a trash area instead of permanent removal, with restore and purge support.

> Developed by Deepseek V4 Flash 0731 with DeepSeek Harness

[中文文档](./README.zh.md) · [Changelog](./CHANGELOG.md) · [Contributing](./CONTRIBUTING.md) · [License](./LICENSE)

## Features

- **Safe delete**: files and directories are moved into a trash area (`.dsh-trash/`) instead of being permanently deleted.
- **Restore**: recover "deleted" files back to their original paths, with `rename` / `skip` / `overwrite` conflict strategies.
- **Purge**: permanently erase trash contents — always behind an approval prompt.
- **Delete-command hijacking**: intercepts `rm` / `Remove-Item` in bash/pwsh via the `tools/pre-execute` hook and guides the model to `safe_delete` instead. `ssh` / `scp` remote commands are **fully allowed** (not intercepted).
- **Oversize capacity guard**: when the total target size exceeds the trash capacity (`maxSizeBytes`, default 5 GiB) — restricted (non-full-access) sessions require approval; full-access sessions need `DSH_FORCE_DELETE=1` to permanently delete, otherwise the command is blocked with guidance.
- **Workspace-less fallback**: sessions without a workspace fall back to a global trash at `$DSH_HOME/.dsh-safe-delete-trash`.
- **Settings card with i18n**: a configuration card in DSH Web → Settings → Plugins, fully localized (zh/en), applied live without restart.
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

### Remote commands are fully allowed

`ssh` / `scp` remote clients are **never intercepted** — remote deletion happens on the remote host and is managed by the remote side, so the local hijack does not interfere:

```bash
# The following remote deletions are NOT intercepted (quoted or bare)
ssh user@host "rm -rf /var/www"
ssh user@host rm -rf /var/www
```

Note: any command whose text contains `ssh` / `scp` (word-boundary match) is allowed as a whole; an `ssh` word inside quotes (e.g. `echo "use ssh"`) does not count as a remote command.

### Oversize capacity guard

When the total target size exceeds the trash capacity limit (`maxSizeBytes`, default 5 GiB), deletion follows a session-permission policy to protect the trash from being blown up:

| Session permission | Behavior |
|---|---|
| Restricted (non-full-access) | Routes to **approval** (approval authorizes permanent deletion / moving to trash) |
| Full access + `DSH_FORCE_DELETE=1` | **Allowed** (permanent delete, skips the trash) |
| Full access without the marker | **Blocked with guidance** (use the marker, raise `maxSizeBytes`, or use `safe_delete`) |

The `safe_delete` tool is guarded the same way: oversize targets are not silently moved into the trash — restricted sessions need approval; full-access sessions are rejected with guidance (use `permanent: true`, or adjust `maxSizeBytes`).

Size detection is heuristic (command-path parsing + recursive estimation); complex commands built with pipes or variables may be missed — this is not a security boundary.

> **Detection limitation**: the hijack is a command-text heuristic — delete commands written **inside script files** (e.g. `rm` in `clean.sh`, `Remove-Item` in `clean.ps1`, or delete APIs in Node/Python scripts) are **NOT** intercepted when the script runs, because the executed command text contains no delete keyword. The system prompt guides the model to prefer `safe_delete` and not to put deletions into scripts.

## Trash layout

Trash location resolution (three levels): explicit `trashDir` → workspace `.dsh-trash` → global `$DSH_HOME/.dsh-safe-delete-trash` (workspace-less sessions).

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

All options are editable live in **DSH Web → Settings → Plugins → Safe Delete** (card is localized to the DSH language).

| Option | Type | Default | Description |
|---|---|---|---|
| `trashDir` | string | `''` (workspace `.dsh-trash`, or `$DSH_HOME/.dsh-safe-delete-trash` without a workspace) | Trash root; must be an absolute path when set. |
| `retentionDays` | number | `30` | Auto-expire entries older than this; `0` disables. |
| `maxSizeBytes` | number | `5368709120` (5 GiB) | Trash size cap; deletions whose target exceeds it trigger the capacity guard (approval/block by permission); `0` disables. |
| `confirmThreshold` | number | `10` | Batch deletions at/above this count require approval; `0` always confirms. |
| `restoreConflict` | enum | `rename` | Default restore conflict strategy: `rename` / `skip` / `overwrite`. |
| `deleteHijack` | enum | `block` | Hijack delete commands in bash/pwsh: `block` / `ask` / `off` (`ssh`/`scp` remote commands always allowed). |
| `interceptFsDelete` | boolean | `false` | Reserved: intercept future `ctx.fs` delete methods. |

## Development

```bash
pnpm install       # install dependencies
pnpm test          # run unit tests (vitest)
pnpm lint          # run oxlint
pnpm build         # compile host + client halves to lib/
pnpm typecheck     # type-check both host and client builds
```

## Project Structure

```
dsh-safe-delete/
├── src/
│   ├── index.ts        # plugin entry (tools, hijack, settings wiring, route install)
│   ├── config.ts       # config schema
│   ├── settings-route.ts # settings card backend route (GET/POST)
│   ├── hijack.ts       # delete-command detection (tools/pre-execute)
│   ├── approval.ts     # approval gate (ctx.approval)
│   ├── trash/          # paths / manifest / move / ops (pure logic)
│   ├── tools/          # safe_delete / trash_list / restore / purge
│   └── client/         # browser half: settings card + i18n
├── scripts/build-client.mjs  # client bundle (ModuleLoader wrapper)
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
