/**
 * Zero-width space, ZWNJ, ZWJ and BOM. Invisible to a reader, but they change a hash —
 * which would let the same fact slip past a tombstone. Listed by code point so the
 * source stays readable.
 */
const INVISIBLE_CODE_POINTS = new Set([0x200b, 0x200c, 0x200d, 0xfeff])

function stripInvisible(input: string): string {
  let out = ""
  for (const char of input) {
    if (!INVISIBLE_CODE_POINTS.has(char.codePointAt(0)!)) out += char
  }
  return out
}

/**
 * Canonical form of a fact, used for dedupe, tombstone lookup and cooldowns.
 *
 * "I prefer tabs over spaces." and "i prefer  TABS over spaces" must collapse to the same
 * fingerprint, or a declined fact comes straight back in a slightly different wrapper.
 */
export function normalizeFact(fact: string): string {
  return stripInvisible(fact.normalize("NFKC").toLowerCase())
    .replace(/\s+/g, " ")
    .replace(/[.!?;,]+$/, "")
    .trim()
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export function factFingerprint(fact: string): Promise<string> {
  return sha256Hex(normalizeFact(fact))
}
