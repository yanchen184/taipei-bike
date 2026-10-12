import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FLOW_FILE = join(ROOT, 'docs/spec/01-flow.md')
const OUTPUT_FILE = join(ROOT, 'docs/flow-status.md')
const TMP_DIR = join(ROOT, 'node_modules/.tmp')

interface FlowNode {
  id: string
  title: string
  conditions: string[]
}

type ConditionResult = 'passed' | 'failed'

interface VitestReport {
  success: boolean
  testResults: { name: string; status: string; assertionResults: { title: string; status: string }[] }[]
}

interface PlaywrightSuite {
  title: string
  specs: { title: string; ok: boolean }[]
  suites?: PlaywrightSuite[]
}

interface PlaywrightReport {
  suites: PlaywrightSuite[]
  stats: { unexpected: number; flaky: number }
}

/** 一個測試套件的結果：每個測試的標題與是否通過 */
interface SuiteRun {
  label: string
  ok: boolean
  tests: { title: string; passed: boolean }[]
}

function parseFlow(markdown: string): FlowNode[] {
  const nodes: FlowNode[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim())
    const header = cells[1]?.match(/^([ABCDGHKMNPRSV]\d+[a-z]?)\s+(.+)$/)
    if (!header?.[1] || !header[2] || cells[2] === undefined) continue
    const id = header[1]
    const pattern = new RegExp(`(?<![\\w-])${id}-\\d+`, 'g')
    nodes.push({ id, title: header[2], conditions: [...new Set(cells[2].match(pattern) ?? [])] })
  }
  return nodes
}

function run(label: string, args: string[], resultFile: string): unknown {
  mkdirSync(TMP_DIR, { recursive: true })
  rmSync(resultFile, { force: true })
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
  try {
    return JSON.parse(readFileSync(resultFile, 'utf8'))
  } catch {
    throw new Error(`${label} 沒有產生結果（exit ${result.status}）`)
  }
}

function runVitest(label: string, config: string | null): SuiteRun {
  const resultFile = join(TMP_DIR, `vitest-${label}-results.json`)
  const vitest = join(ROOT, 'node_modules/vitest/vitest.mjs')
  const args = [vitest, 'run', '--reporter=json', `--outputFile=${resultFile}`, ...(config ? ['--config', config] : [])]
  const report = run(label, args, resultFile) as VitestReport
  const tests = report.testResults.flatMap((f) =>
    f.assertionResults
      .filter((t) => t.status === 'passed' || t.status === 'failed')
      .map((t) => ({ title: t.title, passed: t.status === 'passed' })),
  )
  return { label, ok: report.success, tests }
}

function flattenSpecs(suites: PlaywrightSuite[]): { title: string; ok: boolean }[] {
  return suites.flatMap((s) => [...s.specs, ...flattenSpecs(s.suites ?? [])])
}

function runPlaywright(label: string, resultName: string, config: string | null): SuiteRun {
  const resultFile = join(TMP_DIR, resultName)
  const cli = join(ROOT, 'node_modules/@playwright/test/cli.js')
  const report = run(label, [cli, 'test', ...(config ? ['--config', config] : [])], resultFile) as PlaywrightReport
  const tests = flattenSpecs(report.suites).map((t) => ({ title: t.title, passed: t.ok }))
  return { label, ok: report.stats.unexpected === 0, tests }
}

function collectResults(runs: SuiteRun[]): Map<string, ConditionResult> {
  const results = new Map<string, ConditionResult>()
  for (const test of runs.flatMap((r) => r.tests)) {
    const prefix = test.title.match(/^(\[[^\]]+\])+/)?.[0] ?? ''
    for (const [, id] of prefix.matchAll(/\[([^\]]+)\]/g)) {
      if (!id || results.get(id) === 'failed') continue
      results.set(id, test.passed ? 'passed' : 'failed')
    }
  }
  return results
}

function nodeStatus(node: FlowNode, results: Map<string, ConditionResult>) {
  const covered = node.conditions.filter((c) => results.has(c))
  const missing = node.conditions.filter((c) => !results.has(c))
  const failed = node.conditions.filter((c) => results.get(c) === 'failed')
  let icon = '⬜'
  if (failed.length > 0) icon = '❌'
  else if (covered.length === node.conditions.length && covered.length > 0) icon = '✅'
  else if (covered.length > 0) icon = '🟡'
  return { icon, covered, missing, failed }
}

function main(): number {
  const nodes = parseFlow(readFileSync(FLOW_FILE, 'utf8'))
  const known = new Set(nodes.flatMap((n) => n.conditions))
  const runs = [runVitest('unit', null), runVitest('emu', 'vitest.emu.config.ts'), runPlaywright('playwright', 'playwright-results.json', null)]
  if (process.env.LIVE_URL) runs.push(runPlaywright('live', 'playwright-live-results.json', 'playwright.live.config.ts'))
  const results = collectResults(runs)

  const unknown = [...results.keys()].filter((id) => !known.has(id))
  if (unknown.length > 0) {
    console.error(`測試中出現 spec 沒有的編號：${unknown.join(', ')}`)
    return 1
  }

  const rows = nodes.map((node) => {
    const s = nodeStatus(node, results)
    return `| ${node.id} ${node.title} | ${s.icon} | ${s.covered.length}/${node.conditions.length} | ${s.missing.join(' ') || '—'} | ${s.failed.join(' ') || '—'} |`
  })
  const output = [
    '# Flow 狀態',
    '',
    '由 `npm run flow:status` 產生，不要手改。判定方式見 [01-flow.md](spec/01-flow.md#驗收怎麼算)。',
    '',
    '| 節點 | 狀態 | 已覆蓋 | 缺測試 | 失敗 |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
  writeFileSync(OUTPUT_FILE, output)
  console.log(output)

  const failedRuns = runs.filter((r) => !r.ok).map((r) => r.label)
  if (failedRuns.length > 0) console.error(`有失敗的測試套件：${failedRuns.join(', ')}`)
  return failedRuns.length === 0 ? 0 : 1
}

process.exit(main())
