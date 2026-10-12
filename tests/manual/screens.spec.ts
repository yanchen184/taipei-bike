import { expect, test, type Page } from '@playwright/test'
import { doors, standAtDoor, startSolo } from '../e2e/helpers'

const OUT = 'docs/manual/img'

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/${name}.png` })
}

test('01 開局與步行', async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('name-input').fill('阿騎')
  await shot(page, '01-title')

  await page.getByTestId('start-solo').click()
  await expect(page.getByTestId('clock')).toBeVisible()
  await shot(page, '02-street')
})

test('02 開車與視角', async ({ page }) => {
  await startSolo(page, '阿騎')
  await page.keyboard.press('e')
  await expect(page.getByTestId('mode')).toHaveText('開車')
  await page.keyboard.down('w')
  await page.waitForTimeout(2500)
  await page.keyboard.up('w')
  await shot(page, '03-driving')

  await page.keyboard.press('c')
  await shot(page, '04-top-view')
})

test('03 拜訪住家與手冊', async ({ page }) => {
  await startSolo(page, '阿騎')
  const [home] = await doors(page)
  await standAtDoor(page, home!)
  await shot(page, '05-door-prompt')

  await page.keyboard.press('e')
  await expect(page.getByTestId('visited')).toHaveText('已拜訪 1 戶')
  await shot(page, '06-interior')

  await page.keyboard.press('m')
  await expect(page.getByTestId('stamp-book')).toBeVisible()
  await shot(page, '07-stamp-book')
})

test('04 夜晚', async ({ page }) => {
  await startSolo(page, '阿騎')
  await page.evaluate(() => window.__taipei!.setTime(325))
  await expect(page.getByTestId('clock')).toContainText('🌙')
  await shot(page, '08-night')
})

test('05 競速', async ({ page }) => {
  await startSolo(page, '阿騎')
  await expect(page.getByTestId('race-lobby')).toBeVisible()
  await page.getByTestId('race-ai-count').selectOption('3')
  await shot(page, '09-race-lobby')

  await page.getByTestId('race-start').click()
  await expect(page.getByTestId('race-countdown')).toBeVisible()
  await shot(page, '10-race-countdown')

  await expect.poll(() => page.evaluate(() => window.__taipei!.race()?.view.phase), { timeout: 8_000 }).toBe('racing')
  await page.keyboard.down('w')
  await page.waitForTimeout(2500)
  await page.keyboard.up('w')
  await shot(page, '11-race-riding')

  const checkpoints = await page.evaluate(() => window.__taipei!.race()!.checkpoints)
  for (const [k, c] of checkpoints.entries()) {
    await page.evaluate(([x, z]) => window.__taipei!.teleport(x!, z!), [c.x, c.z])
    await expect.poll(() => page.evaluate(() => window.__taipei!.race()!.view.cp)).toBe(k + 1)
  }
  await expect(page.getByTestId('race-results')).toBeVisible({ timeout: 45_000 })
  await shot(page, '12-race-results')
})
