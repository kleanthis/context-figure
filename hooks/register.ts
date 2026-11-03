import type { Register } from 'claude-code'

import { DEFAULT_COMPACTION_NOTICE, DEFAULT_WARNING, DEFAULT_WARN_AT, isThePersons, line, offsetFromLongOffset } from './line'
import type { Clock, Figure } from './line'

// context-figure: one line for the model on each prompt the person sends —
// the wall clock, and how full the context window is — and, after a
// compaction, one notice on whatever prompt comes first. The person never
// sees the line. Every path fails open: when the engine does not answer, the
// prompt goes through untouched.

/** The zone's offset at `nowMs` by the runtime's own Intl; undefined when it cannot say. */
const intlOffset = (zone: string, nowMs: number): number | undefined => {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(nowMs))
      .find(p => p.type === 'timeZoneName')
    return part === undefined ? undefined : offsetFromLongOffset(part.value)
  } catch {
    return undefined
  }
}

/**
 * The clock as the plugin's own runtime keeps it. The zone's name and its
 * offset come from one source (Intl) or the name is left out: a name beside
 * an offset from elsewhere could pair the right zone with the wrong time.
 */
const readClock = (nowMs: number): Clock => {
  let zone: string | undefined
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    zone = undefined
  }
  const offsetMinutes = zone === undefined ? undefined : intlOffset(zone, nowMs)
  return offsetMinutes === undefined
    ? { nowMs, offsetMinutes: new Date(nowMs).getTimezoneOffset() }
    : { nowMs, offsetMinutes, zone }
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** The figure as the engine gave it, read defensively: a reply of another shape is no figure. */
const readFigure = (usage: unknown): Figure | undefined => {
  if (typeof usage !== 'object' || usage === null) return undefined
  const context = (usage as { context?: unknown }).context
  if (typeof context !== 'object' || context === null) return undefined
  const { tokens, window, percent } = context as { tokens?: unknown; window?: unknown; percent?: unknown }
  return { tokens: num(tokens), window: num(window), percent: num(percent) }
}

export const register: Register = (on, options) => {
  const warnAt = num(options.warnAt) ?? DEFAULT_WARN_AT
  const warning = typeof options.warning === 'string' ? options.warning : DEFAULT_WARNING
  const compactionNotice = typeof options.compactionNotice === 'string' ? options.compactionNotice : DEFAULT_COMPACTION_NOTICE
  let hasCompacted = false

  on('prompt.submit', async ($, e, next) => {
    const afterCompaction = hasCompacted
    let note: string | undefined
    try {
      let clock: Clock | undefined
      let figure: Figure | undefined
      if (isThePersons(e.origin)) {
        const [nowMs, usage] = await Promise.all([
          $.clock.now().catch(() => undefined),
          $.session.usage().catch(() => undefined),
        ])
        if (nowMs !== undefined) clock = readClock(nowMs)
        figure = readFigure(usage)
      }
      note = line({ clock, figure, warnAt, warning, afterCompaction, compactionNotice })
    } catch {
      note = undefined
    }
    const entered = await (note === undefined ? next(e) : next({ ...e, context: [...(e.context ?? []), note] }))
    // The notice is spent only by a prompt that entered: one dropped beneath keeps it for the next.
    if (afterCompaction && entered.drop === undefined) hasCompacted = false
    return entered
  })

  // A compaction of the main conversation that stands (not one computed ahead
  // of time, not a subagent's own, not one skipped beneath) is said once, on
  // the next prompt from anyone. `next` rejecting means no compaction stood:
  // the hook fails, the engine reads it as absent, and the flag stays as it was.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && done.messages !== undefined) hasCompacted = true
    return done
  })
}
