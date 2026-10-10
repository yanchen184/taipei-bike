import { expect, test } from '@playwright/test'
import { ENTRY, createRoom, doors, joinRoom, snapshot, startSolo } from '../e2e/helpers'

function expectedSha(): string {
  const sha = process.env.EXPECTED_SHA
  if (!sha) throw new Error('請設定 EXPECTED_SHA（main 的 commit SHA）')
  return sha
}

test('[S1-1] 線上頁面的 commit meta 等於 main 的 SHA', async ({ page }) => {
  await page.goto(ENTRY)
  await expect(page.locator('meta[name="commit"]')).toHaveAttribute('content', expectedSha())
})

test('[S1-2] 線上單人：開車前進、下車走到住家、進門、出門', async ({ page }, testInfo) => {
  await startSolo(page, '線上驗收')
  await page.keyboard.press('e')
  const start = await snapshot(page)
  expect(start.player.mode).toBe('drive')
  await page.keyboard.down('w')
  await page.waitForTimeout(1500)
  await page.keyboard.up('w')
  const moved = (await snapshot(page)).player.car
  const forward =
    (moved.pos.x - start.player.car.pos.x) * Math.sin(start.player.car.heading) +
    (moved.pos.z - start.player.car.pos.z) * Math.cos(start.player.car.heading)
  expect(forward).toBeGreaterThan(3)
  await page.screenshot({ path: testInfo.outputPath('drive.png') })

  await page.keyboard.press('e')
  await expect(page.getByTestId('mode')).toHaveText('步行')

  const homes = await doors(page)
  expect(homes.length).toBeGreaterThan(0)
  const door = homes[0]!
  await page.evaluate((d) => {
    window.__taipei!.teleport(d.door.x + Math.sin(d.facing) * 4, d.door.z + Math.cos(d.facing) * 4, d.facing + Math.PI)
  }, door)
  await page.keyboard.down('w')
  await expect(page.getByTestId('prompt')).toContainText(door.address)
  await page.keyboard.up('w')
  await page.keyboard.press('e')
  await expect(page.getByTestId('mode')).toHaveText(door.address)
  await page.screenshot({ path: testInfo.outputPath('home.png') })
  await page.keyboard.press('e')
  await expect(page.getByTestId('mode')).toHaveText('步行')
  expect((await snapshot(page)).player.location).toEqual({ kind: 'outdoor' })
})

test('[S1-3] 線上兩個瀏覽器加入同一房間並看到對方移動', async ({ page, browser }, testInfo) => {
  const guestContext = await browser.newContext()
  try {
    const guest = await guestContext.newPage()
    const code = await createRoom(page, '房主')
    await joinRoom(guest, '來賓', code)
    await expect(page.getByTestId('remote-name')).toHaveText('來賓')
    await expect(guest.getByTestId('remote-name')).toHaveText('房主')

    const start = (await snapshot(page)).player.pos
    await page.keyboard.down('w')
    await page.waitForTimeout(1500)
    await page.keyboard.up('w')
    const target = (await snapshot(page)).player.pos
    expect(Math.hypot(target.x - start.x, target.z - start.z)).toBeGreaterThan(1)
    await expect
      .poll(async () => {
        const [host] = await guest.evaluate(() => window.__taipei!.remotes())
        return host ? Math.hypot(host.x - target.x, host.z - target.z) : Infinity
      })
      .toBeLessThan(0.01)
    await guest.screenshot({ path: testInfo.outputPath('guest.png') })
  } finally {
    await guestContext.close()
  }
})
