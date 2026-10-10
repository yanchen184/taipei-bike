const HORN_SECONDS = 0.35
const HORN_FREQUENCIES = [392, 494]

let context: AudioContext | null = null
let hornPlays = 0

/** 雙音方波喇叭；AudioContext 在第一次按喇叭（使用者手勢）時才建立 */
export function playHorn(): void {
  context ??= new AudioContext()
  const ctx = context
  if (ctx.state === 'suspended') void ctx.resume()
  const gain = ctx.createGain()
  const now = ctx.currentTime
  gain.gain.setValueAtTime(0.12, now)
  gain.gain.setValueAtTime(0.12, now + HORN_SECONDS - 0.05)
  gain.gain.linearRampToValueAtTime(0, now + HORN_SECONDS)
  gain.connect(ctx.destination)
  for (const frequency of HORN_FREQUENCIES) {
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = frequency
    osc.connect(gain)
    osc.start(now)
    osc.stop(now + HORN_SECONDS)
  }
  hornPlays++
}

/** 已排入 AudioContext 播放的喇叭次數 */
export function hornPlayCount(): number {
  return hornPlays
}
