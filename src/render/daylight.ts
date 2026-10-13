/** 日出、日落：日落晚於 19:00 亮燈，黃昏不會出現「天已全黑、燈還沒亮」的空檔 */
export const SUNRISE = 5.5
export const SUNSET = 19.5

/** 0 = 深夜、1 = 正午；取正弦的平方根，讓清晨與黃昏保有天光 */
export function daylight(hour: number): number {
  return Math.sqrt(Math.max(0, Math.sin(((hour - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI)))
}
