import { describe, expect, it } from 'vitest'
import { hasEnded } from '@shared/dates'
import { FRI2, MON, sprint } from '../../../test/fixtures'

/** When a sprint is over: its last day is behind today. */

describe('a sprint that has ended', () => {
  it('is over the day after its last day — not on it', () => {
    const s = sprint() // Mon 14 to Fri 25 Sep
    expect(hasEnded(s, MON)).toBe(false)
    expect(hasEnded(s, FRI2)).toBe(false)
    expect(hasEnded(s, '2026-09-26')).toBe(true)
    expect(hasEnded(s, '2026-10-04')).toBe(true)
  })

  it('a sprint with no days is not over', () => {
    expect(hasEnded({ ...sprint(), days: [] }, '2026-10-04')).toBe(false)
  })
})
