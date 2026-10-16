import { expect, test } from '@playwright/test'
import { doors, snapshot, standAtDoor, startSolo } from './helpers'

test.describe('D5 相機與畫面', () => {
  test('[D5-1] 按 C 在追蹤與俯瞰視角間切換', async ({ page }) => {
    await startSolo(page)
    expect((await snapshot(page)).cameraMode).toBe('chase')
    await page.keyboard.press('c')
    expect((await snapshot(page)).cameraMode).toBe('top')
    await page.keyboard.press('c')
    expect((await snapshot(page)).cameraMode).toBe('chase')
  })

  test('[D5-2] 真瀏覽器中按住 W 後自己的車在城市中前進', async ({ page }) => {
    await startSolo(page)
    await page.keyboard.press('e')
    const start = await snapshot(page)
    expect(start.player.mode).toBe('drive')

    await page.keyboard.down('w')
    await expect(page.getByTestId('speed')).not.toHaveText(/^0\s*km\/h$/)
    // 每幀的 dt 有上限，無頭瀏覽器掉幀時模擬時間會比實際時間慢，所以等到開出去而不是固定等幾秒
    await expect
      .poll(async () => {
        const moved = await snapshot(page)
        const dx = moved.player.car.pos.x - start.player.car.pos.x
        const dz = moved.player.car.pos.z - start.player.car.pos.z
        return dx * Math.sin(start.player.car.heading) + dz * Math.cos(start.player.car.heading)
      }, { timeout: 8000 })
      .toBeGreaterThan(3)
    await page.keyboard.up('w')
  })

  test('[D5-3] 按 H 播放喇叭聲', async ({ page }) => {
    await startSolo(page)
    await page.keyboard.press('e')
    await expect(page.getByTestId('mode')).toHaveText('開車')
    const before = await page.evaluate(() => window.__taipei!.hornPlays())
    await page.keyboard.press('h')
    await expect.poll(() => page.evaluate(() => window.__taipei!.hornPlays())).toBe(before + 1)
  })
})

test.describe('H3 拜訪手冊', () => {
  test('[H3-2] 手冊顯示「已拜訪 x / 全部」與門牌清單', async ({ page }) => {
    await startSolo(page)
    const all = await doors(page)
    const home = all[0]!
    await standAtDoor(page, home)
    await page.keyboard.press('e')
    await expect(page.getByTestId('mode')).not.toHaveText(/步行|開車/)
    await expect(page.getByTestId('visited')).toHaveText('已拜訪 1 戶')

    await page.keyboard.press('m')
    await expect(page.getByTestId('stamp-book')).toBeVisible()
    await expect(page.getByTestId('book-count')).toHaveText(`已拜訪 1 / ${all.length}`)
    const entries = page.getByTestId('book-entry')
    await expect(entries).toHaveCount(all.length)
    await expect(entries.filter({ hasText: home.address })).toHaveAttribute('data-visited', 'true')
    await expect(page.locator('[data-testid="book-entry"][data-visited="true"]')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('stamp-book')).toBeHidden()
  })
})

test.describe('P1 讀存檔', () => {
  test('[P1-3] 重新整理頁面後暱稱與拜訪紀錄仍在', async ({ page }) => {
    await startSolo(page, '阿明')
    const [home] = await doors(page)
    await standAtDoor(page, home!)
    await page.keyboard.press('e')
    await expect(page.getByTestId('visited')).toHaveText('已拜訪 1 戶')

    await page.reload()
    await expect(page.getByTestId('name-input')).toHaveValue('阿明')
    await page.getByTestId('start-solo').click()
    await expect(page.getByTestId('visited')).toHaveText('已拜訪 1 戶')
  })
})

test.describe('C3 日夜循環', () => {
  test('[C3-2] 夜晚時路燈與窗戶在畫面上亮起', async ({ page }) => {
    const glowing = () => page.evaluate(() => window.__taipei!.surfaces().glowing)
    await startSolo(page)
    await expect(page.getByTestId('clock')).toContainText('☀️')
    await expect.poll(() => page.evaluate(() => window.__taipei!.surfaces().maps.length)).toBeGreaterThan(0)
    const day = await glowing()
    expect(day).not.toContain('facadeWall')
    expect(day).not.toContain('lampHead')
    await page.evaluate(() => window.__taipei!.setTime(325))
    await expect(page.getByTestId('clock')).toContainText('🌙')
    await expect.poll(glowing).toEqual(expect.arrayContaining(['facadeWall', 'lampHead']))
  })
})

test.describe('H 進門與室內（真鍵盤）', () => {
  test('[H1-2][H2-3] 在大門按 E 進入該戶室內，在室內大門按 E 回到該戶大門外', async ({ page }) => {
    await startSolo(page)
    const [door] = await doors(page)
    await standAtDoor(page, door!)

    await page.keyboard.press('e')
    await expect(page.getByTestId('mode')).toHaveText(door!.address)
    expect((await snapshot(page)).player.location).toEqual({ kind: 'home', homeId: door!.id })
    await expect(page.getByTestId('prompt')).toHaveText('按 E 出門')

    await page.keyboard.press('e')
    await expect(page.getByTestId('mode')).toHaveText('步行')
    const out = (await snapshot(page)).player
    expect(out.location).toEqual({ kind: 'outdoor' })
    expect(Math.hypot(out.pos.x - door!.door.x, out.pos.z - door!.door.z)).toBeLessThanOrEqual(2)
    const outward = (out.pos.x - door!.door.x) * Math.sin(door!.facing) + (out.pos.z - door!.door.z) * Math.cos(door!.facing)
    expect(outward).toBeGreaterThan(0)
  })
})

test.describe('R1 模式介面', () => {
  test('[R1-1] 開局時自由逛街模式已啟用，其 HUD 與場景標記在畫面上運作', async ({ page }) => {
    await startSolo(page)
    await expect(page.locator('[data-mode]')).toHaveAttribute('data-mode', 'freeRoam')
    const [door] = await doors(page)
    await standAtDoor(page, door!)
  })
})

test.describe('V1 寫實貼圖', () => {
  test('[V1-1] 進城後 brief 的貼圖全部載入並綁在室外與室內各表面上', async ({ page }, testInfo) => {
    const maps = () => page.evaluate(() => window.__taipei!.surfaces().maps)
    await startSolo(page)
    await expect
      .poll(() => page.evaluate(() => window.__taipei!.textures().filter((t) => t.width === 0).map((t) => t.name)))
      .toEqual([])
    await expect
      .poll(maps)
      .toEqual(expect.arrayContaining(['asphalt', 'facade', 'facadeAc', 'grass', 'roof', 'shopfront', 'sidewalk', 'towerGlass']))
    await testInfo.attach('outdoor', { body: await page.screenshot(), contentType: 'image/png' })

    await standAtDoor(page, (await doors(page))[0]!)
    await page.keyboard.press('e')
    await expect(page.getByTestId('mode')).not.toHaveText(/步行|開車/)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect.poll(maps).toEqual(expect.arrayContaining(['interiorFloor', 'interiorWall']))
    await testInfo.attach('indoor', { body: await page.screenshot(), contentType: 'image/png' })
  })
})
