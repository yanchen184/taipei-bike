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

/** 單人開一局，進到整備站 */
async function openWorkshop(page: Page, ai: number): Promise<void> {
  await page.getByTestId('race-ai-count').selectOption(String(ai))
  await page.getByTestId('race-start').click()
  await expect(page.getByTestId('race-workshop')).toBeVisible()
}

/** 單人開一局，在整備站直接按「出發」，等到倒數結束 */
async function startRace(page: Page, ai: number): Promise<DebugRace> {
  await openWorkshop(page, ai)
  await page.getByTestId('race-go').click()
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

    await openWorkshop(page, 3)
    await page.getByTestId('race-go').click()
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
    await openWorkshop(page, 0)
    await page.keyboard.down('w')
    await page.getByTestId('race-go').click()
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

  test('[G2-6] 比賽中操作提示只列比賽騎車可用的按鍵，不顯示拜訪數', async ({ page }) => {
    await startSolo(page)
    await expect(page.getByTestId('controls')).toContainText('Q 叫車')
    await expect(page.getByTestId('visited')).toBeVisible()
    await startRace(page, 0)
    const hint = page.getByTestId('controls')
    for (const key of ['W 踩踏', 'S 煞車／倒退', 'A／D 轉向', 'R 回檢查點', 'C 視角', 'M 選單']) await expect(hint).toContainText(key)
    for (const key of ['Shift', 'E ', 'Q ', 'H ']) await expect(hint).not.toContainText(key)
    await expect(page.getByTestId('visited')).toHaveCount(0)
  })

  test('[G2-5] 倒數時排在後一格的 AI 半透明，不擋住自己', async ({ page }) => {
    await startSolo(page)
    // 起跑格隨機（§8-3）：抽到最後一格時後面沒有 AI，退出重開
    let r: DebugRace | null = null
    for (let k = 0; k < 6 && (r === null || r.slot === r.grid.length - 1); k++) {
      if (r !== null) {
        await page.getByTestId('race-quit').click()
        await expect(page.getByTestId('race-start')).toBeVisible()
      }
      await openWorkshop(page, 5)
      await page.getByTestId('race-go').click()
      await expect(page.getByTestId('race-countdown')).toBeVisible()
      r = await currentRace(page)
    }
    expect(r!.slot).toBeLessThan(r!.grid.length - 1)
    // AI 依序排在玩家以外的格子；後一格的 AI 位於相機與自己之間，畫出第一幀後仍在畫面上，但半透明
    const behind = `race-ai-${r!.grid.map((_, k) => k).filter((k) => k !== r!.slot).indexOf(r!.slot + 1)}`
    await expect
      .poll(() => page.evaluate((id) => window.__taipei!.shown(id) !== null && window.__taipei!.opacity(id)! < 0.7, behind), { timeout: 2_500 })
      .toBe(true)
  })
})

test.describe('B2 摔車', () => {
  test('[B2-5] 摔車時 HUD 顯示「摔車了！」，倒地期間不能騎，2 秒後扶起提示消失', async ({ page }) => {
    await startSolo(page)
    await startRace(page, 0)
    const speed = async () => (await snapshot(page)).player.bike!.speed
    // 起步後放開 W、按住 D：滑到 2.5 m/s 以下還硬轉，0.8 秒就倒（放開時的速度看頁面取樣延遲，等久一點）
    await page.keyboard.down('w')
    await expect.poll(speed, { intervals: [20] }).toBeGreaterThan(1.8)
    await page.keyboard.up('w')
    await page.keyboard.down('d')
    await expect(page.getByTestId('fallen')).toHaveText('摔車了！', { timeout: 8_000 })
    await page.keyboard.up('d')
    await page.keyboard.down('w')
    // 每次 snapshot 要等一幀，只比較仍在倒地（down > 0）時取到的位置
    const lying: { x: number; z: number }[] = []
    for (let p = (await snapshot(page)).player; p.bike!.down > 0; p = (await snapshot(page)).player) lying.push(p.pos)
    expect(lying.length).toBeGreaterThanOrEqual(2)
    for (const pos of lying) expect(distance(pos, lying[0]!)).toBeLessThan(0.05)
    await expect(page.getByTestId('fallen')).toHaveCount(0, { timeout: 2_500 })
    await expect.poll(speed).toBeGreaterThan(0.5)
    await page.keyboard.up('w')
  })
})

test.describe('B3 體力', () => {
  test('[B3-5] 騎車時 HUD 顯示體力條：按住 W 往前踩體力下降，放開後慢慢恢復', async ({ page }) => {
    await startSolo(page)
    await startRace(page, 0)
    const bar = page.getByTestId('stamina')
    const stamina = async () => Number(await bar.getAttribute('data-value'))
    await expect(bar).toHaveAttribute('data-value', '100')
    await page.keyboard.down('w')
    await expect.poll(stamina, { timeout: 5_000 }).toBeLessThan(85)
    await page.keyboard.up('w')
    const low = await stamina()
    await expect.poll(stamina, { timeout: 5_000 }).toBeGreaterThan(low)
    await expect(page.getByTestId('spent')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('stamina.png') })
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

const TURN_LABEL = { left: '左轉', right: '右轉', straight: '直行', finish: '終點' } as const

/** 賽道上路口 k 怎麼轉（前後兩段方向的叉積，正的是右轉） */
function turnAt(nodes: { x: number; z: number }[], k: number): keyof typeof TURN_LABEL {
  const [a, b, c] = [nodes[k - 1]!, nodes[k]!, nodes[k + 1]]
  if (!c) return 'finish'
  const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)
  return cross === 0 ? 'straight' : cross > 0 ? 'right' : 'left'
}

/** 瞬移到第 k 段路上 u 的位置、面向路段前方 */
async function rideOnSegment(page: Page, nodes: { x: number; z: number }[], k: number, u: number): Promise<void> {
  const [a, b] = [nodes[k]!, nodes[k + 1]!]
  const pose = { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, h: Math.atan2(b.x - a.x, b.z - a.z) }
  await page.evaluate(({ x, z, h }) => window.__taipei!.teleport(x, z, h), pose)
}

test.describe('G5 導航', () => {
  test('[G5-2] HUD 顯示下一個路口怎麼轉與距離，騎過路口後換成下一個路口', async ({ page }) => {
    await startSolo(page)
    const { nodes } = await startRace(page, 0)
    const turn = page.getByTestId('race-turn')

    await rideOnSegment(page, nodes, 0, 0.5)
    await expect(turn).toHaveAttribute('data-kind', turnAt(nodes, 1))
    await expect(turn).toContainText(TURN_LABEL[turnAt(nodes, 1)])
    await expect(turn).toContainText('40 m')

    await rideOnSegment(page, nodes, 1, 0.75)
    await expect(turn).toHaveAttribute('data-kind', turnAt(nodes, 2))
    await expect(turn).toContainText(TURN_LABEL[turnAt(nodes, 2)])
    await expect(turn).toContainText('20 m')
  })

  test('[G5-3] 右下角小地圖車頭朝上，畫出自己、下一個檢查點與每台 AI；檢查點在範圍外時邊緣有箭頭', async ({ page }) => {
    await startSolo(page)
    const { nodes, checkpoints } = await startRace(page, 3)
    const map = page.getByTestId('race-minimap')
    await expect(map).toBeVisible()
    await expect(map.getByTestId('minimap-route')).toHaveCount(1)
    await expect(map.getByTestId('minimap-ai')).toHaveCount(3)

    // 朝第一個檢查點騎：檢查點在自己正上方
    await rideOnSegment(page, nodes, 1, 0.5)
    await expect(map.getByTestId('minimap-arrow')).toBeHidden()
    await expect
      .poll(async () => {
        const self = (await map.getByTestId('minimap-self').boundingBox())!
        const next = (await map.getByTestId('minimap-next').boundingBox())!
        return { aligned: Math.abs(next.x + next.width / 2 - (self.x + self.width / 2)) <= 2, above: next.y + next.height / 2 < self.y }
      })
      .toEqual({ aligned: true, above: true })

    const speed = (await page.getByTestId('speed').boundingBox())!
    const box = (await map.boundingBox())!
    expect(speed.x + speed.width <= box.x || speed.y + speed.height <= box.y).toBe(true)

    // 城市離第一個檢查點最遠的角落
    const cp = checkpoints[0]!
    const corners = [8, 312].flatMap((x) => [8, 312].map((z) => ({ x, z })))
    const far = corners.reduce((a, b) => (distance(b, cp) > distance(a, cp) ? b : a))
    await page.evaluate(({ x, z }) => window.__taipei!.teleport(x, z, 0), far)
    await expect(map.getByTestId('minimap-arrow')).toBeVisible()
  })

  test('[G5-4] 退出比賽回到城市後小地圖與路口提示移除', async ({ page }) => {
    await startSolo(page)
    await startRace(page, 1)
    await expect(page.getByTestId('race-minimap')).toBeVisible()
    await expect(page.getByTestId('race-turn')).toBeVisible()
    await page.getByTestId('race-quit').click()
    await expect(page.getByTestId('race-lobby')).toBeVisible()
    await expect(page.getByTestId('race-minimap')).toHaveCount(0)
    await expect(page.getByTestId('race-turn')).toHaveCount(0)
  })
})

/** 整備站裡某個零件的按鈕 */
function part(page: Page, slot: string, id: string) {
  return page.locator(`[data-testid="workshop-part"][data-slot="${slot}"][data-id="${id}"]`)
}

test.describe('W1 整備站', () => {
  test('[W1-1] 開始比賽後進入整備站，看到本局賽道預覽：路線、起點、檢查點、轉彎數、最長直線', async ({ page }, testInfo) => {
    await startSolo(page)
    await openWorkshop(page, 2)
    const r = await currentRace(page)
    expect(r.view.phase).toBe('prep')
    const map = page.getByTestId('workshop-map')
    await expect(map).toBeVisible()
    await expect(map.getByTestId('workshop-route')).toHaveCount(1)
    await expect(map.getByTestId('workshop-start')).toHaveCount(1)
    await expect(map.getByTestId('workshop-checkpoint')).toHaveCount(r.checkpoints.length)
    const turns = r.nodes.slice(1, -1).filter((_, k) => turnAt(r.nodes, k + 1) !== 'straight').length
    await expect(page.getByTestId('workshop-turns')).toHaveText(String(turns))
    await expect(page.getByTestId('workshop-longest')).toHaveText(/^\d+$/)
    // 整備時不在場景裡騎車：沒有 HUD 的檢查點與小地圖
    await expect(page.getByTestId('race-cp')).toHaveCount(0)
    await expect(page.getByTestId('race-minimap')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('workshop.png') })
  })

  test('[W1-2] 每個部位只能選一款，超過預算的組合不能選，剩餘預算即時更新', async ({ page }) => {
    await startSolo(page)
    await openWorkshop(page, 0)
    const budget = page.getByTestId('workshop-budget')
    // 預設鋁合金 300 + 通勤輪 100 + 輕齒比 300 + 短龍頭 200 = 900
    await expect(budget).toHaveText('100')
    await expect(page.locator('[data-testid="workshop-part"][aria-pressed="true"]')).toHaveCount(4)
    // 換碳纖會變成 1100，超過預算
    await expect(part(page, 'frame', 'carbon')).toBeDisabled()

    await part(page, 'bar', 'flat').click()
    await expect(part(page, 'bar', 'flat')).toHaveAttribute('aria-pressed', 'true')
    await expect(part(page, 'bar', 'stem')).toHaveAttribute('aria-pressed', 'false')
    await expect(budget).toHaveText('200')
    await part(page, 'frame', 'carbon').click()
    await expect(part(page, 'frame', 'carbon')).toHaveAttribute('aria-pressed', 'true')
    await expect(part(page, 'frame', 'alloy')).toHaveAttribute('aria-pressed', 'false')
    await expect(budget).toHaveText('0')
    await expect(part(page, 'wheel', 'slick')).toBeDisabled()
    await expect(part(page, 'bar', 'stem')).toBeDisabled()
    expect((await currentRace(page)).view.build).toEqual({ frame: 'carbon', wheel: 'commuter', drive: 'short', bar: 'flat' })
  })

  test('[W1-3] 單人按「出發」前一直在整備站，按了才進入 3 秒倒數', async ({ page }) => {
    await startSolo(page)
    await openWorkshop(page, 0)
    await expect(page.getByTestId('race-prep-left')).toHaveCount(0)
    await page.waitForTimeout(4000)
    expect((await currentRace(page)).view.phase).toBe('prep')
    // 在頁面內逐幀記下 phase 與倒數畫面，避免每次 evaluate 的延遲跨過 3 秒倒數
    const frames = page.evaluate(
      () =>
        new Promise<{ t: number; phase: string; shown: boolean }[]>((resolve) => {
          const out: { t: number; phase: string; shown: boolean }[] = []
          const tick = () => {
            const phase = window.__taipei!.race()!.view.phase
            out.push({ t: performance.now(), phase, shown: document.querySelector('[data-testid="race-countdown"]') !== null })
            if (phase === 'racing' || out.length > 5000) resolve(out)
            else requestAnimationFrame(tick)
          }
          tick()
        }),
    )
    await page.getByTestId('race-go').click()
    const seen = await frames
    const countdown = seen.filter((f) => f.phase === 'countdown')
    expect(countdown.length).toBeGreaterThan(1)
    expect(countdown.some((f) => f.shown)).toBe(true)
    expect(seen.at(-1)!.phase).toBe('racing')
    expect(seen.at(-1)!.t - countdown[0]!.t).toBeGreaterThan(2500)
    await expect(page.getByTestId('race-workshop')).toHaveCount(0)
  })

  test('[W1-4] 整備完的組裝存進存檔，下一局與重新整理後都帶入', async ({ page }) => {
    await startSolo(page)
    await openWorkshop(page, 0)
    await part(page, 'drive', 'tall').click()
    await part(page, 'bar', 'drop').click()
    const build = { frame: 'alloy', wheel: 'commuter', drive: 'tall', bar: 'drop' }
    expect((await currentRace(page)).view.build).toEqual(build)
    await page.getByTestId('race-go').click()
    await page.getByTestId('race-quit').click()
    await expect(page.getByTestId('race-lobby')).toBeVisible()

    await openWorkshop(page, 0)
    await expect(part(page, 'drive', 'tall')).toHaveAttribute('aria-pressed', 'true')
    await expect(part(page, 'bar', 'drop')).toHaveAttribute('aria-pressed', 'true')

    await page.reload()
    await page.getByTestId('start-solo').click()
    await expect(page.getByTestId('race-lobby')).toBeVisible()
    await page.waitForFunction(() => window.__taipei !== undefined)
    await openWorkshop(page, 0)
    expect((await currentRace(page)).view.build).toEqual(build)
  })
})

test.describe('W3 成績表組裝', () => {
  test('[W3-1] 成績表每位選手顯示四個零件名稱，AI 也顯示', async ({ page }) => {
    test.setTimeout(120_000)
    await startSolo(page, '小明')
    await openWorkshop(page, 1)
    await part(page, 'bar', 'flat').click()
    await part(page, 'frame', 'carbon').click()
    await page.getByTestId('race-go').click()
    await expect.poll(async () => (await currentRace(page)).view.phase, { timeout: 8_000 }).toBe('racing')
    const r = await currentRace(page)
    await passCheckpoints(page, 0, r.checkpoints.length)
    await expect(page.getByTestId('race-results')).toBeVisible({ timeout: 45_000 })
    const builds = page.getByTestId('race-result-build')
    await expect(builds).toHaveCount(2)
    await expect(builds.nth(0)).toHaveText('碳纖＋通勤輪＋輕齒比＋平把')
    await expect(builds.nth(1)).toHaveText(/^[^＋]+(＋[^＋]+){3}$/)
  })
})

test.describe('B4 破風與後追', () => {
  test('[B4-5] 停在起跑格讓 AI 騎遠，HUD 顯示後追加成', async ({ page }) => {
    await startSolo(page)
    await startRace(page, 5)
    await expect(page.getByTestId('race-catchup')).toBeHidden()
    await expect(page.getByTestId('race-catchup')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('race-catchup')).toHaveText(/^後追 \d+0%$/)
    await page.screenshot({ path: 'test-results/b4-5-catchup.png' })
  })
})
