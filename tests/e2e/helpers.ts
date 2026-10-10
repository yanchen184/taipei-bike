import { expect, type Page } from '@playwright/test'
import type { DebugDoor, TaipeiDebug } from '../../src/game/debug'

export type GameSnapshot = ReturnType<TaipeiDebug['state']>

/** 正式 build 只在 ?debug=1 時掛上 window.__taipei */
export const ENTRY = './?debug=1'

/** 從標題畫面以指定暱稱開始單人遊戲，等到測試掛鉤就緒 */
export async function startSolo(page: Page, name = '測試員'): Promise<void> {
  await page.goto(ENTRY)
  await page.getByTestId('name-input').fill(name)
  await page.getByTestId('start-solo').click()
  await expect(page.getByTestId('clock')).toBeVisible()
  await page.waitForFunction(() => window.__taipei !== undefined)
}

export function snapshot(page: Page): Promise<GameSnapshot> {
  return page.evaluate(() => window.__taipei!.state())
}

export function doors(page: Page): Promise<DebugDoor[]> {
  return page.evaluate(() => window.__taipei!.doors())
}

/** 瞬移到某戶大門外 1 m、面向大門 */
export async function standAtDoor(page: Page, door: DebugDoor): Promise<void> {
  await page.evaluate((d) => {
    const x = d.door.x + Math.sin(d.facing)
    const z = d.door.z + Math.cos(d.facing)
    window.__taipei!.teleport(x, z, d.facing + Math.PI)
  }, door)
  await expect(page.getByTestId('prompt')).toContainText(door.address)
}

/** 從標題畫面建立房間，回傳房號 */
export async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto(ENTRY)
  await page.getByTestId('name-input').fill(name)
  await page.getByTestId('create-room').click()
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{4}$/)
  await page.waitForFunction(() => window.__taipei !== undefined)
  return page.getByTestId('room-code').innerText()
}

/** 從標題畫面輸入房號加入 */
export async function joinRoom(page: Page, name: string, code: string): Promise<void> {
  await page.goto(ENTRY)
  await page.getByTestId('name-input').fill(name)
  await page.getByTestId('room-code-input').fill(code)
  await page.getByTestId('join-room').click()
  await expect(page.getByTestId('room-code')).toHaveText(code)
  await page.waitForFunction(() => window.__taipei !== undefined)
}

/** 這一頁畫面上正在畫的其他玩家暱稱 */
export function remoteNames(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__taipei!.remotes().map((r) => r.name))
}
