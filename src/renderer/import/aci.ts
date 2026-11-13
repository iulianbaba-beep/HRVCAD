// AutoCAD Color Index → CSS hex. Colours 7 (white/black) and very light ones are darkened
// so underlays stay readable on the light drawing background.
const BASE: Record<number, string> = {
  1: '#ff0000', 2: '#c8b400', 3: '#00a000', 4: '#00a0a0', 5: '#0000ff', 6: '#c000c0',
  7: '#222222', 8: '#808080', 9: '#a0a0a0',
  250: '#333333', 251: '#505050', 252: '#696969', 253: '#828282', 254: '#9a9a9a', 255: '#b0b0b0'
}

export function aciToHex(i: number): string {
  if (BASE[i]) return BASE[i]
  if (i >= 10 && i <= 249) {
    const hue = (Math.floor(i / 10) - 1) * 15
    const variant = i % 10 // even: full, odd: tinted; higher = darker
    const light = [45, 70, 38, 60, 30, 50, 22, 40, 15, 30][variant]
    return `hsl(${hue} 85% ${light}%)`
  }
  return '#555555'
}
