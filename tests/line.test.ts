import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULT_COMPACTION_NOTICE,
  DEFAULT_WARNING,
  LEAD,
  clockStamp,
  figureClause,
  isPast,
  isThePersons,
  line,
  offsetFromLongOffset,
  percentOf,
} from '../hooks/line'

// 2025-10-07T18:00:00Z
const NOW = 1_759_860_000_000

describe('the clock', () => {
  test('a stamp in the local zone, the offset spelled out', () => {
    expect(clockStamp({ nowMs: NOW, offsetMinutes: 180, zone: 'America/Halifax' })).toBe(
      'Tue 2025-10-07 15:00 (America/Halifax, UTC-03:00)',
    )
    expect(clockStamp({ nowMs: NOW, offsetMinutes: -120, zone: 'Europe/Athens' })).toBe(
      'Tue 2025-10-07 20:00 (Europe/Athens, UTC+02:00)',
    )
    expect(clockStamp({ nowMs: NOW, offsetMinutes: 0 })).toBe('Tue 2025-10-07 18:00 (UTC+00:00)')
    expect(clockStamp({ nowMs: NOW, offsetMinutes: -330, zone: 'Asia/Kolkata' })).toBe(
      'Tue 2025-10-07 23:30 (Asia/Kolkata, UTC+05:30)',
    )
  })
  test("Intl's long offset parses to minutes behind UTC", () => {
    expect(offsetFromLongOffset('GMT-03:00')).toBe(180)
    expect(offsetFromLongOffset('GMT+05:30')).toBe(-330)
    expect(offsetFromLongOffset('GMT+00:00')).toBe(0)
    expect(offsetFromLongOffset('GMT')).toBe(0)
    expect(offsetFromLongOffset('UTC-3')).toBe(180)
    expect(offsetFromLongOffset('ADT')).toBeUndefined()
    expect(offsetFromLongOffset('')).toBeUndefined()
  })
  test('the date follows the zone across midnight', () => {
    const lateUtc = Date.UTC(2026, 9, 8, 1, 30)
    expect(clockStamp({ nowMs: lateUtc, offsetMinutes: 180 })).toBe('Wed 2026-10-07 22:30 (UTC-03:00)')
    expect(clockStamp({ nowMs: lateUtc, offsetMinutes: 0 })).toBe('Thu 2026-10-08 01:30 (UTC+00:00)')
  })
})

describe('the figure', () => {
  test('tokens of the window, with the one percent the threshold is held to', () => {
    expect(figureClause({ tokens: 223_376, window: 1_000_000 })).toBe('context 223K of 1000K (22%) as of the last reply')
    expect(figureClause({ tokens: 150_500, window: 200_000 })).toBe('context 151K of 200K (75%) as of the last reply')
    expect(figureClause({ tokens: 749_999, window: 1_000_000 })).toBe('context 750K of 1000K (75%) as of the last reply')
    expect(figureClause({ tokens: 749_999, window: 1_000_000, percent: 74 })).toBe('context 750K of 1000K (74%) as of the last reply')
    expect(figureClause({ tokens: 10_000 })).toBe('context 10K as of the last reply')
    expect(percentOf({ tokens: 749_999, window: 1_000_000 })).toBe(75)
    expect(percentOf({ tokens: 749_999, window: 1_000_000, percent: 74 })).toBe(74)
    expect(percentOf({ tokens: 10_000 })).toBeUndefined()
    expect(percentOf({ tokens: 10_000, window: 0 })).toBeUndefined()
  })
  test('a window not measured yet is said; the engine giving nothing is said differently', () => {
    expect(figureClause({ window: 200_000 })).toBe(
      'no context figure yet for the 200K window: nothing has been measured since this window began (a fresh session, or a compaction)',
    )
    expect(figureClause({})).toContain('no context figure yet:')
    expect(figureClause(undefined)).toBe('context figure unavailable: the engine gave none')
  })
  test('past at the printed percent, never at zero, never without a figure', () => {
    expect(isPast({ tokens: 750_000, window: 1_000_000 }, 75)).toBe(true)
    expect(isPast({ tokens: 749_999, window: 1_000_000 }, 75)).toBe(true)
    // 0.29 * 100 is 28.999999999999996 in floating point: the printed percent decides, not the raw ratio
    expect(isPast({ tokens: 290_000, window: 1_000_000 }, 29)).toBe(true)
    expect(isPast({ tokens: 760_000, window: 1_000_000 }, 75.5)).toBe(true)
    expect(isPast({ tokens: 750_000, window: 1_000_000 }, 75.5)).toBe(false)
    expect(isPast({ tokens: 5_000, window: 0 }, 1)).toBe(false)
    expect(figureClause({ tokens: 5_000, window: 0 })).toBe('context 5K as of the last reply')
    expect(isPast({ tokens: 749_999, window: 1_000_000, percent: 74 }, 75)).toBe(false)
    expect(isPast({ tokens: 744_999, window: 1_000_000 }, 75)).toBe(false)
    expect(isPast({ tokens: 999_000, window: 1_000_000 }, 0)).toBe(false)
    expect(isPast({ tokens: 999_000, window: 1_000_000 }, -5)).toBe(false)
    expect(isPast({ tokens: 999_000, window: 1_000_000 }, 150)).toBe(false)
    expect(isPast({ window: 1_000_000 }, 75)).toBe(false)
    expect(isPast({ tokens: 999_000 }, 75)).toBe(false)
    expect(isPast(undefined, 75)).toBe(false)
  })
})

describe('whose prompt', () => {
  test('the person, under any host, and an origin left out', () => {
    expect(isThePersons({ kind: 'composer' })).toBe(true)
    expect(isThePersons({ kind: 'bridge' })).toBe(true)
    expect(isThePersons({ kind: 'sdk' })).toBe(true)
    expect(isThePersons({ kind: 'unclassified' })).toBe(true)
    expect(isThePersons({ kind: 'slack-ping' })).toBe(true)
    expect(isThePersons(undefined)).toBe(true)
    expect(isThePersons({})).toBe(true)
  })
  test('not the person', () => {
    const denied = [
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
    ]
    for (const kind of denied) expect(isThePersons({ kind })).toBe(false)
    expect(denied).toHaveLength(11)
  })
})

describe('the line', () => {
  const clock = { nowMs: NOW, offsetMinutes: 180, zone: 'America/Halifax' }
  const defaults = { warnAt: 75, warning: DEFAULT_WARNING, afterCompaction: false, compactionNotice: DEFAULT_COMPACTION_NOTICE }
  test('clock, figure, and nothing more under the threshold', () => {
    expect(line({ ...defaults, clock, figure: { tokens: 223_376, window: 1_000_000 } })).toBe(
      `${LEAD} Tue 2025-10-07 15:00 (America/Halifax, UTC-03:00) · context 223K of 1000K (22%) as of the last reply`,
    )
  })
  test('past the threshold, and after a compaction, each is one more clause, with the number filled in', () => {
    const past = line({ ...defaults, clock, figure: { tokens: 800_000, window: 1_000_000 }, afterCompaction: true })!
    expect(past).toContain(' · PAST 75% of the window: finish or hand the work over soon')
    expect(past).toContain(' · a compaction just ran: ')
    expect(line({ ...defaults, warnAt: 40, warning: 'Past {warnAt}%: stop. ({warnAt})', figure: { tokens: 500_000, window: 1_000_000 } })).toBe(
      `${LEAD} context 500K of 1000K (50%) as of the last reply · Past 40%: stop. (40)`,
    )
  })
  test('an empty wording turns its clause off', () => {
    expect(line({ ...defaults, warning: '  ', figure: { tokens: 900_000, window: 1_000_000 } })).toBe(
      `${LEAD} context 900K of 1000K (90%) as of the last reply`,
    )
    expect(line({ ...defaults, compactionNotice: '', afterCompaction: true })).toBeUndefined()
  })
  test('a clock without a figure says the figure is unavailable; a figure without a clock stands alone', () => {
    expect(line({ ...defaults, clock })).toContain('context figure unavailable')
    expect(line({ ...defaults, figure: { tokens: 5_000, window: 200_000 } })).toBe(
      `${LEAD} context 5K of 200K (3%) as of the last reply`,
    )
  })
  test('nothing to say is no line; a notice alone is a line', () => {
    expect(line({ ...defaults })).toBeUndefined()
    expect(line({ ...defaults, afterCompaction: true })).toBe(`${LEAD} ${DEFAULT_COMPACTION_NOTICE}`)
  })
})
