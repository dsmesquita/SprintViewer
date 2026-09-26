/** Combining diacritical marks, the range NFD decomposition puts accents into. */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g')

/**
 * Text normalisation for searching and for matching people's names.
 *
 * Accents are stripped by decomposing to NFD and dropping the combining marks, so `í`, `ì`
 * and `i` all compare equal — which matters for a team whose names are written with them
 * inconsistently between TFS and everywhere else.
 */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** True when `needle` appears anywhere in `haystack`, ignoring case, accents and punctuation. */
export function matches(haystack: string, needle: string): boolean {
  const query = normalize(needle)
  return query.length === 0 || normalize(haystack).includes(query)
}
