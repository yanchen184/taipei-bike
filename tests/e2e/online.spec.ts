import { test as base, expect, type Page } from '@playwright/test'
import { ENTRY, createRoom, doors, joinRoom, remoteNames, snapshot, standAtDoor } from './helpers'

/** guest：另一個 browser context 裡的玩家，測試結束時關閉 */
const test = base.extend<{ guest: Page }>({
  guest: async ({ browser }, use) => {
    const context = await browser.newContext()
    await use(await context.newPage())
    await context.close()
  },
})

/** 把 page 的玩家瞬移到 other 旁邊 dist 公尺處、面向 other */
async function faceTowards(page: Page, other: Page, dist: number, angle: number): Promise<void> {
  const { player } = await snapshot(other)
  await page.evaluate(
    ({ x, z, dist, angle }) => window.__taipei!.teleport(x + Math.sin(angle) * dist, z + Math.cos(angle) * dist, angle + Math.PI),
    { x: player.pos.x, z: player.pos.z, dist, angle },
  )
}

test.describe('M1 房間（畫面）', () => {
  test('[M1-3] 房號不存在時標題畫面顯示錯誤', async ({ page }) => {
    await page.goto('./')
    await page.getByTestId('name-input').fill('阿明')
    await page.getByTestId('room-code-input').fill('zzzz')
    await page.getByTestId('join-room').click()
    await expect(page.getByTestId('room-error')).toHaveText('找不到這個房間')
    await expect(page.getByTestId('start-solo')).toBeEnabled()
  })
})

test.describe('M2 位置同步（兩個 browser context）', () => {
  test('[M2-1] 貼圖還沒載完時也看得到其他玩家與暱稱', async ({ page, guest }) => {
    // 線上貼圖可能要 20 秒以上，遠端玩家不能等貼圖
    // 只擋圖片本身；dev server 上 `?import` 的同名請求是 JS 模組，要放行
    await guest.route('**/assets/textures/**', (route) => (route.request().resourceType() === 'image' ? undefined : route.continue()))
    const code = await createRoom(page, '阿明')
    // 貼圖請求沒回應時 load 事件不會觸發，不能用 joinRoom 的 goto
    await guest.goto(ENTRY, { waitUntil: 'domcontentloaded' })
    await guest.getByTestId('name-input').fill('小美')
    await guest.getByTestId('room-code-input').fill(code)
    await guest.getByTestId('join-room').click()
    await expect(guest.getByTestId('room-code')).toHaveText(code)
    await expect(guest.getByTestId('remote-name')).toHaveText('阿明', { timeout: 5000 })
    expect(await guest.evaluate(() => window.__taipei!.textures().some((t) => t.width === 0))).toBe(true)
  })

  test('[M2-1] 一位玩家移動後，另一位玩家畫面上看到他的角色與暱稱跟著移動', async ({ page, guest }, testInfo) => {
    const code = await createRoom(page, '阿明')
    await joinRoom(guest, '小美', code)
    await expect(page.getByTestId('room-player')).toHaveCount(2)
    await expect(page.getByTestId('room-player').first()).toContainText('房主')
    await expect(page.getByTestId('remote-name')).toHaveText('小美')
    await expect(guest.getByTestId('remote-name')).toHaveText('阿明')

    const start = (await snapshot(page)).player.pos
    const target = { x: start.x + 6, z: start.z + 4 }
    await page.evaluate(({ x, z }) => window.__taipei!.teleport(x, z, 0), target)
    await expect
      .poll(async () => {
        const [host] = await guest.evaluate(() => window.__taipei!.remotes())
        return host ? Math.hypot(host.x - target.x, host.z - target.z) : Infinity
      })
      .toBeLessThan(0.01)
    const [host] = await guest.evaluate(() => window.__taipei!.remotes())
    expect(host).toMatchObject({ name: '阿明', mode: 'walk', loc: 'outdoor' })

    await faceTowards(guest, page, 5, 0.6)
    await faceTowards(page, guest, 5, 0.6 + Math.PI)
    await expect.poll(() => remoteNames(page)).toEqual(['小美'])
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath('host.png') })
    await guest.screenshot({ path: testInfo.outputPath('guest.png') })
  })
})

test.describe('M3 同戶可見', () => {
  test('[M3-1][M3-2] 室內與戶外互相看不到，同一戶室內互相看得到', async ({ page, guest }) => {
    const code = await createRoom(page, '阿明')
    await joinRoom(guest, '小美', code)
    await expect.poll(() => remoteNames(guest)).toEqual(['阿明'])

    const [door] = await doors(page)
    await standAtDoor(page, door!)
    await page.keyboard.press('e')
    await expect.poll(async () => (await snapshot(page)).player.location).toEqual({ kind: 'home', homeId: door!.id })
    await expect.poll(() => remoteNames(guest)).toEqual([])
    await expect(guest.getByTestId('remote-name')).toHaveCount(0)
    await expect.poll(() => remoteNames(page)).toEqual([])

    await standAtDoor(guest, door!)
    await guest.keyboard.press('e')
    await expect.poll(() => remoteNames(guest)).toEqual(['阿明'])
    await expect.poll(() => remoteNames(page)).toEqual(['小美'])
    await expect(page.getByTestId('remote-name')).toHaveText('小美')
  })
})

test.describe('M4 離線（畫面）', () => {
  test('[M4-1][M4-2] 玩家關閉頁面後 10 秒內從其他人的畫面消失，房主交給留下的玩家', async ({ page, guest }) => {
    const code = await createRoom(page, '阿明')
    await joinRoom(guest, '小美', code)
    await expect(guest.getByTestId('remote-name')).toHaveText('阿明')

    const closedAt = Date.now()
    await page.close()
    await expect(guest.getByTestId('remote-name')).toHaveCount(0, { timeout: 10_000 })
    expect(Date.now() - closedAt).toBeLessThan(10_000)
    await expect(guest.getByTestId('room-player')).toHaveCount(1)
    await expect(guest.getByTestId('room-player')).toContainText('房主')
  })
})
