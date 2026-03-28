import { prepareWithSegments } from '../../src/layout.ts'

const FONT_SIZE = 14
const LINE_HEIGHT = 17
const PROP_FAMILY = 'Georgia, Palatino, "Times New Roman", serif'
const CHARSET = ' .,:;!+-=*#@%&abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const WEIGHTS = [300, 500, 800] as const
const FONT_STYLES = ['normal', 'italic'] as const
const MAX_COLS = 200
const MAX_ROWS = 80
const SCALE = 3
const U_STEPS = 40
const V_STEPS = 20
const MAJOR_R = 0.38
const MINOR_R = 0.16
const TWO_PI = Math.PI * 2

type FontStyleVariant = typeof FONT_STYLES[number]

type PaletteEntry = {
  char: string
  weight: number
  style: FontStyleVariant
  font: string
  width: number
  brightness: number
}

type Point3D = {
  x: number
  y: number
  z: number
}

type ProjectionPoint = {
  x: number
  y: number
  z: number
}

function getRequiredDiv(id: string): HTMLDivElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLDivElement)) throw new Error(`#${id} not found`)
  return element
}

const brightnessCanvas = document.createElement('canvas')
brightnessCanvas.width = 28
brightnessCanvas.height = 28
const brightnessContext = brightnessCanvas.getContext('2d', { willReadFrequently: true })
if (brightnessContext === null) throw new Error('brightness context not available')
const bCtx = brightnessContext

function estimateBrightness(ch: string, font: string): number {
  bCtx.clearRect(0, 0, 28, 28)
  bCtx.font = font
  bCtx.fillStyle = '#fff'
  bCtx.textBaseline = 'middle'
  bCtx.fillText(ch, 1, 14)
  const data = bCtx.getImageData(0, 0, 28, 28).data
  let sum = 0
  for (let index = 3; index < data.length; index += 4) sum += data[index]!
  return sum / (255 * 784)
}

const palette: PaletteEntry[] = []
for (const style of FONT_STYLES) {
  for (const weight of WEIGHTS) {
    const font = `${style === 'italic' ? 'italic ' : ''}${weight} ${FONT_SIZE}px ${PROP_FAMILY}`
    for (const ch of CHARSET) {
      if (ch === ' ') continue
      const prepared = prepareWithSegments(ch, font)
      const width = prepared.widths.length > 0 ? prepared.widths[0]! : 0
      if (width <= 0) continue
      palette.push({
        char: ch,
        weight,
        style,
        font,
        width,
        brightness: estimateBrightness(ch, font),
      })
    }
  }
}

const maxBrightness = Math.max(...palette.map(entry => entry.brightness))
if (maxBrightness > 0) {
  for (let index = 0; index < palette.length; index++) palette[index]!.brightness /= maxBrightness
}
palette.sort((a, b) => a.brightness - b.brightness)
const avgCharW = palette.reduce((sum, entry) => sum + entry.width, 0) / palette.length
const spaceW = FONT_SIZE * 0.27

function findBest(targetBrightness: number, targetWidth: number): PaletteEntry {
  let lo = 0
  let hi = palette.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (palette[mid]!.brightness < targetBrightness) lo = mid + 1
    else hi = mid
  }

  let bestScore = Infinity
  let best = palette[lo]!
  const start = Math.max(0, lo - 15)
  const end = Math.min(palette.length, lo + 15)
  for (let index = start; index < end; index++) {
    const entry = palette[index]!
    const score =
      Math.abs(entry.brightness - targetBrightness) * 2.5 +
      Math.abs(entry.width - targetWidth) / targetWidth
    if (score < bestScore) {
      bestScore = score
      best = entry
    }
  }
  return best
}

function esc(ch: string): string {
  if (ch === '&') return '&amp;'
  if (ch === '<') return '&lt;'
  if (ch === '>') return '&gt;'
  return ch
}

function wCls(weight: number, style: FontStyleVariant): string {
  const weightClass = weight === 300 ? 'w3' : weight === 500 ? 'w5' : 'w8'
  return style === 'italic' ? `${weightClass} it` : weightClass
}

const artEl = getRequiredDiv('art')
const statsEl = getRequiredDiv('stats')
let cols = 0
let rows = 0
const rowEls: HTMLDivElement[] = []
let canvas!: HTMLCanvasElement
let ctx!: CanvasRenderingContext2D

const baseVerts: Point3D[][] = []
for (let i = 0; i < U_STEPS; i++) {
  const row: Point3D[] = []
  const u = (i / U_STEPS) * TWO_PI
  const cu = Math.cos(u)
  const su = Math.sin(u)
  for (let j = 0; j < V_STEPS; j++) {
    const v = (j / V_STEPS) * TWO_PI
    const cv = Math.cos(v)
    const sv = Math.sin(v)
    row.push({
      x: (MAJOR_R + MINOR_R * cv) * cu,
      y: (MAJOR_R + MINOR_R * cv) * su,
      z: MINOR_R * sv,
    })
  }
  baseVerts.push(row)
}

function rotY(point: Point3D, angle: number): Point3D {
  const ca = Math.cos(angle)
  const sa = Math.sin(angle)
  return { x: point.x * ca + point.z * sa, y: point.y, z: -point.x * sa + point.z * ca }
}

function rotX(point: Point3D, angle: number): Point3D {
  const ca = Math.cos(angle)
  const sa = Math.sin(angle)
  return { x: point.x, y: point.y * ca - point.z * sa, z: point.y * sa + point.z * ca }
}

function drawTorus(t: number): void {
  const canvasWidth = cols * SCALE
  const canvasHeight = rows * SCALE
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)

  const ay = t * 0.5
  const ax = t * 0.3 + Math.sin(t * 0.1) * 0.4
  const fov = Math.min(canvasWidth, canvasHeight) * 1.1
  const camDist = 1.2
  const projected: ProjectionPoint[][] = []

  for (let i = 0; i < U_STEPS; i++) {
    const row: ProjectionPoint[] = []
    for (let j = 0; j < V_STEPS; j++) {
      let point = baseVerts[i]![j]!
      point = rotY(point, ay)
      point = rotX(point, ax)
      const d = point.z + camDist
      row.push({
        x: canvasWidth / 2 + (point.x * fov) / d,
        y: canvasHeight / 2 + (point.y * fov) / d,
        z: point.z,
      })
    }
    projected.push(row)
  }

  const layers = [
    { width: 5, alpha: 0.06 },
    { width: 3, alpha: 0.12 },
    { width: 1.5, alpha: 0.5 },
  ]

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex]!
    ctx.lineWidth = layer.width
    for (let i = 0; i < U_STEPS; i++) {
      const nextI = (i + 1) % U_STEPS
      for (let j = 0; j < V_STEPS; j++) {
        const nextJ = (j + 1) % V_STEPS
        const point = projected[i]![j]!
        const horizontal = projected[nextI]![j]!
        const depthH = 1 - (point.z + horizontal.z) * 0.5 * 1.2
        const brightnessH = Math.max(0.05, Math.min(1, depthH * 0.7 + 0.3)) * layer.alpha
        ctx.strokeStyle = `rgba(255,255,255,${brightnessH.toFixed(3)})`
        ctx.beginPath()
        ctx.moveTo(point.x, point.y)
        ctx.lineTo(horizontal.x, horizontal.y)
        ctx.stroke()

        const vertical = projected[i]![nextJ]!
        const depthV = 1 - (point.z + vertical.z) * 0.5 * 1.2
        const brightnessV = Math.max(0.05, Math.min(1, depthV * 0.7 + 0.3)) * layer.alpha
        ctx.strokeStyle = `rgba(255,255,255,${brightnessV.toFixed(3)})`
        ctx.beginPath()
        ctx.moveTo(point.x, point.y)
        ctx.lineTo(vertical.x, vertical.y)
        ctx.stroke()
      }
    }
  }
}

function initGrid(): void {
  cols = Math.min(MAX_COLS, Math.floor(window.innerWidth / avgCharW))
  rows = Math.min(MAX_ROWS, Math.floor(window.innerHeight / LINE_HEIGHT))
  canvas = document.createElement('canvas')
  canvas.width = cols * SCALE
  canvas.height = rows * SCALE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) throw new Error('torus context not available')
  ctx = context

  artEl.innerHTML = ''
  rowEls.length = 0
  for (let row = 0; row < rows; row++) {
    const div = document.createElement('div')
    div.className = 'r'
    div.style.height = div.style.lineHeight = `${LINE_HEIGHT}px`
    artEl.appendChild(div)
    rowEls.push(div)
  }
}

let resizeTimer = 0
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(initGrid, 150)
})

initGrid()

function sampleCell(imageData: Uint8ClampedArray, col: number, row: number, canvasWidth: number): number {
  let sum = 0
  const x0 = col * SCALE
  const y0 = row * SCALE
  for (let dy = 0; dy < SCALE; dy++) {
    for (let dx = 0; dx < SCALE; dx++) {
      sum += imageData[((y0 + dy) * canvasWidth + (x0 + dx)) * 4]!
    }
  }
  return sum / (SCALE * SCALE * 255)
}

let frameCount = 0
let lastFps = 0
let displayFps = 0

function render(now: number): void {
  const t = now / 1000
  const canvasWidth = cols * SCALE
  drawTorus(t)
  const imageData = ctx.getImageData(0, 0, canvasWidth, rows * SCALE).data
  const targetCellWidth = window.innerWidth / cols
  const rowWidths: number[] = []

  for (let row = 0; row < rows; row++) {
    let html = ''
    let totalWidth = 0
    for (let col = 0; col < cols; col++) {
      const brightness = sampleCell(imageData, col, row, canvasWidth)
      if (brightness < 0.02) {
        html += ' '
        totalWidth += spaceW
      } else {
        const match = findBest(brightness, targetCellWidth)
        const alphaIndex = Math.max(1, Math.min(10, Math.round(brightness * 10)))
        html += `<span class="${wCls(match.weight, match.style)} a${alphaIndex}">${esc(match.char)}</span>`
        totalWidth += match.width
      }
    }
    rowEls[row]!.innerHTML = html
    rowWidths.push(totalWidth)
  }

  const maxRowWidth = Math.max(...rowWidths)
  const blockOffset = Math.max(0, (window.innerWidth - maxRowWidth) / 2)
  for (let row = 0; row < rows; row++) {
    rowEls[row]!.style.paddingLeft = `${blockOffset + (maxRowWidth - rowWidths[row]!) / 2}px`
  }

  frameCount++
  if (now - lastFps > 500) {
    displayFps = Math.round(frameCount / ((now - lastFps) / 1000))
    frameCount = 0
    lastFps = now
    statsEl.textContent = `${cols}×${rows} | ${palette.length} variants | ${U_STEPS}×${V_STEPS} torus | ${displayFps} fps`
  }

  requestAnimationFrame(render)
}

requestAnimationFrame(render)
