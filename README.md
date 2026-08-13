# dsh-safe-delete

> Safe delete plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): move files into a trash / staging area instead of permanent removal, with restore and purge support.

[中文文档](./README.zh.md) · [Changelog](./CHANGELOG.md) · [Contributing](./CONTRIBUTING.md) · [License](./LICENSE)

## Features

- **Safe delete**: file and directory removals are intercepted and moved into a trash area rather than permanently deleted.
- **Restore**: recover previously "deleted" files back to their original location.
- **Purge**: permanently erase trash contents with an explicit confirmation.
- **Configurable**: trash location, retention policy, and confirmation thresholds are fully configurable.

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

_Coming soon — implementation is in progress._

## Development

```bash
pnpm install       # install dependencies
pnpm test          # run unit tests (vitest)
pnpm lint          # run oxlint
pnpm build         # compile TypeScript to lib/
pnpm typecheck     # type-check both host and client builds
```

## Project Structure

```
dsh-safe-delete/
├── src/            # TypeScript source (host plugin + client half)
│   ├── index.ts    # plugin entry
│   └── client/     # browser-side code (optional)
├── tests/          # unit tests (vitest)
├── docs/           # design and usage documentation
├── examples/       # usage examples
├── .github/        # CI workflows and community templates
└── package.json
```

## License

[MIT](./LICENSE) © [Qintsg](https://github.com/Qintsg)
