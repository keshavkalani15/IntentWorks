const OPEN = "<think>"
const CLOSE = "</think>"

export type StreamSegment = { kind: "text" | "reasoning"; delta: string }

/**
 * Splits inline `<think>…</think>` blocks out of a streamed completion.
 *
 * Several models emit their reasoning as tags inside the normal content stream rather than
 * in a separate field, and it renders as literal `<think>` text if nothing pulls it apart.
 *
 * The whole difficulty is that a tag can straddle a chunk boundary — `"<thi"` arrives, then
 * `"nk>rest"`. So any trailing text that could still turn out to be the start of a tag is
 * held back until the next chunk proves it either way, rather than being emitted and then
 * regretted.
 */
export class ReasoningSplitter {
  private buffer = ""
  private inside = false

  push(chunk: string): StreamSegment[] {
    this.buffer += chunk
    return this.drain(false)
  }

  /** Emit whatever is left, tag or no tag. Call once the stream ends. */
  flush(): StreamSegment[] {
    const out = this.drain(true)
    this.buffer = ""
    return out
  }

  private drain(final: boolean): StreamSegment[] {
    const out: StreamSegment[] = []

    for (;;) {
      const tag = this.inside ? CLOSE : OPEN
      const at = this.buffer.indexOf(tag)

      if (at !== -1) {
        const before = this.buffer.slice(0, at)
        if (before) out.push({ kind: this.inside ? "reasoning" : "text", delta: before })
        this.buffer = this.buffer.slice(at + tag.length)
        this.inside = !this.inside
        continue
      }

      const hold = final ? 0 : this.danglingTagLength(tag)
      const emit = this.buffer.slice(0, this.buffer.length - hold)
      if (emit) out.push({ kind: this.inside ? "reasoning" : "text", delta: emit })
      this.buffer = this.buffer.slice(this.buffer.length - hold)
      return out
    }
  }

  /** How many trailing characters could still be the opening of `tag`. */
  private danglingTagLength(tag: string): number {
    const max = Math.min(tag.length - 1, this.buffer.length)
    for (let n = max; n > 0; n--) {
      if (tag.startsWith(this.buffer.slice(this.buffer.length - n))) return n
    }
    return 0
  }
}
