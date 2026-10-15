/** 每台 AI 的顏色：場景中的腳踏車與小地圖上的點同色 */
export const AI_COLORS = ['#f0883e', '#a371f7', '#3fb950', '#39c5cf', '#e8554e'] as const
export const CHECKPOINT_COLOR = '#36cfc9'
export const FINISH_COLOR = '#ff4d4f'

export function aiColor(k: number): string {
  return AI_COLORS[k % AI_COLORS.length]!
}
