// The line's text, as pure functions: no engine, no clock, no file system.
// register.ts asks them and attaches the answer; the tests ask them directly.

/**
 * Prompts that are not the person's: no clock or figure rides them. A
 * deny-list on purpose: which kind a host stamps on the person's own prompt
 * differs by host (composer, bridge, sdk, slack-ping, unclassified), and a
 * line too many costs less than a line missed. A kind this list does not
 * know is read as the person's. `auto-continuation` (a follow-up the person
 * caused but did not type) is on the list: the line is for what they typed.
 */
export const NOT_THE_PERSON: ReadonlySet<string> = new Set([
  'task-notification',
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'channel',
  'coordinator',
  'observer',
  'observer-activity',
  'auto-continuation',
  'plugin',
])

/** An origin the engine left out is read as the person's. */
export const isThePersons = (origin: { kind?: string } | undefined): boolean =>
  origin?.kind === undefined || !NOT_THE_PERSON.has(origin.kind)

export type Clock = {
  /** Milliseconds since the epoch. */
  nowMs: number
  /** Minutes BEHIND UTC, as `Date.prototype.getTimezoneOffset` gives it: 180 for UTC-03:00, -120 for UTC+02:00. */
  offsetMinutes: number
  /** The IANA zone, when the runtime names one (`America/Halifax`). */
  zone?: string
}

const LONG_OFFSET = /^(?:GMT|UTC)(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/

/** Minutes behind UTC from Intl's long offset (`GMT-03:00` → 180, `GMT+05:30` → -330, `GMT` → 0); undefined for any other text. */
export const offsetFromLongOffset = (value: string): number | undefined => {
  const m = LONG_OFFSET.exec(value.trim())
  if (m === null) return undefined
  if (m[1] === undefined) return 0
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? '0')
  return m[1] === '+' ? 0 - minutes : minutes
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const two = (n: number) => String(n).padStart(2, '0')

/** `Wed 2026-10-07 15:02 (America/Halifax, UTC-03:00)`; without a zone name, `Wed 2026-10-07 15:02 (UTC-03:00)`. */
export const clockStamp = ({ nowMs, offsetMinutes, zone }: Clock): string => {
  const local = new Date(nowMs - offsetMinutes * 60_000)
  const sign = offsetMinutes > 0 ? '-' : '+'
  const abs = Math.abs(offsetMinutes)
  const utc = `UTC${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`
  const day = DAYS[local.getUTCDay()] ?? '???'
  const date = `${local.getUTCFullYear()}-${two(local.getUTCMonth() + 1)}-${two(local.getUTCDate())}`
  const time = `${two(local.getUTCHours())}:${two(local.getUTCMinutes())}`
  return `${day} ${date} ${time} (${zone === undefined ? utc : `${zone}, ${utc}`})`
}

export type Figure = {
  /** Input tokens of the last reply; absent until a window's first reply. */
  tokens?: number
  /** The model's context window, in tokens. */
  window?: number
  /** The engine's own whole-number percent, when it gives one. */
  percent?: number
}

const k = (n: number) => `${Math.round(n / 1000)}K`
const hasWindow = (figure: Figure): figure is Figure & { window: number } =>
  figure.window !== undefined && figure.window > 0

/**
 * The one percent the line prints and the threshold is held to: the engine's
 * own when it gives one, else the figure's share of the window, rounded.
 */
export const percentOf = (figure: Figure | undefined): number | undefined => {
  if (figure === undefined) return undefined
  if (figure.percent !== undefined) return figure.percent
  if (figure.tokens === undefined || !hasWindow(figure)) return undefined
  return Math.round((figure.tokens / figure.window) * 100)
}

/**
 * The figure as a clause. The engine answering nothing (`undefined`) is told
 * apart from a window nothing has been measured in yet (`tokens` absent).
 */
export const figureClause = (figure: Figure | undefined): string => {
  if (figure === undefined) return 'context figure unavailable: the engine gave none'
  if (figure.tokens === undefined) {
    const of = hasWindow(figure) ? ` for the ${k(figure.window)} window` : ''
    return `no context figure yet${of}: nothing has been measured since this window began (a fresh session, or a compaction)`
  }
  const percent = percentOf(figure)
  const of = hasWindow(figure) ? ` of ${k(figure.window)}${percent === undefined ? '' : ` (${percent}%)`}` : ''
  return `context ${k(figure.tokens)}${of} as of the last reply`
}

/** Whether the printed percent stands at or past `warnAt`; 0 (or less) never. */
export const isPast = (figure: Figure | undefined, warnAt: number): boolean => {
  if (!(warnAt > 0) || figure === undefined || figure.tokens === undefined) return false
  const percent = percentOf(figure)
  return percent !== undefined && percent >= warnAt
}

export const DEFAULT_WARN_AT = 75
export const DEFAULT_WARNING =
  'PAST {warnAt}% of the window: finish or hand the work over soon; a long context degrades without the model noticing it'
export const DEFAULT_COMPACTION_NOTICE =
  'a compaction just ran: everything before this prompt is a summary; re-read any file the work depends on before relying on what the summary says of it'

export type LineInput = {
  clock?: Clock
  figure?: Figure
  /** Percent of the window at or past which the warning rides; 0 turns it off. */
  warnAt: number
  /** The warning's wording; `{warnAt}` stands for the number; empty turns it off. */
  warning: string
  /** A compaction stood since the last line. */
  afterCompaction: boolean
  /** The notice's wording; empty turns it off. */
  compactionNotice: string
}

export const LEAD = 'context-figure (for the model, not from the person):'

/** The whole line, or `undefined` when there is nothing to say. */
export const line = ({ clock, figure, warnAt, warning, afterCompaction, compactionNotice }: LineInput): string | undefined => {
  const parts: string[] = []
  if (clock !== undefined) parts.push(clockStamp(clock))
  if (clock !== undefined || figure !== undefined) parts.push(figureClause(figure))
  if (isPast(figure, warnAt) && warning.trim() !== '') parts.push(warning.replaceAll('{warnAt}', String(warnAt)))
  if (afterCompaction && compactionNotice.trim() !== '') parts.push(compactionNotice)
  return parts.length === 0 ? undefined : `${LEAD} ${parts.join(' · ')}`
}
