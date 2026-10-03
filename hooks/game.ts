// Clawd Run: the pure game. No timers, no drawing; `step` advances one tick.
// The runner is an original pixel character in the spirit of Claude Code's
// Clawd mascot (orange block body, two eyes, short legs). It is not an
// official asset.

export const TICK_MS = 80
export const CLAWD_X = 3
/** 6 cells (12 characters) by 4 rows: see the sprite in ./clawd-board.tsx */
export const CLAWD_W = 6
export const CLAWD_H = 4
export const JUMP_V = 2.2
export const GRAVITY = 0.4
export const MAX_SPEED = 2.6

export type Obstacle = { x: number; w: number; h: number }
export type Game = {
  w: number
  h: number
  /** Height of the runner's feet above the ground, in rows. */
  y: number
  vy: number
  obstacles: Obstacle[]
  score: number
  /** Cells scrolled per tick. */
  speed: number
  over: boolean
  ticks: number
  /** Cells left before the next obstacle may spawn. */
  gap: number
  /** Cells scrolled so far: the ground specks and clouds move by it. */
  dist: number
}
export type Box = { x0: number; x1: number; y0: number; y1: number }

export const groundRow = (g: Game): number => g.h - 1
export const feetRow = (g: Game): number => groundRow(g) - 1 - Math.round(g.y)
export const onGround = (g: Game): boolean => g.y <= 0 && g.vy <= 0
export const speedFor = (score: number): number => Math.min(MAX_SPEED, 1 + score / 400)

export function newGame(w: number, h: number): Game {
  return { w: Math.max(20, w), h: Math.max(6, h), y: 0, vy: 0, obstacles: [], score: 0, speed: 1, over: false, ticks: 0, gap: 24, dist: 0 }
}

export function jump(g: Game): Game {
  return g.over || !onGround(g) ? g : { ...g, vy: JUMP_V }
}

export function runnerBox(g: Game): Box {
  const feet = feetRow(g)
  return { x0: CLAWD_X, x1: CLAWD_X + CLAWD_W - 1, y0: feet - CLAWD_H + 1, y1: feet }
}

export function obstacleBox(g: Game, o: Obstacle): Box {
  const x0 = Math.floor(o.x)
  return { x0, x1: x0 + o.w - 1, y0: groundRow(g) - o.h, y1: groundRow(g) - 1 }
}

// ponytail: axis-aligned boxes with one column of forgiveness on the runner's tail
export function collides(g: Game): boolean {
  const r = runnerBox(g)
  return g.obstacles.some(o => {
    const b = obstacleBox(g, o)
    return b.x0 <= r.x1 - 1 && b.x1 >= r.x0 && b.y0 <= r.y1 && b.y1 >= r.y0
  })
}

export function step(g: Game, rng: () => number = Math.random): Game {
  if (g.over) return g
  let vy = g.vy - GRAVITY
  let y = g.y + vy
  if (y <= 0) {
    y = 0
    vy = 0
  }
  // the head may reach the board's top row, no further
  const ceiling = Math.max(0, g.h - CLAWD_H - 1)
  if (y > ceiling) {
    y = ceiling
    vy = Math.min(vy, 0)
  }
  const score = g.score + 1
  const speed = speedFor(score)
  let obstacles = g.obstacles.map(o => ({ ...o, x: o.x - speed })).filter(o => o.x + o.w > 0)
  let gap = g.gap - speed
  if (gap <= 0) {
    // a small cactus (2 cells x 2 rows) or a large one (3 x 3), drawn by the board
    const big = rng() < 0.35
    obstacles = [...obstacles, { x: g.w, w: big ? 3 : 2, h: big ? 3 : 2 }]
    gap = 18 + Math.floor(rng() * 14) + speed * 6
  }
  const next: Game = { ...g, y, vy, obstacles, score, speed, ticks: g.ticks + 1, gap, dist: g.dist + speed }
  return collides(next) ? { ...next, over: true } : next
}
