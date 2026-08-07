const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"

function randomChars(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let out = ""
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length]
  }
  return out
}

/**
 * Short, prefixed, lexicographically time-sortable ids — `mem_lz8k3q9vab4f7c`.
 *
 * Sortable so "newest first" needs no extra index, and short because these ids are cited
 * by the model in chat ("saved as mem_lz8k…") and shown in the attribution panel. A uuid
 * would be correct but unreadable in both places.
 */
export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36).padStart(8, "0")}${randomChars(6)}`
}

export const ids = {
  memory: () => createId("mem"),
  negotiation: () => createId("neg"),
  conversation: () => createId("con"),
  message: () => createId("msg"),
  context: () => createId("ctx"),
  project: () => createId("prj"),
} as const
