import { describe, expect, test } from 'claude-code/testing'

import { CLAWD_X, GRAVITY, JUMP_V, MAX_SPEED, collides, groundRow, jump, newGame, onGround, runnerBox, speedFor, step, type Game } from '../hooks/game.ts'

// a board that never spawns on its own, so each test places its obstacles
const quiet = (): Game => ({ ...newGame(40, 10), gap: 1e9 })
const rng = () => 0.5

describe('clawd run', () => {
  test('a jump leaves the ground, cannot double, and gravity brings the runner back', () => {
    let g = jump(quiet())
    expect(g.vy).toBe(JUMP_V)
    g = step(g, rng)
    expect(g.y).toBeGreaterThan(0)
    expect(onGround(g)).toBe(false)
    expect(jump(g)).toBe(g)
    let apex = 0
    let ticks = 1
    while (!onGround(g) && ticks < 100) {
      apex = Math.max(apex, g.y)
      g = step(g, rng)
      ticks++
    }
    expect(onGround(g)).toBe(true)
    expect(apex).toBeGreaterThanOrEqual(4)
    expect(ticks).toBeGreaterThanOrEqual(9)
    expect(ticks).toBeLessThanOrEqual(13)
    expect(g.over).toBe(false)
  })

  test('an obstacle under the runner ends the round, and the round then stands still', () => {
    const g = { ...quiet(), obstacles: [{ x: CLAWD_X + 2, w: 1, h: 1 }] }
    expect(collides(g)).toBe(true)
    const over = step(g, rng)
    expect(over.over).toBe(true)
    expect(step(over, rng)).toBe(over)
    expect(jump(over)).toBe(over)
  })

  test('a tall obstacle hits a runner on the ground but not one at the apex', () => {
    const grounded = { ...quiet(), obstacles: [{ x: CLAWD_X + 1, w: 2, h: 3 }] }
    expect(collides(grounded)).toBe(true)
    const up = { ...grounded, y: 5, vy: 0 }
    expect(runnerBox(up).y1).toBeLessThan(groundRow(up) - 3)
    expect(collides(up)).toBe(false)
  })

  test('a well-timed jump clears a low obstacle', () => {
    let g: Game = jump({ ...quiet(), obstacles: [{ x: CLAWD_X + 7, w: 1, h: 1 }] })
    for (let i = 0; i < 14; i++) g = step(g, rng)
    expect(g.over).toBe(false)
    expect(g.score).toBe(14)
    expect(g.obstacles.length === 0 || (g.obstacles[0]?.x ?? 0) < CLAWD_X).toBe(true)
  })

  test('obstacles spawn when the gap runs out and scroll off the left edge', () => {
    let g: Game = { ...newGame(30, 10), gap: 1 }
    g = step(g, rng)
    expect(g.obstacles).toHaveLength(1)
    expect(g.obstacles[0]?.x).toBe(30)
    expect(g.gap).toBeGreaterThan(10)
    for (let i = 0; i < 40 && !g.over; i++) g = { ...step(g, rng), gap: 1e9 }
    expect(g.over).toBe(true)
    const cleared = { ...g, over: false, obstacles: [{ x: 0, w: 1, h: 1 }], y: 0, vy: 0 }
    expect(step(cleared, rng).obstacles).toHaveLength(0)
  })

  test('speed ramps with the score and caps', () => {
    expect(speedFor(0)).toBe(1)
    expect(speedFor(400)).toBe(2)
    expect(speedFor(100000)).toBe(MAX_SPEED)
    let g = quiet()
    for (let i = 0; i < 200; i++) g = step(g, rng)
    expect(g.speed).toBeGreaterThan(1.4)
    expect(g.speed).toBeLessThan(1.6)
    expect(GRAVITY).toBeGreaterThan(0)
  })
})
