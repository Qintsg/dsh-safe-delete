/**
 * 浏览器半区打包脚本：把 tsc 编译产物（可能多文件）合并内联为
 * DSH 浏览器模块（window.__ModuleLoader__.load），输出 lib/client.js。
 * 内部相对引用经微型模块系统惰性解析；外部包（react 等）走外部 require。
 *
 * @project dsh-safe-delete
 * @file build-client.mjs
 * @author Qintsg
 * @date 2026-08-13
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const buildDir = join(root, '.client-build')
const outputPath = join(root, 'lib', 'client.js')

// 收集编译产物（.js 文件，忽略 map），按文件名排序保证确定性。
const files = (await readdir(buildDir))
  .filter((name) => name.endsWith('.js'))
  .toSorted()

if (files.length === 0) {
  throw new Error('no client build output found in .client-build')
}

/** 把一个文件内容包成 CommonJS 模块函数体（剥掉 sourceMappingURL）。 */
async function moduleBodyOf(name) {
  const source = await readFile(join(buildDir, name), 'utf8')
  return source.replace(/\n?\/\/# sourceMappingURL=.*$/u, '')
}

// 构建模块注册表：'./i18n.js' -> { 源码 }。
const entries = []
for (const name of files) {
  const body = await moduleBodyOf(name)
  entries.push(`'./${name}': function (module, exports, require) {\n${body}\n},`)
}

const factory = [
  'window.__ModuleLoader__.load({ id: "dsh-safe-delete", factory: (require) => {',
  'var modules = {',
  entries.join('\n'),
  '};',
  'var cache = {};',
  'function localRequire(name) {',
  '  var key = name.indexOf("./") === 0 ? name : "./" + name;',
  '  if (cache[key]) return cache[key].exports;',
  '  var loader = modules[key];',
  '  if (loader === undefined) return require(name);',
  '  var module = { exports: {} };',
  '  cache[key] = module;',
  '  loader(module, module.exports, localRequire);',
  '  return module.exports;',
  '}',
  'return localRequire("./index.js");',
  '} });',
  '//# sourceMappingURL=client.js.map',
  '',
].join('\n')

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, factory)

// sourceMap 指向主入口（近似定位即可）。
const rawMap = JSON.parse(await readFile(join(buildDir, 'index.js.map'), 'utf8'))
rawMap.file = 'client.js'
rawMap.sources = rawMap.sources.map(sourcePath => `../src/client/${sourcePath.replace(/^\.\.\//u, '')}`)
await writeFile(`${outputPath}.map`, `${JSON.stringify(rawMap)}\n`)
await rm(buildDir, { recursive: true, force: true })
