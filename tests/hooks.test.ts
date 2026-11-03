import type { Engine } from 'claude-code/testing'
import type { On, PromptOrigin, SessionMessage } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

// Each test stands for the engine beneath the plugin: its clock, its usage
// figures, and the prompt's way into the session.

// 2025-10-07T18:00:00Z
const NOW = 1_759_860_000_000

const usage = (tokens: number | undefined, window = 1_000_000) => ({
  startedAt: 0,
  context: { tokens, window, percent: tokens === undefined ? undefined : Math.round((tokens / window) * 100) },
  rateLimits: [],
})

/** The engine beneath: a fixed clock, usage figures the test may change, and the prompt's entry. */
const stand = (on: On, tokens: number | undefined, window?: number) => {
  let seen: readonly string[] | undefined
  const figures = { tokens, window }
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: usage(figures.tokens, figures.window) }))
  on('prompt.submit', (_, e) => {
    seen = e.context
    return { text: e.text, context: e.context }
  })
  return { seen: () => seen, figures }
}

const submit = ($: Engine, text: string, origin: PromptOrigin = { kind: 'composer' }) =>
  $.prompt.submit({ text, wait: false, origin })

const message = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })

/** The engine beneath a compaction: it answers a summary. Registered before the test's first call on `$`, as the kit asks. */
const standCompact = (on: On) => on('session.compact', () => ({ messages: [message('the summary')] }))

const compact = ($: Engine, trigger: 'manual' | 'precompute' = 'manual') =>
  $.session.compact({ trigger, messages: [message('hello'), message('and more')] })

describe('prompt.submit', () => {
  test('the prompt carries one line with the clock and the figure, the text untouched', async ($, on) => {
    const { seen } = stand(on, 223_376)
    const entered = await submit($, 'hello')
    expect(entered.text).toBe('hello')
    expect(seen()).toHaveLength(1)
    const note = seen()![0]!
    expect(note.startsWith('context-figure (for the model, not from the person): ')).toBe(true)
    expect(note).toMatch(/ (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{4}-\d{2}-\d{2} \d{2}:\d{2} \((?:[\w/+-]+, )?UTC[+-]\d{2}:\d{2}\) · /)
    expect(note).toContain('context 223K of 1000K (22%) as of the last reply')
    expect(note).not.toContain('PAST')
    expect(note).not.toContain('compaction')
    // The runtime's own zone, when it names one, is the one on the line.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (typeof zone === 'string' && zone !== '') expect(note).toContain(`(${zone}, UTC`)
  })

  test(
    'a context another plugin attached is kept, ours added beside it',
    {
      plugins: [
        {
          name: 'above',
          tier: 'prepend',
          register(on) {
            on('prompt.submit', ($, e, next) => next({ ...e, context: [...(e.context ?? []), 'above: mine'] }))
          },
        },
      ],
    },
    async ($, on) => {
      const { seen } = stand(on, 223_376)
      await submit($, 'hello')
      expect(seen()).toHaveLength(2)
      expect(seen()).toContain('above: mine')
      expect(seen()!.some(entry => entry.startsWith('context-figure (for the model'))).toBe(true)
    },
  )

  test('at or past the default threshold the line says so, at the percent it prints', async ($, on) => {
    const { seen, figures } = stand(on, 760_000)
    await submit($, 'hello')
    expect(seen()![0]).toContain(' (76%) ')
    expect(seen()![0]).toContain('PAST 75% of the window')
    figures.tokens = 744_999
    await submit($, 'hello')
    expect(seen()![0]).toContain(' (74%) ')
    expect(seen()![0]).not.toContain('PAST')
  })

  test('the threshold is the option', { options: { warnAt: 40 } }, async ($, on) => {
    const { seen } = stand(on, 431_000)
    await submit($, 'hello')
    expect(seen()![0]).toContain('PAST 40% of the window')
  })

  test('zero turns the warning off', { options: { warnAt: 0 } }, async ($, on) => {
    const { seen } = stand(on, 990_000)
    await submit($, 'hello')
    expect(seen()![0]).toContain('context 990K of 1000K (99%)')
    expect(seen()![0]).not.toContain('PAST')
  })

  test(
    'the two sentences are the options; an empty one says nothing',
    { options: { warning: 'Past {warnAt}%: stop.', compactionNotice: '' } },
    async ($, on) => {
      const { seen } = stand(on, 800_000)
      standCompact(on)
      await submit($, 'hello')
      expect(seen()![0]).toContain(' · Past 75%: stop.')
      expect(seen()![0]).not.toContain('PAST')
      await compact($)
      await submit($, 'after')
      expect(seen()![0]).not.toContain('compaction')
    },
  )

  test('a window not measured yet is said, not skipped', async ($, on) => {
    const { seen } = stand(on, undefined, 200_000)
    await submit($, 'hello')
    expect(seen()![0]).toContain('no context figure yet for the 200K window')
  })

  test('a prompt that is not the person\'s gets no line', async ($, on) => {
    const { seen } = stand(on, 223_376)
    await submit($, 'a task finished', { kind: 'task-notification' })
    expect(seen()).toBeUndefined()
    await submit($, 'a peer wrote', { kind: 'peer' })
    expect(seen()).toBeUndefined()
    await submit($, 'from a phone', { kind: 'bridge' })
    expect(seen()).toHaveLength(1)
  })

  test('a clock and a usage that both fail leave the prompt alone', async ($, on) => {
    let seen: readonly string[] | undefined = ['unset']
    on('clock.now', () => {
      throw new Error('no clock')
    })
    on('session.usage', () => {
      throw new Error('no figures')
    })
    on('prompt.submit', (_, e) => {
      seen = e.context
      return { text: e.text, context: e.context }
    })
    const entered = await submit($, 'hello')
    expect(seen).toBeUndefined()
    expect(entered.text).toBe('hello')
  })

  test('a usage that fails alone still gives the clock, and says the figure is unavailable', async ($, on) => {
    let seen: readonly string[] | undefined
    on('clock.now', () => ({ value: NOW }))
    on('session.usage', () => {
      throw new Error('no figures')
    })
    on('prompt.submit', (_, e) => {
      seen = e.context
      return { text: e.text, context: e.context }
    })
    await submit($, 'hello')
    expect(seen).toHaveLength(1)
    expect(seen![0]).toContain('context figure unavailable: the engine gave none')
  })

  test('after a compaction the first prompt from anyone says so, once, beside a window not measured yet', async ($, on) => {
    const { seen, figures } = stand(on, 300_000)
    standCompact(on)
    await compact($)
    figures.tokens = undefined
    await submit($, 'a task finished', { kind: 'task-notification' })
    expect(seen()).toHaveLength(1)
    expect(seen()![0]).toBe(
      'context-figure (for the model, not from the person): a compaction just ran: everything before this prompt is a summary; re-read any file the work depends on before relying on what the summary says of it',
    )
    await submit($, 'hello')
    expect(seen()![0]).toContain('no context figure yet for the 1000K window')
    expect(seen()![0]).not.toContain('a compaction just ran')
    figures.tokens = 120_000
    await submit($, 'again')
    expect(seen()![0]).toContain('context 120K')
    expect(seen()![0]).not.toContain('compaction')
  })

  test('a compaction computed ahead of time is not a compaction that ran', async ($, on) => {
    const { seen } = stand(on, 300_000)
    standCompact(on)
    await compact($, 'precompute')
    await submit($, 'hello')
    expect(seen()![0]).not.toContain('a compaction just ran')
  })

  test("a subagent's own compaction, and one skipped beneath, do not count; the engine's own does", async ($, on) => {
    const { seen } = stand(on, 300_000)
    let isSkipping = true
    on('session.compact', () => (isSkipping ? { skip: 'not now' } : { messages: [message('the summary')] }))
    await $.session.compact({ trigger: 'manual', messages: [message('hello')] })
    await submit($, 'after a skip')
    expect(seen()![0]).not.toContain('compaction')
    isSkipping = false
    await $.session.compact({ trigger: 'auto', agentId: 'helper-1', messages: [message('hello')] })
    await submit($, "after a helper's")
    expect(seen()![0]).not.toContain('compaction')
    await $.session.compact({ trigger: 'auto', messages: [message('hello')] })
    await submit($, "after the engine's")
    expect(seen()![0]).toContain('a compaction just ran')
  })

  test('a prompt dropped beneath keeps the notice for the next one', async ($, on) => {
    on('clock.now', () => ({ value: NOW }))
    on('session.usage', () => ({ value: usage(300_000) }))
    let isDropping = true
    let seen: readonly string[] | undefined
    on('prompt.submit', (_, e) => {
      if (isDropping) return { drop: 'not now' }
      seen = e.context
      return { text: e.text, context: e.context }
    })
    standCompact(on)
    await compact($)
    const dropped = await submit($, 'hello')
    expect(dropped.drop).toBe('not now')
    isDropping = false
    await submit($, 'hello again')
    expect(seen![0]).toContain('a compaction just ran')
    await submit($, 'and again')
    expect(seen![0]).not.toContain('a compaction just ran')
  })
})
