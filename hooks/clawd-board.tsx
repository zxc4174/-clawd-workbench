/* @jsx h */
import type { ClientSurface } from 'claude-code'

import { TICK_MS, groundRow, jump, newGame, obstacleBox, onGround, runnerBox, step, type Game } from './game.ts'

// The board is a Client surface module: it runs on the drawing thread with its
// own frame clock, receives keys only after a click gave it the focus (Esc
// hands them back to the prompt) and reaches the hooks module only through
// `post`. No model call, no shell, no server: the whole game is here and in
// ./game.ts. The sprite is an original pixel Clawd-style runner, not an
// official asset.

export type BoardProps = { best?: number; done?: number; asking?: boolean; working?: boolean } | undefined
type State = {
  game: Game | null
  playing: boolean
  banner: string | null
  seenDone: number
  seenAsking: boolean
  working: boolean
  /** Ticks left before the board asks to be folded away; null while not counting. */
  idle: number | null
  /** Ticks since the last key or click while no round runs. */
  still: number
  /** Ticks since the board appeared: Clawd jumps in from the left. */
  enter: number
}

/** Three seconds without a key or click while no round runs: the typing scene. */
export const STILL_TICKS = Math.round(3000 / TICK_MS)

/** Twelve seconds of nothing after Claude finished: the band folds away. */
export const IDLE_TICKS = 150

/** About a second for the entrance jump. */
export const ENTER_TICKS = 12

const ORANGE = '#d77757'
const DARK = '#1b1b1b'
/** The shaded back of the side-on body, for depth; the front view has none. */
const SHADE = '#a95c43'
// the night-mode look of the browser's offline runner game
const BG = '#202124'
const FG = '#acacac'

type Paint = readonly [glyph: string, color?: string, bg?: string]
type Run = [text: string, color?: string, bg?: string]

// one styled run per stretch of characters sharing both colours
function runs(chars: number, at: (x: number) => Paint): Run[] {
  const out: Run[] = []
  for (let x = 0; x < chars; x++) {
    const [glyph, color, bg] = at(x)
    const last = out[out.length - 1]
    if (last && last[1] === color && last[2] === bg) last[0] += glyph
    else out.push([glyph, color, bg])
  }
  return out
}

// The runner in sextant pixels: each character holds 2 x 3 pixels (Unicode
// "Symbols for Legacy Computing", drawn natively by iTerm2 and Windows
// Terminal), so a pixel is about square and half the size of a half block.
// 24 x 12 pixels = 12 characters x 4 rows. O body, S its shaded side, E eye (a hole that shows
// the terminal background; an x when the runner crashes), . empty.
const STAND = [
  '....OOOOOOOOOOOOOOOO....',
  '....OOOOOOOOOOOOOOOO....',
  '....OOOOOOOOOOOOOOOO....',
  '.OOOOOEEOOOOOOOOEEOOOOO.',
  '.OOOOOEEOOOOOOOOEEOOOOO.',
  '.OOOOOOOOOOOOOOOOOOOOOO.',
  '....OOOOOOOOOOOOOOOO....',
  '....OOOOOOOOOOOOOOOO....',
  '....OOOOOOOOOOOOOOOO....',
  '....OO..OO....OO..OO....',
  '....OO..OO....OO..OO....',
  '....OO..OO....OO..OO....',
]
// mid-stride, from the running reference: one arm up, legs splayed, eyes
// to the right (the way it runs). S is the shaded side (the back and back
// arm on the left, the far legs); shading follows whole 2-pixel columns so each character
// keeps one colour.
const RUN = [
  '....SSOOOOOOOOOOOOOO....',
  '....SSOOOOOOOOOOOOOO....',
  '....SSOOOOEEOOOOOOEE....',
  '....SSOOOOEEOOOOOOEEOOO.',
  '....SSOOOOOOOOOOOOOOOOO.',
  '.SSSSSOOOOOOOOOOOOOOOOO.',
  '.SSSSSOOOOOOOOOOOOOO....',
  '....SSOOOOOOOOOOOOOO....',
  '....OO..SS...OO...SS....',
  '...OO...SSS..OOO...SS...',
  '..OO.....SS...OO....SS..',
  '..OO.....SS.........SS..',
]

// Idle: after three seconds with no key or click while no round runs, the
// runner types at a green computer on its right, from the reference picture
// (mirrored). 34 x 12 pixels = 17 characters x 4 rows; letters are colours,
// S the shaded back (left side) of Clawd.
const TYPING = [
  '..SSOOOOOOOOOOOOOO................',
  '..SSOOO..OOOOOOOO.................',
  '..SSOOO..OOOOOOOO......LLLLLLGG...',
  '..SSOOOOOOOOOOOOOO....LDYYYDLGGG..',
  '..SSOOOOOOOOOOOOOO....LDYYDDLGGGG.',
  '..SSOOOOOOOOOOOOOOOOOLDDDDDLGGGGG.',
  '..SSOOOOOOOOOOOOOOOOOLDDDDDLGGGGG.',
  '..SSOOOOOOOOOOOOOOOOOLLLLLLGGGGG..',
  '..SSOOOOOOOOOOOOOOOO..GGGGGDDDD...',
  '..SS..OO....OOOOOOOOLLLLLLGGGGGGG.',
  '.SSS.OOO...OOO.OOOLGLGLGGLGGGGGGG.',
  '..SS..OO....OO..OOLGLGLGGLGGGGGGG.',
]
const PALETTE: Record<string, string> = { O: ORANGE, S: SHADE, G: '#508d76', L: '#89c1ac', D: '#1e4439', Y: '#e5b464' }
// the cursor line on the screen blinks: the second frame has no amber text
const TYPING_BLINK = TYPING.map(row => row.replace(/Y/g, 'D'))

// the sextant for a 2 x 3 block of pixels, bits from top-left row by row;
// U+1FB00.. skips the three patterns block elements already cover
function sextant(bits: number): string {
  if (bits === 0) return ' '
  if (bits === 63) return '█'
  if (bits === 21) return '▌'
  if (bits === 42) return '▐'
  return String.fromCodePoint(0x1fb00 + bits - 1 - (bits > 21 ? 1 : 0) - (bits > 42 ? 1 : 0))
}

const popcount = (n: number): number => (n ? (n & 1) + popcount(n >> 1) : 0)

type Cell = { ch: string; eye: boolean; color: string }
function toCells(art: readonly string[]): Cell[][] {
  return Array.from({ length: art.length / 3 }, (_, r) =>
    Array.from({ length: (art[0]?.length ?? 0) / 2 }, (_, c) => {
      let bits = 0
      let eye = false
      let shade = 0
      for (let i = 0; i < 6; i++) {
        const px = art[r * 3 + (i >> 1)]?.[c * 2 + (i & 1)]
        if (px === 'O' || px === 'S') bits |= 1 << i
        if (px === 'S') shade++
        if (px === 'E') eye = true
      }
      // the colour most of the character's pixels have
      return { ch: sextant(bits), eye, color: shade * 2 > popcount(bits) ? SHADE : ORANGE }
    }),
  )
}
const STAND_CELLS = toCells(STAND)
// the passing step: legs under the body, two feet down and two lifted;
// alternates with RUN's splayed stride while the runner is on the ground
const RUN_PASS_CELLS = toCells([
  ...RUN.slice(0, 8),
  '....OO..SS...OO...SS....',
  '....OO..SS...OO...SS....',
  '....OO.......OO.........',
  '....OO.......OO.........',
])

// a coloured 2 x 3 block: the commonest colour is the glyph, the next one
// (if any) the background behind it
function toPaints(art: readonly string[]): Paint[][] {
  return Array.from({ length: art.length / 3 }, (_, r) =>
    Array.from({ length: (art[0]?.length ?? 0) / 2 }, (_, c): Paint => {
      const px = Array.from({ length: 6 }, (_, i) => art[r * 3 + (i >> 1)]?.[c * 2 + (i & 1)] ?? '.')
      const ranked = [...new Set(px.filter(x => x !== '.'))].sort((a, b) => px.filter(x => x === b).length - px.filter(x => x === a).length)
      const [fg, bg] = ranked
      if (!fg) return [' ']
      const bits = px.reduce((n, x, i) => (x === fg ? n | (1 << i) : n), 0)
      return bg ? [sextant(bits), PALETTE[fg], PALETTE[bg]] : [sextant(bits), PALETTE[fg]]
    }),
  )
}
const TYPING_FRAMES = [toPaints(TYPING), toPaints(TYPING_BLINK)]
const RUN_CELLS = toCells(RUN)

// cacti in the game grey, standing on the ground line
const CACTUS: Record<number, readonly string[]> = {
  2: ['▖██▗', '▀██▀'],
  3: ['▄ ██ ▄', '█ ██ █', '▀▀██▀▀'],
}

// one character of the sprite; dx 0..11 across, dy 0..3 down. Standing
// before a round, striding (two leg frames) while it runs, splayed in the
// air, x x eyes once it crashed.
export function spriteChar(g: Game, dx: number, dy: number, isRunning: boolean): Paint | null {
  const stride = onGround(g) && Math.floor(g.ticks / 3) % 2 === 1 ? RUN_PASS_CELLS : RUN_CELLS
  const cell = (isRunning && !g.over ? stride : STAND_CELLS)[dy]?.[dx]
  if (!cell) return null
  if (cell.eye && g.over) return ['x', DARK, cell.color]
  return cell.ch === ' ' ? null : [cell.ch, cell.color]
}

export function cactusChar(o: { w: number; h: number }, dx: number, dy: number): string | null {
  const ch = CACTUS[o.w]?.[dy]?.[dx] ?? ' '
  return ch === ' ' ? null : ch
}

// ponytail: integer hash for the scenery, no stored world
const hash = (n: number): number => (Math.imul(n | 0, 2654435761) >>> 0) % 997

// the specks under the ground line, scrolling with the world
export function speckChar(wx: number): string {
  const r = hash(wx)
  return r < 40 ? '·' : r < 70 ? '-' : r < 85 ? '¯' : ' '
}

// the ground line, mostly flat (─) with the odd bump (▔) or dip (▁): at most
// one per 24 characters, scrolling with the world
export function groundChar(wx: number): string {
  const k = Math.floor(wx / 24)
  const r = hash(k + 3)
  const at = wx - k * 24 - (r % 18)
  if (r % 4 > 1 || at < 0 || at >= 2 + (r % 3)) return '─'
  return r % 4 === 0 ? '▔' : '▁'
}

const pad5 = (n: number): string => String(Math.min(99999, n)).padStart(5, '0')

export default function Board(props: BoardProps, surface: ClientSurface<State>) {
  const { Box, Text } = surface.elements
  // (no local named `h` anywhere here: every JSX tag compiles to a call of `h`)
  // one row below the game for the ground specks, one for the status line
  const size = () => ({ bw: Math.max(20, Math.floor(surface.columns / 2)), bh: Math.max(6, surface.rows - 2) })

  const start = () => {
    const s = surface.state
    if (!s) return
    const { bw, bh } = size()
    surface.setState({ ...s, game: jump(newGame(bw, bh)), playing: true, banner: null, idle: null, still: 0 })
    surface.post({ event: 'start' })
  }
  // Space, ↑, W, Enter or a click: jump, or start a round when none is running
  const press = () => {
    const s = surface.state
    if (!s) return
    if (!s.game || s.game.over) return start()
    surface.setState({ ...s, game: jump(s.game), playing: true, banner: null, still: 0 })
  }

  if (surface.state === undefined) {
    surface.setState({ game: null, playing: false, banner: null, seenDone: props?.done ?? 0, seenAsking: props?.asking ?? false, working: props?.working ?? false, idle: null, still: 0, enter: 0 })
    // the one timer of the board; the engine ends it with the instance
    surface.every(TICK_MS, () => {
      const s = surface.state
      if (!s) return
      if (s.enter < ENTER_TICKS && !s.game) return surface.setState({ ...s, enter: s.enter + 1 })
      // no round running: count towards the typing scene, then only redraw
      // twice a second for the blinking screen
      const isStill = !s.playing || !s.game || s.game.over
      if (isStill && s.idle === null) {
        const still = s.still + 1
        if (still < STILL_TICKS || still % 6 === 0) surface.setState({ ...s, still })
        else s.still = still
        return
      }
      if (s.idle !== null) {
        if (s.idle <= 1) surface.post({ event: 'collapse' })
        surface.setState({ ...s, idle: s.idle <= 1 ? null : s.idle - 1 })
        return
      }
      if (!s.game || !s.playing || s.game.over) return
      const game = step(s.game)
      if (game.over) surface.post({ event: 'over', score: game.score })
      surface.setState({ ...s, game, playing: !game.over, idle: game.over && !s.working ? IDLE_TICKS : null })
    })
    surface.onKey(({ key }) => {
      const s = surface.state
      if (!s) return
      if (s.still >= STILL_TICKS) return surface.setState({ ...s, still: 0 })
      if (s.still !== 0) surface.setState({ ...s, still: 0 })
      const k = key === 'space' ? ' ' : key.toLowerCase()
      if (k === 'p') {
        if (s.game && !s.game.over) surface.setState({ ...s, playing: !s.playing, banner: null })
      } else if (k === 'r') start()
      else if (k === ' ' || k === 'up' || k === 'w' || k === 'return') press()
    })
    surface.onPointer(ev => {
      if (ev.type !== 'down') return
      const s = surface.state
      if (s && s.still >= STILL_TICKS) return surface.setState({ ...s, still: 0 })
      press()
    })
  }

  // the hooks module bumps `done` when Claude's own turn ends and raises
  // `asking` while Claude waits on a permission or a question: pause and say so
  const seen = surface.state
  if (seen) {
    const done = props?.done ?? 0
    const asking = props?.asking ?? false
    const working = props?.working ?? false
    const live = seen.game !== null && !seen.game.over
    if (done !== seen.seenDone || asking !== seen.seenAsking || working !== seen.working) {
      const next: State = { ...seen, seenDone: done, seenAsking: asking, working }
      if (done !== seen.seenDone) {
        // Claude finished: pause a live round; an idle board starts the fold-away count
        next.playing = false
        next.idle = live ? null : IDLE_TICKS
        next.banner = live ? 'Claude is done · P resumes · Esc returns to the prompt' : null
      } else if (asking !== seen.seenAsking) {
        // a permission or a question is up: pause; answered, stay paused until P
        if (asking) next.playing = false
        next.banner = asking && live ? 'Claude needs you · the game is paused' : null
      }
      if (working) next.idle = null
      surface.setState(next)
    }
  }

  const s = surface.state
  const g = s?.game ?? null
  const { bw, bh } = g ? { bw: g.w, bh: g.h } : size()
  const cols = Math.min(bw, Math.max(1, Math.floor(surface.columns / 2)))
  const rowCount = Math.min(bh + 1, Math.max(1, surface.rows - 1))
  const sprite = g ?? newGame(bw, bh)
  const gr = groundRow(sprite)
  const box = runnerBox(sprite)
  // idle: the typing scene stands on the ground in the runner's place, its
  // runner's body over the runner's own columns
  const isTyping = (s?.still ?? 0) >= STILL_TICKS
  const scene = TYPING_FRAMES[Math.floor((s?.still ?? 0) / 6) % 2] ?? []
  const sceneX = box.x0 * 2 + 1
  const sceneY = gr - scene.length
  // entrance: Clawd leaps in from off the left edge onto its spot
  const enter = s?.enter ?? ENTER_TICKS
  const entering = !g && enter < ENTER_TICKS
  const t = enter / ENTER_TICKS
  const runX = box.x0 * 2 - (entering ? Math.round((1 - t) * (box.x0 * 2 + 12)) : 0)
  const runY = box.y0 - (entering ? Math.round(3 * Math.sin(Math.PI * t)) : 0)
  const dist = Math.floor((g?.dist ?? 0) * 2)
  const width = cols * 2
  const best = props?.best ?? 0
  const score = g ? `HI ${pad5(best)} ${pad5(g.score)}` : `HI ${pad5(best)}`
  const overText = 'G A M E   O V E R'
  const overRow = Math.max(1, Math.floor(gr / 2) - 2)
  const overX = Math.floor((width - overText.length) / 2)
  const btnX = Math.floor((width - 5) / 2)
  const text = (str: string, x0: number, cx: number): string | null => {
    const ch = str[cx - x0]
    return ch && ch !== ' ' ? ch : null
  }
  // per character: a game cell is two characters wide
  const paint = (cx: number, y: number): Paint => {
    if (y === gr) return [groundChar(cx + dist), FG]
    if (y > gr) return [speckChar(cx + dist), FG]
    if (y === 0) {
      const ch = text(score, width - score.length - 1, cx)
      if (ch) return [ch, FG]
    }
    if (g?.over) {
      const ch = y === overRow ? text(overText, overX, cx) : null
      if (ch) return [ch, FG]
      if (y === overRow + 2 && cx >= btnX && cx < btnX + 5) return [cx === btnX + 2 ? '↻' : ' ', BG, FG]
    }
    const x = Math.floor(cx / 2)
    if (isTyping) {
      const cell = scene[y - sceneY]?.[cx - sceneX]
      if (cell && cell[0] !== ' ') return cell
      if (cx - sceneX >= 0 && cx - sceneX < (scene[0]?.length ?? 0) && y >= sceneY) return [' ']
    }
    if (!isTyping && cx >= runX && y >= runY && y <= runY + box.y1 - box.y0) {
      const cell = spriteChar(sprite, cx - runX, y - runY, g !== null || entering)
      if (cell) return cell
    }
    if (g) {
      for (const o of g.obstacles) {
        const b = obstacleBox(g, o)
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) {
          const ch = cactusChar(o, cx - b.x0 * 2, y - b.y0)
          if (ch) return [ch, FG]
        }
      }
    }
    return [' ']
  }
  // every cell on the night background
  const at = (cx: number, y: number): Paint => {
    const [glyph, color, bg] = paint(cx, y)
    return [glyph, color, bg ?? BG]
  }
  const lines = Array.from({ length: rowCount }, (_, y) => (
    <Text>
      {runs(cols * 2, x => at(x, y)).map(([text, color, bg]) =>
        bg ? <Text color={color} backgroundColor={bg}>{text}</Text> : color ? <Text color={color}>{text}</Text> : <Text>{text}</Text>,
      )}
    </Text>
  ))
  const status = isTyping
    ? `Clawd Run · Clawd is typing… · click or press any key to play · best ${best}`
    : !g
    ? `Clawd Run · click here, then Space or ↑ to run · best ${best}`
    : g.over
      ? `Clawd Run · crashed at ${g.score} · best ${best} · Space or R runs again`
      : !s?.playing
        ? `Clawd Run · paused · score ${g.score} · P resumes`
        : `Clawd Run · score ${g.score} · best ${best} · Space/↑ jump · P pause · R restart · Esc → prompt`
  return (
    <Box flexDirection="column">
      {lines}
      {s?.banner ? (
        <Text color="yellow" bold wrap="truncate-end">{`● ${s.banner}`}</Text>
      ) : (
        <Text dimColor wrap="truncate-end">{status}</Text>
      )}
    </Box>
  )
}
