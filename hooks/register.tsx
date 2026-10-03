import type { Register } from 'claude-code'

import { CLAWD_COMMAND, noteMainTurnDone, noteToolEnd, noteToolStart, registerClawdRun, setClawdRunStored } from './clawd-run.tsx'

// Clawd Run's entry. The events a plugin may hook only once (`session.start`,
// `tool.call`, `turn.complete`) are hooked here; the engine follows `$` only
// within one file, so this file calls the module's plain functions and makes
// the few `$` calls itself.
export const register: Register = (on, options) => {
  registerClawdRun(on, options.auto !== false)

  on('session.start', async ($, e, next) => {
    await $.command.register(CLAWD_COMMAND).catch(err => $.ui.log(`clawd-run: /${CLAWD_COMMAND.name} not registered: ${err}`))
    // a store that cannot be read costs the best score, never the game
    setClawdRunStored(await $.store.get('clawd-run:best').catch(() => undefined), await $.store.get('clawd-run:enabled').catch(() => undefined))
    return next(e)
  })

  // the board pauses behind a question and resumes after it
  on('tool.call', async ($, e, next) => {
    if (noteToolStart(String(e.tool), e.agentId)) $.ui.invalidate('ui.render')
    const r = await next(e)
    if (noteToolEnd(e.agentId)) $.ui.invalidate('ui.render')
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (noteMainTurnDone(e.agentId)) $.ui.invalidate('ui.render')
    return r
  })
}
