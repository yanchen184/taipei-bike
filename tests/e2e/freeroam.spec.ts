import { expect, test, type Page } from '@playwright/test'
import { snapshot, startSolo } from './helpers'

function part(page: Page, slot: string, id: string) {
  return page.locator(`[data-testid="workshop-part"][data-slot="${slot}"][data-id="${id}"]`)
}

function shown(page: Page, name: string) {
  return page.evaluate((n) => window.__taipei!.shown(n), name)
}

test.describe('D6 自由騎車', () => {
  test('[D6-6] 真瀏覽器中按「召喚腳踏車」後騎上自己的車，按住 W 前進，再召喚畫面上仍只有一台（E2E）', async ({ page }, testInfo) => {
    await startSolo(page)
    await page.getByTestId('summon-bike').click()
    await expect.poll(async () => (await snapshot(page)).player.mode).toBe('bike')

    await page.keyboard.down('KeyW')
    await expect.poll(async () => (await snapshot(page)).player.bike?.speed ?? 0).toBeGreaterThan(2)
    await page.keyboard.up('KeyW')
    await page.screenshot({ path: testInfo.outputPath('d6-6-riding.png') })

    const first = (await snapshot(page)).player
    await page.evaluate(([x, z]) => window.__taipei!.teleport(x, z), [first.pos.x + 60, first.pos.z] as const)
    await page.getByTestId('summon-bike').click()
    await expect.poll(async () => (await snapshot(page)).player.mode).toBe('bike')

    const second = (await snapshot(page)).player
    expect(second.bike).not.toBeNull()
    expect(Math.hypot(second.bike!.pos.x - first.bike!.pos.x, second.bike!.pos.z - first.bike!.pos.z)).toBeGreaterThan(30)
    await expect.poll(async () => {
      const p = await shown(page, 'player-bike')
      return p ? Math.hypot(p.x - second.bike!.pos.x, p.z - second.bike!.pos.z) : Infinity
    }).toBeLessThan(1)
    await page.screenshot({ path: testInfo.outputPath('d6-6-resummon.png') })
  })
})

test.describe('D7 商店', () => {
  test('[D7-1] 自由逛街時有「進入商店」按鈕，打開後每個部位選一款，總價超過 1000 元不能裝上', async ({ page }, testInfo) => {
    await startSolo(page)
    await page.getByTestId('open-shop').click()
    await expect(page.getByTestId('shop')).toBeVisible()
    await expect(page.locator('[data-testid="workshop-part"][aria-pressed="true"]')).toHaveCount(4)
    await expect(page.getByTestId('workshop-budget')).toHaveText('100')
    await expect(part(page, 'frame', 'carbon')).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath('d7-1-shop.png') })
    await page.getByTestId('shop-cancel').click()
    await expect(page.getByTestId('shop')).toHaveCount(0)
  })

  test('[D7-4] 真瀏覽器打開商店換零件、裝上、召喚，騎的腳踏車極速變成新組裝的極速（E2E）', async ({ page }) => {
    await startSolo(page)
    await page.getByTestId('summon-bike').click()
    await expect.poll(async () => (await snapshot(page)).player.mode).toBe('bike')
    const before = (await snapshot(page)).player.bikeSpec.maxSpeed

    await page.getByTestId('open-shop').click()
    await part(page, 'drive', 'tall').click()
    await expect(part(page, 'drive', 'tall')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('shop-equip').click()
    await expect(page.getByTestId('shop')).toHaveCount(0)

    await page.getByTestId('summon-bike').click()
    const after = await snapshot(page)
    expect(after.save.build.drive).toBe('tall')
    expect(after.player.mode).toBe('bike')
    expect(after.player.bikeSpec.maxSpeed).toBeGreaterThan(before)
  })

  test('[D7-5] 比賽中沒有商店與召喚按鈕（E2E）', async ({ page }) => {
    await startSolo(page)
    await expect(page.getByTestId('open-shop')).toBeVisible()
    await page.getByTestId('race-ai-count').selectOption('1')
    await page.getByTestId('race-start').click()
    await page.getByTestId('race-go').click()
    await expect(page.getByTestId('race-cp')).toBeVisible()
    await expect(page.getByTestId('open-shop')).toHaveCount(0)
    await expect(page.getByTestId('summon-bike')).toHaveCount(0)
  })
})
