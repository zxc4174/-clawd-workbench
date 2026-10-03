# Clawd Run

A Claude Code **mod**: a Chrome-dino style runner above the prompt while Claude works.

Clawd jumps in from the left, runs on a bumpy night-mode ground and hops over cacti; the score climbs with the speed and the best score is kept across sessions. Leave it alone for three seconds and Clawd sits down to type at a computer. The runner is an original pixel sprite in the spirit of Claude Code's Clawd mascot, drawn in Unicode sextant characters (**not an official asset**).

## Requirements

- Claude Code **2.1.287 or later** (mods are on by default).
- A terminal session (`claude` in iTerm2, Ghostty, kitty, Windows Terminal, …) or the Desktop app's Code tab: that is where mods draw. In the VS Code extension, `claude -p` and cloud sessions nothing is drawn.
- A font with the Unicode "Symbols for Legacy Computing" block (iTerm2 and Windows Terminal draw it natively).

## Install

This repository is the plugin and its own marketplace:

```bash
/plugin marketplace add zxc4174/-clawd-workbench
/plugin install clawd-run@clawd-run
/reload-plugins
```

From a clone: `claude plugin marketplace add /path/to/clone`, then the same install. While developing, `claude --plugin-dir /path/to/clone` hot-reloads on save.

Update: `claude plugin marketplace update clawd-run && claude plugin update clawd-run@clawd-run`. Remove: `claude plugin uninstall clawd-run@clawd-run`.

## Play

- By default the band appears above the prompt when a turn starts. Click the board to give it the keyboard, `Space`/`↑` to jump (also starts a round), `P` pause, `R` restart, `Esc` returns the keys to the prompt. Nothing is captured until you click.
- When Claude finishes its turn, asks a permission or a question, or is interrupted, the board pauses and says so; a subagent finishing does not. With no round running the band folds away about 12 s after Claude is done.
- `/clawd-run off` / `on` controls the automatic appearance (kept across sessions); `/clawd-run play` shows it by hand and keeps it until `/clawd-run stop` or the `hide` button.
- The option `auto` (default `true`) is the same switch in the plugin settings: `/plugin configure clawd-run@clawd-run`.

## How it is built

| File | Role |
| --- | --- |
| `hooks/register.tsx` | Entry: the once-per-plugin events (`session.start`, `tool.call`, `turn.complete`) |
| `hooks/clawd-run.tsx` | The band above the prompt, the `/clawd-run` command, pause on permission/question, best score in `$.store` |
| `hooks/clawd-board.tsx` | The board: a `Client` surface module on the drawing thread with its own frame clock; keys only after a click |
| `hooks/game.ts` | The pure game: `step()` advances one tick, no timers, no drawing |

No model calls, no server, no network.

## Tests

```bash
claude plugin validate .
claude plugin test .        # game physics and the band/board driven through the engine's UI kit
```

Type-check after the mod has loaded once (the engine lays the types): `npx tsc -p .`.
