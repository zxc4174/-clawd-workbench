/* @jsx h */
import type { CommandSpec, On } from 'claude-code'

// Clawd Run: a tiny endless runner above the prompt while Claude works.
// The board (./clawd-board.tsx) runs on the drawing thread and reports
// rounds through `post`; this module keeps the band's state and the best
// score. The entry module feeds it tool and turn events through the plain
// functions below.

const BOARD = 'clawd'
const BEST = 'clawd-run:best'
const ENABLED = 'clawd-run:enabled'

export const CLAWD_COMMAND: CommandSpec = {
  name: 'clawd-run',
  description: 'Clawd Run: the runner game shown while Claude works',
  argumentHint: '[on | off | play | stop]',
  immediate: true,
}

const state = {
  enabled: true,
  shown: false,
  /** `/clawd-run play` keeps the band up until `/clawd-run stop` or `hide`. */
  manual: false,
  /** A main-loop turn is running. */
  working: false,
  /** Claude waits on a permission or an AskUserQuestion: the board pauses. */
  asking: false,
  /** Bumped at the end of each main turn; the board pauses when it changes. */
  done: 0,
  best: 0,
}

let autoShow = true

const boardProps = () => ({ best: state.best, done: state.done, asking: state.asking, working: state.working })

export function setClawdRunStored(best: unknown, enabled: unknown) {
  state.best = Number(best ?? 0) || 0
  state.enabled = typeof enabled === 'boolean' ? enabled : autoShow
}

// a tool call starts on the main loop: an AskUserQuestion pauses the board
export function noteToolStart(tool: string, agentId: string | undefined): boolean {
  if (agentId !== undefined || tool !== 'AskUserQuestion' || !state.shown) return false
  state.asking = true
  return true
}

// ponytail: any main-loop tool finishing means the dialog was answered; two
// parallel calls with one still asking would resume early, a redraw later fixes it
export function noteToolEnd(agentId: string | undefined): boolean {
  if (agentId !== undefined || !state.asking) return false
  state.asking = false
  return true
}

// a turn ended: a subagent's leaves the main round alone
export function noteMainTurnDone(agentId: string | undefined): boolean {
  if (agentId !== undefined) return false
  state.working = false
  state.asking = false
  state.done += 1
  return true
}

export function registerClawdRun(on: On, showWhileWorking: boolean) {
  autoShow = showWhileWorking

  on('command.run', { command: 'clawd-run' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      state.enabled = arg === 'on'
      await $.store.set(ENABLED, state.enabled).catch(() => undefined)
      if (!state.enabled && !state.manual) state.shown = false
      $.ui.invalidate('ui.render')
      return { text: state.enabled ? 'Clawd Run: on · it appears above the prompt while Claude works' : 'Clawd Run: off · /clawd-run play shows it by hand' }
    }
    if (arg === 'play') {
      state.manual = true
      state.shown = true
      $.ui.invalidate('ui.render')
      return { text: 'Clawd Run: click the board, then Space or ↑ to run · Esc returns to the prompt · /clawd-run stop closes it' }
    }
    if (arg === 'stop') {
      state.manual = false
      state.shown = false
      $.ui.invalidate('ui.render')
      return { text: 'Clawd Run: closed' }
    }
    return { text: `Clawd Run: ${state.enabled ? 'on' : 'off'} · best ${state.best} · /clawd-run on | off | play | stop` }
  })

  on('turn.start', async ($, e, next) => {
    state.working = true
    state.asking = false
    if (state.enabled && !state.shown) state.shown = true
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // the engine alone draws the permission dialog; the board pauses behind it
  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.agent_id === undefined && state.shown) {
      state.asking = true
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // the board posts: a round started or ended, or it sat idle long enough
  // after Claude finished to fold the band away
  on('ui.message', { element: BOARD }, async ($, e) => {
    const data = e.data as { event?: unknown; score?: unknown } | null
    if (data?.event === 'over') {
      const score = typeof data.score === 'number' ? data.score : 0
      if (score > state.best) {
        state.best = score
        await $.store.set(BEST, score).catch(err => $.ui.log(`clawd-run: best score not saved: ${err}`))
        $.ui.toast(`Clawd Run: new best ${score}`)
      }
    }
    if (data?.event === 'collapse' && !state.manual && !state.working) {
      state.shown = false
      $.ui.invalidate('ui.render')
    }
    return { props: boardProps() }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // the board needs a terminal's keys and mouse; elsewhere the band is others'
    if (!state.shown || e.props.hasSurvey || e.surface !== 'terminal') return next(e)
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const cols = Math.max(24, e.props.bodyColumns)
    // the runner is 4 rows tall and jumps 3 more over a large cactus; one more
    // row holds the ground specks
    const rows = Math.min(13, Math.max(11, e.props.maxRows - 1))
    const hide = () => {
      state.shown = false
      state.manual = false
      $.ui.invalidate('ui.render')
    }
    const mood = state.asking ? 'Claude needs you' : state.working ? 'Claude is working' : 'Claude is done'
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Text color="#ff9f43" bold>Clawd Run</Text>
          <Text dimColor>{`· ${mood} · click the board to play, Esc returns to the prompt`}</Text>
          <Button key="clawd-hide" label="hide" dimColor onPress={hide} />
        </Box>
        <Client key={BOARD} module="./clawd-board.tsx" width={cols} height={rows} props={boardProps()} />
        {await next(e)}
      </Box>
    )
  })
}
