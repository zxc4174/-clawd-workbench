import type { On } from 'claude-code'
import { expect, mock, test, type Mounted } from 'claude-code/testing'

const cmd = (command: string, args: string) => ({ command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } })
const BAND = {
  plugin: 'clawd-run',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 14, bodyColumns: 100, scroll: { offset: 0, bodyRows: 14 }, view: {} },
  viewport: { columns: 100, rows: 40 },
}
const TURN = { answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const }
// the engine draws nothing of its own in the band: the test stands in for it
const band = (on: On) => on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box' as const }))
// Clawd's entrance jump from the left edge, 12 ticks
const ENTER = 80 * 12
const status = async (ui: Mounted<'terminal', 'AbovePrompt'>) => (await ui.findAll({ in: 'clawd', type: 'Text' })).map(t => t.text).join('\n')

test('the board runs on its own clock: jump, score, pause, restart', async ($, on) => {
  band(on)
  mock.store(on)
  await $.command.run(cmd('clawd-run', 'play'))
  const ui = await $.ui.mount(BAND)
  await ui.resize({ columns: 100, rows: 11, in: 'clawd' })
  expect(await status(ui)).toContain('click here, then Space')
  // the entrance starts off the left edge and lands on the runner's spot
  expect(await ui.find({ in: 'clawd', type: 'Text', text: /[\u{1FB00}-\u{1FB3B}]/u })).toBeUndefined()
  await ui.advance(ENTER)
  expect(await ui.find({ in: 'clawd', type: 'Text', text: /[\u{1FB00}-\u{1FB3B}]/u })).toBeDefined()
  await ui.key({ key: ' ', in: 'clawd' })
  expect(await status(ui)).toContain('score 0')
  await ui.advance(80 * 5)
  expect(await status(ui)).toContain('score 5')
  await ui.key({ key: 'p', in: 'clawd' })
  await ui.advance(80 * 5)
  expect(await status(ui)).toContain('paused · score 5')
  await ui.key({ key: 'p', in: 'clawd' })
  await ui.advance(80)
  expect(await status(ui)).toContain('score 6')
  await ui.key({ key: 'r', in: 'clawd' })
  expect(await status(ui)).toContain('score 0')
  await ui.unmount()
})

test('a crash ends the round, the best score is kept and comes back as props', async ($, on) => {
  band(on)
  mock.store(on)
  await $.command.run(cmd('clawd-run', 'play'))
  const ui = await $.ui.mount(BAND)
  await ui.resize({ columns: 100, rows: 11, in: 'clawd' })
  await ui.key({ key: ' ', in: 'clawd' })
  await ui.advance(80 * 200)
  const text = await status(ui)
  expect(text).toContain('crashed at')
  const best = Number(/best (\d+)/.exec(text)?.[1])
  expect(best).toBeGreaterThan(10)
  expect(await ui.find({ in: 'clawd', type: 'Text', text: /x/ })).toBeDefined()
  await ui.unmount()
  // a fresh instance starts from nothing: no timer of the old one survives
  const again = await $.ui.mount(BAND)
  await again.resize({ columns: 100, rows: 11, in: 'clawd' })
  expect(await status(again)).toContain(`click here, then Space or ↑ to run · best ${best}`)
  await again.advance(80 * 10)
  expect(await status(again)).toContain('click here')
  await again.unmount()
})

test('the band appears when a turn starts and goes when the game is off', async ($, on) => {
  band(on)
  mock.store(on)
  on('turn.start', () => ({ turnId: 't1' }))
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Client', key: 'clawd' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Claude is working/ })).toBeDefined()
  await ui.press({ key: 'clawd-hide' })
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
  await $.command.run(cmd('clawd-run', 'off'))
  await $.turn.start({ text: 'go', turnId: 't2' })
  const off = await $.ui.mount(BAND)
  expect(await off.find({ type: 'Client' })).toBeUndefined()
  await off.unmount()
  await $.command.run(cmd('clawd-run', 'on'))
})

test('claude finishing its own turn pauses the round; a subagent finishing or a permission ask does not end it', async ($, on) => {
  band(on)
  mock.store(on)
  on('turn.start', () => ({ turnId: 't1' }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.PermissionRequest', () => ({}))
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(BAND)
  await ui.resize({ columns: 100, rows: 11, in: 'clawd' })
  await ui.key({ key: ' ', in: 'clawd' })
  await ui.advance(80 * 3)
  await $.turn.complete({ ...TURN, agentId: 'sub-1' })
  await ui.advance(80 * 2)
  expect(await status(ui)).toContain('score 5')

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  expect(await status(ui)).toContain('Claude needs you')
  expect(await ui.find({ type: 'Text', text: /Claude needs you/ })).toBeDefined()
  await ui.advance(80 * 2)
  expect(await status(ui)).toContain('Claude needs you')

  await $.turn.complete(TURN)
  expect(await status(ui)).toContain('Claude is done')
  await ui.advance(80 * 5)
  expect(await status(ui)).toContain('Claude is done')
  await ui.key({ key: 'p', in: 'clawd' })
  await ui.advance(80)
  expect(await status(ui)).toContain('score 6')
  await ui.unmount()
})

test('three seconds without input while no round runs: the runner types at its computer; a key wakes it', async ($, on) => {
  band(on)
  mock.store(on)
  await $.command.run(cmd('clawd-run', 'play'))
  const ui = await $.ui.mount(BAND)
  await ui.resize({ columns: 100, rows: 11, in: 'clawd' })
  await ui.advance(ENTER + 2900)
  expect(await status(ui)).toContain('click here')
  await ui.advance(200)
  expect(await status(ui)).toContain('Clawd is typing')
  expect(await ui.find({ in: 'clawd', type: 'Text', text: /[\u{1FB00}-\u{1FB3B}]/u })).toBeDefined()
  await ui.key({ key: 'a', in: 'clawd' })
  expect(await status(ui)).toContain('click here')
  await ui.key({ key: ' ', in: 'clawd' })
  await ui.advance(80 * 50)
  expect(await status(ui)).not.toContain('typing')
  await ui.unmount()
})

test('the legs alternate between two frames while it runs', async ($, on) => {
  band(on)
  mock.store(on)
  await $.command.run(cmd('clawd-run', 'play'))
  const ui = await $.ui.mount(BAND)
  await ui.resize({ columns: 100, rows: 11, in: 'clawd' })
  await ui.key({ key: ' ', in: 'clawd' })
  // let the opening jump land, then sample the leg row over a few frames
  await ui.advance(80 * 12)
  // the board's rows are the Box's direct Text children; before the status
  // line come the ground specks, the ground, and above it the legs
  const legRow = async () => {
    const box = await ui.drawn({ in: 'clawd' })
    const rows = ((box as { children?: unknown[] }).children ?? [])
    return JSON.stringify(rows[rows.length - 4])
  }
  const legRows = new Set<string>()
  for (let i = 0; i < 4; i++) {
    expect(await status(ui)).toContain('score')
    legRows.add(await legRow())
    await ui.advance(80 * 3)
  }
  expect(legRows.size).toBeGreaterThanOrEqual(2)
  await ui.unmount()
})
