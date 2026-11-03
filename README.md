# context-figure

A Claude Code plugin that adds one line to every prompt you send, for the
model to read and you never to see:

```
context-figure (for the model, not from the person): Wed 2026-10-07 15:02 (America/Halifax, UTC-03:00) · context 223K of 1000K (22%) as of the last reply
```

The wall clock, and how full the context window is. At or past a
threshold you set, one more clause:

```
… · PAST 75% of the window: finish or hand the work over soon; a long context degrades without the model noticing it
```

And on the first prompt after a compaction, whoever sends it:

```
… · a compaction just ran: everything before this prompt is a summary; re-read any file the work depends on before relying on what the summary says of it
```

Those two clauses are instructions to the model, word for word as above.
Both are options: change the wording, or empty one to turn it off (see
[The options](#the-options)).

## Why

Most Claude Code plugins of this kind (hooks modules that run inside a
session, "mods") put something on the screen for the person. This one
feeds the model two things it needs and cannot get on its own.

**The model has no clock.** It knows the date from its system prompt, and
the time only when someone says it.

**The model cannot count its own context.** It cannot see how full the
window is, and its estimate of its own use runs low, because it cannot
count its own thinking. The author's practice in a long session is to hand the
work to a fresh session at about 400K tokens. Asked where it stood,
the model said "about 400K"; the measured figure was 631K.

With the line, the model stops estimating. It reads the figure, with a
timestamp beside it, every time you speak.

## What it reads, exactly

- **The clock:** weekday, date, time, and the time zone by name and as an
  offset from UTC. The time is Claude Code's own clock; the zone is the
  plugin runtime's. No shell command is run.
- **The figure:** the input tokens of the last reply (uncached,
  cache-written and cache-read together), the model's context window, and
  the percent, as the status line has them. The percent printed is the one
  the threshold is held to: Claude Code's own whole number when it gives
  one, else the figure's share of the window, rounded. "As of the last
  reply" is literal; the prompt the line rides on is not counted yet. The
  time is the moment the prompt was submitted.
- When nothing has been measured yet, the line says so instead of going
  quiet. By Claude Code's own account that is a fresh session, or the
  first prompt after a compaction, until the next reply. When Claude Code
  gives no figure at all, the line says that instead, which is a
  different thing.
- Only on prompts Claude Code attributes to you, typed or queued. The
  plugin keeps a list of the prompt sources that are not a person (task
  notifications, scheduled triggers, other sessions' messages, plugins' own
  prompts, follow-ups Claude Code runs on your behalf) and gives those no
  clock or figure; a source it cannot place is treated as you. The
  compaction clause rides whichever prompt comes first, from anyone.
- The main conversation only. A subagent's own compaction is not counted.

## Install

Needs Claude Code 2.1.289 or newer: the plugin is a hooks module, an
early-access API that may change between releases. Built on 2.1.292; the
tests last ran clean on 2.1.316.

Get the folder:

```
git clone https://github.com/kleanthis/context-figure.git
```

Then, three ways to load it:

1. **One session, in a terminal:**

   ```
   claude --plugin-dir /path/to/context-figure
   ```

2. **Every session, including the ones the desktop app starts:** name the
   folder in `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of
   `~/.claude/settings.json` (several folders: `:` between them on macOS
   and Linux, `;` on Windows):

   ```json
   { "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/context-figure" } }
   ```

3. **As a skills-folder plugin:** copy or symlink the folder to
   `~/.claude/skills/context-figure` for every session, or to a project's
   `.claude/skills/context-figure` for that project. A plugin folder there
   loads on the next session; it needs no SKILL.md.

## The options

| option | default | what it does |
| --- | --- | --- |
| `warnAt` | `75` | Percent of the window at or past which the warning rides. `0` or less turns it off; above `100` it never fires. |
| `warning` | the sentence shown above | The warning's wording; `{warnAt}` stands for the number. Empty turns it off. |
| `compactionNotice` | the sentence shown above | What the model is told on the first prompt after a compaction. Empty turns it off. |

Set them in `/config` (the plugin's own rows) or in
`~/.claude/settings.json`:

```json
{ "pluginConfigs": { "context-figure": { "options": { "warnAt": 40 } } } }
```

Claude Code checks each value against its declared type before the
plugin loads; a value of another type does not reach it.

## What it does not do

- Nothing on screen: no pane, no status line, no toast.
- It does not touch the text of your prompt, and it does not change what
  the compaction summarizer is told.
- No shell commands, no network, no files.

## When it fails

It fails open. If Claude Code does not answer for the clock or the figure,
the line carries what it got; if it got nothing, the prompt goes through
untouched. The hooks catch their own errors, and Claude Code skips a hook
that still throws.

`claude plugin validate` notes that neither hook registers a `.catch`
handler. That handler is Claude Code's way of running a hook a second time
after it fails; these hooks have nothing to retry, so none is registered.

One limit: the compaction notice waits in the plugin's own memory, and a
reload of the plugin (an edit to it, or a change to one of its options in
`/config`) starts that memory over. A compaction that ran just before such
a reload is not announced.

## Checking it

```
claude plugin validate --strict /path/to/context-figure
claude plugin test /path/to/context-figure
```

Twenty-seven tests: the line's text as pure functions, and the two hooks
run through Claude Code's own test kit with a stood-in clock and usage
figures, another plugin's context beside ours, compactions raised in each
form, a prompt dropped beneath.

The time zone on the line is the plugin runtime's. In that test kit on the
author's Mac, the runtime reported the host's zone (America/Halifax); the
tests themselves accept any zone. If your runtime reports UTC, the line
says UTC and is still correct.

## Files

- `.claude-plugin/plugin.json`: the manifest and the options.
- `hooks/register.ts`: the two hooks, `prompt.submit` and `session.compact`.
- `hooks/line.ts`: the line's text, as pure functions.
- `tests/`: what `claude plugin test` runs.
- `tsconfig.json`: type-checks the plugin once Claude Code has laid its
  declarations beside it (`.claude-plugin/types/`, written when a session
  first loads the plugin; ignored by git).

## Credits

Written by Claude at Kleanthis Economou's direction, October 2026, from a
version the author had been running privately for a few days. MIT licence.
