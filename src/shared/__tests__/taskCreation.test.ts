import { checklist } from '../../../test/checklist'
import { isIdentity, normaliseIdentity, parseTags } from '@shared/taskCreation'

const { check, report } = checklist()
const B = String.fromCharCode(92) // a backslash, spelled out so no shell can eat it

const cases: Array<[string, string | null]> = [
  ['bsrocha', `CMF${B}bsrocha`],
  [`CMF${B}bsrocha`, `CMF${B}bsrocha`],
  [`cmf${B}bsrocha`, `CMF${B}bsrocha`],
  [`<CMF${B}bsrocha>`, `CMF${B}bsrocha`],
  ['  < bsrocha >  ', `CMF${B}bsrocha`],
  [`Beatriz Rocha <CMF${B}bsrocha>`, `Beatriz Rocha <CMF${B}bsrocha>`],
  ['Beatriz Rocha <bsrocha>', `Beatriz Rocha <CMF${B}bsrocha>`],
  ['Beatriz Rocha', null],
  ['', null],
  ['   ', null],
  [`CMF${B}`, null],
  [`${B}bsrocha`, null],
  [`a${B}b${B}c`, null],
  ['<>', null],
  ['bs<rocha', null]
]
for (const [input, expected] of cases) {
  const got = normaliseIdentity(input)
  check(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, got === expected, got)
}
check(
  'an account is recognised as one',
  isIdentity(`CMF${B}bsrocha`) && !isIdentity('member-3') && !isIdentity(undefined)
)
check(
  'tags: commas and semicolons, trimmed, once each',
  JSON.stringify(parseTags(' Release 24.10; backend, Backend ,, UI ')) ===
    JSON.stringify(['Release 24.10', 'backend', 'UI']),
  parseTags(' Release 24.10; backend, Backend ,, UI ')
)
check('tags: empty text is no tags', parseTags('  ').length === 0)

report()
