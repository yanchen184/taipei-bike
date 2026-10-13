import { test as base, expect, type Page } from '@playwright/test'
import type { DebugRace } from '../../src/game/debug'
import { ENTRY, createRoom, joinRoom } from './helpers'

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

/** page 場景中畫出來的物件位置；沒畫出來時為 null */
function shown(page: Page, name: string) {
  return page.evaluate((n) => window.__taipei!.shown(n), name)
}

/** page 畫面上另一位玩家的模式與位置 */
async function remote(page: Page, name: string) {
  const all = await page.evaluate(() => window.__taipei!.remotes())
  return all.find((r) => r.name === name) ?? null
}

/** page 場景中真的畫出這位玩家的腳踏車，位置與同步資料一致 */
async function expectBikeShown(page: Page, name: string): Promise<void> {
  const them = (await remote(page, name))!
  const bike = await shown(page, `remote-bike-${them.uid}`)
  expect(bike).not.toBeNull()
  expect(distance(bike!, them)).toBeLessThan(2)
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
    // 場景中真的畫出對方的腳踏車，位置與同步資料一致
    await expectBikeShown(guest, '阿明')
    await expectBikeShown(page, '小美')
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

    // 把對方的名牌移到成績表正中央（同一個 task 內，下一幀才會被改回），成績表要畫在名牌上面
    const box = (await guest.getByTestId('race-results').boundingBox())!
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const onTop = await guest.getByTestId('remote-name').filter({ hasText: '阿明' }).evaluate((el, c) => {
      let wrapper = el as HTMLElement
      while (wrapper.parentElement && !wrapper.style.zIndex) wrapper = wrapper.parentElement
      const before = el.getBoundingClientRect()
      wrapper.style.transform = `translate3d(${c.x - before.width / 2}px, ${c.y - before.height / 2}px, 0)`
      el.style.pointerEvents = 'auto'
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return { overlaps: Math.abs(r.x + r.width / 2 - c.x) < 40 && Math.abs(r.y + r.height / 2 - c.y) < 40, top: hit?.closest('[data-testid]')?.getAttribute('data-testid') }
    }, center)
    expect(onTop.overlaps).toBe(true)
    expect(onTop.top).not.toBe('remote-name')
  })

  test('[N1-2] 其他人畫面上的 AI 跟著房主寫入的位置移動', async ({ page, guest }) => {
    await roomOfTwo(page, guest)
    await startRace(page, 2, [page, guest])
    // 讀場景中真的畫出來的 AI，而不是控制器算出的位置
    const drawn = (p: Page) => Promise.all([0, 1].map((k) => shown(p, `race-ai-${k}`)))
    const start = await drawn(guest)
    expect(start.every((a) => a !== null)).toBe(true)

    // 房主的 AI 每 AI_SEND_MS 送一次，其他人再落後 INTERP_DELAY 內插
    await expect
      .poll(async () => {
        const [h, g] = await Promise.all([currentRace(page), drawn(guest)])
        if (g.some((a) => a === null)) return false
        const moved = g.every((a, k) => distance(a!, start[k]!) > 5)
        const gap = Math.max(...g.map((a, k) => distance(a!, h.ais[k]!)))
        return moved && gap < 6
      }, { timeout: 20_000 })
      .toBe(true)
  })

  test('[N1-2] 貼圖還沒載完時也畫出 AI', async ({ page, guest }) => {
    // 線上貼圖可能要 20 秒以上，比賽場景不能等貼圖；只擋圖片本身，dev server 上 `?import` 的同名請求是 JS 模組
    await guest.route('**/assets/textures/**', (route) => (route.request().resourceType() === 'image' ? undefined : route.continue()))
    const code = await createRoom(page, '阿明')
    // 貼圖請求沒回應時 load 事件不會觸發，不能用 joinRoom 的 goto
    await guest.goto(ENTRY, { waitUntil: 'domcontentloaded' })
    await guest.getByTestId('name-input').fill('小美')
    await guest.getByTestId('room-code-input').fill(code)
    await guest.getByTestId('join-room').click()
    await expect(page.getByTestId('room-player')).toHaveCount(2)
    await startRace(page, 2, [page, guest])
    await expect.poll(() => Promise.all([0, 1].map((k) => shown(guest, `race-ai-${k}`))), { timeout: 5000 }).not.toContain(null)
    expect(await guest.evaluate(() => window.__taipei!.textures().some((t) => t.width === 0))).toBe(true)
  })

  test('[N1-4] 開賽後才加入的玩家不參賽，但看得到參賽的玩家騎車', async ({ page, guest, late }) => {
    const code = await roomOfTwo(page, guest)
    await startRace(page, 0, [page, guest])
    await joinRoom(late, '阿花', code)
    await expect(late.getByTestId('race-lobby')).toBeVisible()
    expect(await race(late)).toBeNull()
    // 第三個畫面的場景要等貼圖載入完才畫出其他玩家
    for (const name of ['阿明', '小美']) {
      await expect.poll(async () => (await remote(late, name))?.mode, { timeout: 20_000 }).toBe('bike')
      await expectBikeShown(late, name)
    }
    expect((await currentRace(page)).view.total).toBe(2)
  })
})
