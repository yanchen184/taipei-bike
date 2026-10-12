import { test as base, expect, type Page } from '@playwright/test'
import type { DebugRace } from '../../src/game/debug'
import { createRoom, joinRoom } from './helpers'

/** guest、late：另外兩個 browser context 裡的玩家，測試結束時關閉 */
const test = base.extend<{ guest: Page; late: Page }>({
  guest: async ({ browser }, use) => {
    const context = await browser.newContext()
    await use(await context.newPage())
    await context.close()
  },
  late: async ({ browser }, use) => {
    const context = await browser.newContext()
    await use(await context.newPage())
    await context.close()
  },
})

function race(page: Page): Promise<DebugRace | null> {
  return page.evaluate(() => window.__taipei!.race())
}

async function currentRace(page: Page): Promise<DebugRace> {
  const r = await race(page)
  if (!r) throw new Error('還沒有比賽')
  return r
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/** 建房、加入，等兩邊都看到兩位玩家 */
async function roomOfTwo(page: Page, guest: Page): Promise<string> {
  const code = await createRoom(page, '阿明')
  await joinRoom(guest, '小美', code)
  await expect(page.getByTestId('room-player')).toHaveCount(2)
  await expect(guest.getByTestId('room-player')).toHaveCount(2)
  return code
}

/** 房主開一局，等到所有 pages 都進入騎行階段 */
async function startRace(host: Page, ai: number, pages: Page[]): Promise<void> {
  await host.getByTestId('race-ai-count').selectOption(String(ai))
  await host.getByTestId('race-start').click()
  for (const p of pages) await expect.poll(async () => (await race(p))?.view.phase, { timeout: 10_000 }).toBe('racing')
}

/** 瞬移通過每個檢查點直到完成 */
async function finish(page: Page): Promise<void> {
  const { checkpoints } = await currentRace(page)
  for (const [k, c] of checkpoints.entries()) {
    await page.evaluate(([x, z]) => window.__taipei!.teleport(x!, z!), [c.x, c.z])
    await expect.poll(async () => (await currentRace(page)).view.cp).toBe(k + 1)
  }
}

/** page 畫面上另一位玩家的模式與位置 */
async function remote(page: Page, name: string) {
  const all = await page.evaluate(() => window.__taipei!.remotes())
  return all.find((r) => r.name === name) ?? null
}

test.describe('G1 開賽（連線）', () => {
  test('[G1-2] 連線時只有房主看得到開始按鈕，AI 上限為 6 − 房內人數', async ({ page, guest }) => {
    const code = await createRoom(page, '阿明')
    const options = () => page.getByTestId('race-ai-count').locator('option').allTextContents()
    expect(await options()).toEqual(['0', '1', '2', '3', '4', '5'])

    await joinRoom(guest, '小美', code)
    await expect.poll(options).toEqual(['0', '1', '2', '3', '4'])
    await expect(page.getByTestId('race-start')).toBeVisible()
    await expect(guest.getByTestId('race-wait')).toBeVisible()
    await expect(guest.getByTestId('race-start')).toHaveCount(0)
  })
})

test.describe('N1 比賽同步（兩個 browser context）', () => {
  test('[N1-1] 同一局賽道相同、看得到對方騎車、成績表名次一致', async ({ page, guest }, testInfo) => {
    test.setTimeout(120_000)
    await roomOfTwo(page, guest)
    await startRace(page, 0, [page, guest])

    const [mine, theirs] = await Promise.all([currentRace(page), currentRace(guest)])
    expect(theirs.checkpoints).toEqual(mine.checkpoints)
    expect(new Set([mine.slot, theirs.slot]).size).toBe(2)
    await expect.poll(async () => (await remote(guest, '阿明'))?.mode).toBe('bike')
    await expect.poll(async () => (await remote(page, '小美'))?.mode).toBe('bike')
    await page.screenshot({ path: testInfo.outputPath('host-racing.png') })

    await finish(page)
    await finish(guest)
    await expect(page.getByTestId('race-results')).toBeVisible({ timeout: 15_000 })
    await expect(guest.getByTestId('race-results')).toBeVisible({ timeout: 15_000 })
    const rows = (p: Page) => p.getByTestId('race-result-row').allInnerTexts()
    // 伺服器寫入的時間晚於本機記錄送達
    await expect.poll(async () => {
      const [h, g] = await Promise.all([rows(page), rows(guest)])
      return h.join('\n') === g.join('\n')
    }).toBe(true)
    const hostRows = await rows(page)
    expect(hostRows).toHaveLength(2)
    expect(hostRows[0]).toContain('阿明')
    expect(hostRows[1]).toContain('小美')
  })

  test('[N1-2] 其他人畫面上的 AI 跟著房主寫入的位置移動', async ({ page, guest }) => {
    await roomOfTwo(page, guest)
    await startRace(page, 2, [page, guest])
    const start = (await currentRace(guest)).ais
    expect(start).toHaveLength(2)

    // 房主的 AI 每 AI_SEND_MS 送一次，其他人再落後 INTERP_DELAY 內插
    await expect
      .poll(async () => {
        const [h, g] = await Promise.all([currentRace(page), currentRace(guest)])
        const moved = g.ais.every((a, k) => distance(a, start[k]!) > 5)
        const gap = Math.max(...g.ais.map((a, k) => distance(a, h.ais[k]!)))
        return moved && gap < 6
      }, { timeout: 20_000 })
      .toBe(true)
  })

  test('[N1-4] 開賽後才加入的玩家不參賽，但看得到參賽的玩家騎車', async ({ page, guest, late }) => {
    const code = await roomOfTwo(page, guest)
    await startRace(page, 0, [page, guest])
    await joinRoom(late, '阿花', code)
    await expect(late.getByTestId('race-lobby')).toBeVisible()
    expect(await race(late)).toBeNull()
    await expect.poll(async () => (await remote(late, '阿明'))?.mode).toBe('bike')
    await expect.poll(async () => (await remote(late, '小美'))?.mode).toBe('bike')
    expect((await currentRace(page)).view.total).toBe(2)
  })
})
