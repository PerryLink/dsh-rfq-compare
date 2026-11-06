#!/usr/bin/env node
/** Metadata and package-surface lint. No network, no install. */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const read = (file) => readFileSync(file, 'utf8')
const pkg = JSON.parse(read('package.json'))
const problems = []
const check = (ok, message) => {
  if (!ok) problems.push(message)
}

check(pkg.name === 'dsh-rfq-compare', `package name must be dsh-rfq-compare, got ${pkg.name}`)
check(/^\d+\.\d+\.\d+(?:-alpha\.\d+)?$/.test(pkg.version), `unexpected version ${pkg.version}`)
check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch missing')
check(!pkg.dsh?.client, 'this package must not declare a client bundle')
check(existsSync('cordis.patch.yml'), 'cordis.patch.yml is missing')
check(pkg.engines?.node === '>=24.9.0 <25', 'engines.node must be >=24.9.0 <25')
check(pkg.engines?.dsh === '>=0.2.1-rc.3 <0.4.0', 'engines.dsh must be >=0.2.1-rc.3 <0.4.0')
check(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'runtime dependencies must stay empty')
check(pkg.peerDependencies?.['@deepseek-ai/dsh-tools'] === '>=0.2.1-rc.3 <0.4.0', 'dsh-tools peer range is missing')
check(pkg.devDependencies?.typescript === '7.0.2', 'typescript must stay pinned at 7.0.2')

const demo = pkg.dsh?.demo
check(Boolean(demo), 'dsh.demo is missing')
if (demo) {
  for (const key of ['sample', 'expect', 'screenshot']) check(existsSync(demo[key]), `dsh.demo.${key} does not exist: ${demo[key]}`)
  check(typeof demo.prompt === 'string' && demo.prompt.length > 0, 'dsh.demo.prompt is missing')
  check(demo.network === false, 'dsh.demo.network must be false')
  check(Array.isArray(demo.external) && demo.external.length === 0, 'dsh.demo.external must be empty')
  check(Array.isArray(demo.reads) && demo.reads.length > 0, 'dsh.demo.reads is missing')
  check(Array.isArray(demo.writes) && demo.writes.length > 0, 'dsh.demo.writes is missing')
}

const files = pkg.files ?? []
for (const entry of ['samples', 'docs/assets', 'TROUBLESHOOTING.md']) {
  check(files.includes(entry), `files[] must include ${entry}`)
}

const readmeZh = read('README.md')
const readme = read('README.en.md')
const troubleshooting = read('TROUBLESHOOTING.md')
for (const [label, text, patterns] of [
  [
    'README',
    readmeZh,
    [/它是什么/, /适合[\s\S]*不适合/, /输入/, /输出/, /示例/, /权限/, /^#{2,3}\s*FAQ/m, new RegExp(pkg.version.replace(/\./g, '\\.'))],
  ],
  ['README.en', readme, [/What it is/i, /fit/i, /Input/i, /Output/i, /Example/i, /Permission/i, /FAQ/i, new RegExp(pkg.version.replace(/\./g, '\\.'))]],
]) {
  for (const pattern of patterns) check(pattern.test(text), `${label} is missing section matching ${pattern}`)
}
check(/读[:：]/.test(readmeZh), 'README must declare 读：')
check(/写[:：]/.test(readmeZh), 'README must declare 写：')
check(/联网[:：]/.test(readmeZh), 'README must declare 联网：')
check(/外部系统[:：]/.test(readmeZh), 'README must declare 外部系统：')
check(demo?.prompt && readmeZh.includes(demo.prompt.slice(0, 12)), 'README must contain dsh.demo.prompt')

const codeMatches = [...troubleshooting.matchAll(/\bE_RFQ_[A-Z0-9_]+\b/g)].map((match) => match[0])
check(new Set(codeMatches).size >= 3, `TROUBLESHOOTING must list at least 3 E_RFQ_* codes, got ${new Set(codeMatches).size}`)

const srcFiles = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.ts')) srcFiles.push(full)
  }
}
walk('src')
const source = srcFiles.map(read).join('\n')
check(/\bE_RFQ_/.test(source), 'src must define stable E_RFQ_* error codes')
check(!/(^|[^\w.])(fetch\s*\(|axios|http\.request|https\.request|new WebSocket|undici)/.test(source), 'src must not contain network calls')
check(/safeExportPath/.test(source), 'src must use safeExportPath for exports')

const screenshots = JSON.parse(read('screenshots.json'))
check(Array.isArray(screenshots) && screenshots.length > 0, 'screenshots.json must contain at least one entry')
check(screenshots.some((entry) => entry.command && entry.run_at && entry.output_sha256), 'screenshots.json needs command + run_at + output_sha256')
for (const entry of screenshots) {
  if (entry.path) check(existsSync(entry.path), `screenshots.json path does not exist: ${entry.path}`)
  if (entry.log) check(existsSync(entry.log), `screenshots.json log does not exist: ${entry.log}`)
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`lint: ${problem}`)
  process.exit(1)
}
console.log(`lint ok: ${srcFiles.length} source files, ${files.length} published entries`)
