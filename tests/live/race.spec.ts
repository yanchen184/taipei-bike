import { test as base, expect, type Page } from '@playwright/test'
import type { DebugRace } from '../../src/game/debug'
import { createRoom, joinRoom, snapshot, startSolo } from '../e2e/helpers'

/** guest：另一個 browser context 裡的玩家，測試結束時關閉 */
const test = base.extend<{ guest: Page }>({
  guest: async ({ browser }, use) => {
    const context = await browser.newContext()
    await use(await context.newPage())
    await context.close()
  },
})

async function currentRace(page: Page): Promise<DebugRace> {
  const r = await page.evaluate(() => window.__taipei!.race())
  if (!r) throw new Error('還沒有比賽')
  return r
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/** 開一局，所有 pages 進入整備站並看到賽道預覽；單人按「出發」，連線等 20 秒整備，直到所有 pages 都進入騎行階段 */
async function startRace(host: Page, ai: number, pages: Page[]): Promise<void> {
  await host.getByTestId('race-ai-count').selectOption(String(ai))
  await host.getByTestId('race-start').click()
  for (const p of pages) await expect(p.getByTestId('workshop-map')).toBeVisible({ timeout: 15_000 })
  if (pages.length === 1) await host.getByTestId('race-go').click()
  for (const p of pages) await expect.poll(async () => (await currentRace(p)).view.phase, { timeout: 40_000 }).toBe('racing')
}

/** 瞬移通過第 from 個之後的每個檢查點 */
async function passCheckpoints(page: Page, from: number, to: number): Promise<void> {
  const { checkpoints } = await currentRace(page)
  for (let k = from; k < to; k++) {
    const c = checkpoints[k]!
    await page.evaluate(([x, z]) => window.__taipei!.teleport(x!, z!), [c.x, c.z])
    await expect.poll(async () => (await currentRace(page)).view.cp).toBe(k + 1)
  }
}

async function finish(page: Page): Promise<void> {
  await passCheckpoints(page, 0, (await currentRace(page)).checkpoints.length)
}

test('[S2-1] 線上單人開一局含 AI 的比賽，倒數後騎出起跑格並通過第一個檢查點', async ({ page }, testInfo) => {
  await startSolo(page, '線上驗收')
  await startRace(page, 2, [page])
  const r = await currentRace(page)
  expect(r.ais).toHaveLength(2)
  const grid = r.grid[r.slot]!.pos

  await page.keyboard.down('w')
  await expect.poll(async () => distance((await snapshot(page)).player.pos, grid), { timeout: 10_000 }).toBeGreaterThan(3)
  await page.keyboard.up('w')
  await page.screenshot({ path: testInfo.outputPath('riding.png') })

  await passCheckpoints(page, 0, 1)
  await expect(page.getByTestId('race-cp')).toHaveText(`檢查點 1 / ${r.checkpoints.length}`)
})

test('[S2-2] 線上兩個瀏覽器同一局比賽，看到彼此與同一組 AI，完賽後兩邊的成績表一致', async ({ page, guest }, testInfo) => {
  test.setTimeout(180_000)
  const code = await createRoom(page, '房主')
  await joinRoom(guest, '來賓', code)
  await expect(page.getByTestId('room-player')).toHaveCount(2)
  await startRace(page, 2, [page, guest])

  const [mine, theirs] = await Promise.all([currentRace(page), currentRace(guest)])
  expect(theirs.checkpoints).toEqual(mine.checkpoints)
  for (const [p, name] of [[page, '來賓'], [guest, '房主']] as const) {
    await expect.poll(async () => {
      const them = (await p.evaluate(() => window.__taipei!.remotes())).find((x) => x.name === name)
      return them?.mode
    }).toBe('bike')
  }

  // 兩邊畫出的 AI 是同一組：都畫出來，且位置相近（來賓的畫面落後房主一次同步與內插）
  const drawn = (p: Page) => p.evaluate(() => [0, 1].map((k) => window.__taipei!.shown(`race-ai-${k}`)))
  await expect
    .poll(async () => {
      const [h, g] = await Promise.all([drawn(page), drawn(guest)])
      if ([...h, ...g].some((a) => a === null)) return Infinity
      return Math.max(...g.map((a, k) => distance(a!, h[k]!)))
    }, { timeout: 20_000 })
    .toBeLessThan(6)
  await guest.screenshot({ path: testInfo.outputPath('guest-racing.png') })

  await finish(page)
  await finish(guest)
  const rows = (p: Page) => p.getByTestId('race-result-row').allInnerTexts()
  // AI 沒騎完時，比賽在第一位完成後 30 秒結束；伺服器寫入的完成時間晚於本機記錄送達
  await expect.poll(async () => {
    const [h, g] = await Promise.all([rows(page), rows(guest)])
    return h.length === 4 && h.join('\n') === g.join('\n')
  }, { timeout: 45_000 }).toBe(true)
  await guest.screenshot({ path: testInfo.outputPath('guest-results.png') })
})
