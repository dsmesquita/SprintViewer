import { expect, it } from 'vitest'

/**
 * Scenario-style tests: a script builds up a situation step by step and records a named
 * `check` at each point, then `report()` turns every check into its own test.
 *
 * The suites written before the project had a test runner use this shape, and it suits
 * long scenarios (a Wednesday refresh, then Thursday's, …) where each step depends on the
 * last. New tests that stand alone should use plain `it` / `expect`.
 */
export function checklist(): {
  check: (name: string, ok: boolean, detail?: unknown) => void
  report: () => void
} {
  const results: Array<{ name: string; ok: boolean; detail?: unknown }> = []
  return {
    check: (name, ok, detail) => {
      results.push({ name, ok, detail })
    },
    report: () => {
      const seen = new Map<string, number>()
      for (const { name, ok, detail } of results) {
        // Test names must be unique to be told apart in the report.
        const count = (seen.get(name) ?? 0) + 1
        seen.set(name, count)
        it(count === 1 ? name : `${name} (${count})`, () => {
          expect(ok, detail === undefined ? name : `${name}\n  → ${stringify(detail)}`).toBe(true)
        })
      }
    }
  }
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
