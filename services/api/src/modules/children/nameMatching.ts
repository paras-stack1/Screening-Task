/**
 * Name comparison for duplicate WARNINGS only (decision G). A match never merges or blocks a
 * record by itself: the worker reviews the candidates and may confirm the child is different
 * (twins, cousins with the same name, ...).
 */

/** Comparison key: NFKC, lower case, letters/marks/digits only, single spaces. */
export function matchKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLocaleLowerCase('en-IN')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance over code points, stopping early once `max` is exceeded. */
export function editDistance(a: string, b: string, max: number): number {
  const s = [...a];
  const t = [...b];
  if (Math.abs(s.length - t.length) > max) return max + 1;
  let previous = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[t.length]!;
}

/**
 * Similar enough to warn: identical keys, the same words in another order, or a small spelling
 * difference (about one edit per five characters, e.g. "Priya Kumari" / "Priya Kumary").
 */
export function namesLookSimilar(a: string, b: string): boolean {
  const ka = matchKey(a);
  const kb = matchKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const sortedWords = (key: string) => key.split(' ').sort().join(' ');
  if (sortedWords(ka) === sortedWords(kb)) return true;
  const longest = Math.max([...ka].length, [...kb].length);
  if (longest < 4) return false;
  const allowed = Math.max(1, Math.floor(longest / 5));
  return editDistance(ka, kb, allowed) <= allowed;
}
