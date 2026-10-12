import { expect, test, type Page } from '@playwright/test'
import type { DebugRace } from '../../src/game/debug'
import { snapshot, startSolo } from './helpers'

function race(page: Page): Promise<DebugRace | null> {
  return page.evaluate(() => window.__taipei!.race())
}

async function currentRace(page: Page): Promise<DebugRace> {
  const r = await race(page)
  if (!r) throw new Error('還沒有比賽')
  return r
}

function hasObject(page: Page, name: string): Promise<boolean> {
  return page.evaluate((n) => window.__taipei!.hasObject(n), name)
}

/** 單人開一局，等到倒數結束 */
async function startRace(page: Page, ai: number): Promise<DebugRace> {
  await page.getByTestId('race-ai-count').selectOption(String(ai))
  await page.getByTestId('race-start').click()
  await expect(page.getByTestId('race-cp')).toBeVisible()
  await expect.poll(async () => (await race(page))?.view.phase, { timeout: 8_000 }).toBe('racing')
  return currentRace(page)
}

/** 瞬移通過第 from 個之後的每個檢查點，直到完成 */
async function passCheckpoints(page: Page, from: number, to: number): Promise<void> {
  const { checkpoints } = await currentRace(page)
  for (let k = from; k < to; k++) {
    const c = checkpoints[k]!
    await page.evaluate(([x, z]) => window.__taipei!.teleport(x!, z!), [c.x, c.z])
    await expect.poll(async () => (await currentRace(page)).view.cp).toBe(k + 1)
  }
}

/** 與起跑格中心的容許距離，小於起跑格之間距離的一半 */
const GRID_SLACK = 1.5

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

test.describe('G1 開賽', () => {
  test('[G1-1] 單人可選 0–5 台 AI，開賽後玩家在起跑格騎上腳踏車，AI 在其餘起跑格', async ({ page }) => {
    await startSolo(page)
    const options = await page.getByTestId('race-ai-count').locator('option').allTextContents()
    expect(options).toEqual(['0', '1', '2', '3', '4', '5'])

    await page.getByTestId('race-ai-count').selectOption('3')
    await page.getByTestId('race-start').click()
    await expect(page.getByTestId('race-countdown')).toBeVisible()

    const r = await currentRace(page)
    const s = await snapshot(page)
    expect(s.player.mode).toBe('bike')
    expect(distance(s.player.pos, r.grid[r.slot]!.pos)).toBeLessThan(GRID_SLACK)
    const others = r.grid.filter((_, k) => k !== r.slot)
    expect(r.ais).toHaveLength(3)
    const taken = r.ais.map((ai) => others.findIndex((g) => distance(ai, g.pos) < GRID_SLACK))
    expect(taken.every((k) => k >= 0)).toBe(true)
    expect(new Set(taken).size).toBe(3)
  })
})

test.describe('G2 倒數與騎行', () => {
  test('[G2-1] 倒數中按 W 不會移動，倒數結束後可以騎', async ({ page }) => {
    await startSolo(page)
    await page.getByTestId('race-ai-count').selectOption('0')
    await page.keyboard.down('w')
    await page.getByTestId('race-start').click()
    // 在頁面內逐幀取樣，避免每次 evaluate 的延遲跨過 3 秒倒數
    const samples = await page.evaluate(
      () =>
        new Promise<{ phase: string; speed: number; x: number; z: number }[]>((resolve) => {
          const out: { phase: string; speed: number; x: number; z: number }[] = []
          let go: { x: number; z: number; at: number } | null = null
          const tick = () => {
            const t = window.__taipei!
            const r = t.race()
            const p = t.state().player
            if (r) {
              out.push({ phase: r.view.phase, speed: p.bike?.speed ?? 0, x: p.pos.x, z: p.pos.z })
              if (r.view.phase === 'racing') go ??= { x: p.pos.x, z: p.pos.z, at: performance.now() }
            }
            const done = go !== null && (Math.hypot(p.pos.x - go.x, p.pos.z - go.z) > 3 || performance.now() - go.at > 10_000)
            if (done) resolve(out)
            else requestAnimationFrame(tick)
          }
          tick()
        }),
    )
    await page.keyboard.up('w')

    const countdown = samples.filter((x) => x.phase === 'countdown')
    expect(countdown.length).toBeGreaterThan(1)
    expect(countdown.every((x) => x.speed === 0)).toBe(true)
    expect(distance(countdown.at(-1)!, countdown.at(1)!)).toBeLessThan(0.01)
    expect(distance(samples.at(-1)!, countdown.at(-1)!)).toBeGreaterThan(3)
  })

  test('[G2-2] HUD 顯示檢查點 x / N、經過時間與名次', async ({ page }) => {
    await startSolo(page)
    const r = await startRace(page, 2)
    const n = r.checkpoints.length
    await expect(page.getByTestId('race-cp')).toHaveText(`檢查點 0 / ${n}`)
    await expect(page.getByTestId('race-rank')).toHaveText(/^第 [1-3] \/ 3 名$/)
    await expect(page.getByTestId('race-time')).not.toHaveText('0:00.0')
    await passCheckpoints(page, 0, 1)
    await expect(page.getByTestId('race-cp')).toHaveText(`檢查點 1 / ${n}`)
  })

  test('[G2-3] 場景中標出下一個檢查點', async ({ page }) => {
    await startSolo(page)
    const r = await startRace(page, 0)
    expect(distance(r.marker!, r.checkpoints[0]!)).toBeLessThan(0.01)
    await passCheckpoints(page, 0, 1)
    await expect.poll(async () => distance((await currentRace(page)).marker!, r.checkpoints[1]!)).toBeLessThan(0.01)
  })

  test('[G2-4] 按 R 回到最後通過的檢查點', async ({ page }) => {
    await startSolo(page)
    const r = await startRace(page, 0)
    await passCheckpoints(page, 0, 1)
    const away = r.checkpoints[0]!
    await page.evaluate(([x, z]) => window.__taipei!.teleport(x! + 20, z!), [away.x, away.z])
    await page.keyboard.press('r')
    await expect.poll(async () => distance((await snapshot(page)).player.pos, r.checkpoints[0]!)).toBeLessThan(CHECKPOINT_SLACK)
    expect((await snapshot(page)).player.bike!.speed).toBe(0)
  })
})

/** 重生點在檢查點附近（依起跑格錯開），不一定剛好在中心 */
const CHECKPOINT_SLACK = 8

test.describe('G4 比賽結束', () => {
  test('[G4-2] 成績表顯示名次、名字（AI n）、完成時間或未完成', async ({ page }) => {
    test.setTimeout(120_000)
    await startSolo(page, '小明')
    const r = await startRace(page, 1)
    await passCheckpoints(page, 0, r.checkpoints.length)
    await expect(page.getByTestId('race-finished')).toBeVisible()

    await expect(page.getByTestId('race-results')).toBeVisible({ timeout: 45_000 })
    const rows = page.getByTestId('race-result-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('1')
    await expect(rows.nth(0)).toContainText('小明')
    await expect(rows.nth(0)).toContainText(/\d+:\d{2}\.\d/)
    await expect(rows.nth(1)).toContainText('AI 1')
    await expect(rows.nth(1)).toContainText(/未完成|\d+:\d{2}\.\d/)
  })

  test('[G4-3] 按「回到城市」回到自由逛街，玩家在腳踏車旁步行、車在原處', async ({ page }) => {
    await startSolo(page)
    const car = (await snapshot(page)).player.car.pos
    const r = await startRace(page, 0)
    await passCheckpoints(page, 0, r.checkpoints.length)
    await expect(page.getByTestId('race-results')).toBeVisible()

    await page.getByTestId('race-back').click()
    await expect(page.getByTestId('race-lobby')).toBeVisible()
    const s = await snapshot(page)
    expect(s.player.mode).toBe('walk')
    expect(distance(s.player.pos, s.player.bike!.pos)).toBeLessThan(3)
    expect(distance(s.player.car.pos, car)).toBeLessThan(0.01)
  })

  test('[G4-4] 比賽中按「退出比賽」回到自由逛街，該局記為未完成', async ({ page }) => {
    await startSolo(page)
    await startRace(page, 2)
    await page.getByTestId('race-quit').click()
    await expect(page.getByTestId('race-lobby')).toBeVisible()
    await expect(page.getByTestId('race-hud')).toHaveCount(0)
    expect((await snapshot(page)).player.mode).toBe('walk')
    expect((await currentRace(page)).view.finished).toBe(false)
  })

  test('[G4-5] 切到競速模式再切回時，場景物件與 HUD 全部移除', async ({ page }) => {
    await startSolo(page)
    expect(await hasObject(page, 'race-scene')).toBe(false)
    await startRace(page, 2)
    expect(await hasObject(page, 'race-scene')).toBe(true)
    expect(await hasObject(page, 'race-ai-0')).toBe(true)

    await page.getByTestId('race-quit').click()
    await expect(page.getByTestId('race-hud')).toHaveCount(0)
    await expect.poll(() => hasObject(page, 'race-scene')).toBe(false)
    expect(await hasObject(page, 'race-checkpoint')).toBe(false)
    expect(await hasObject(page, 'race-ai-0')).toBe(false)
  })
})
