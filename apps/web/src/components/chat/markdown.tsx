import { memo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * Element overrides instead of the typography plugin.
 *
 * `prose` would need constant fighting to match a design system with its own type scale and
 * radii, and it styles for articles rather than chat. These are a dozen lines and stay
 * consistent with the rest of the app.
 */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-3 leading-relaxed last:mb-0">{children}</p>,

  h1: ({ children }) => <h3 className="mt-5 mb-2 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-5 mb-2 text-base font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 mb-2 text-sm font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-4 mb-2 text-sm font-semibold first:mt-0">{children}</h4>,

  ul: ({ children }) => (
    <ul className="mb-3 ml-1 list-disc space-y-1.5 pl-4 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 ml-1 list-decimal space-y-1.5 pl-4 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="marker:text-muted-foreground leading-relaxed">{children}</li>
  ),

  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,

  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline underline-offset-2 hover:no-underline"
    >
      {children}
    </a>
  ),

  code: ({ children, className }) => {
    // react-markdown gives fenced blocks a `language-*` class and inline code none.
    const fenced = /language-/.test(className ?? "")
    if (fenced) {
      return <code className="font-mono text-xs leading-relaxed">{children}</code>
    }
    return (
      <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
    )
  },
  pre: ({ children }) => (
    <pre className="bg-muted mb-3 overflow-x-auto rounded-xl p-3 last:mb-0">{children}</pre>
  ),

  blockquote: ({ children }) => (
    <blockquote className="border-border text-muted-foreground mb-3 border-l-2 pl-3 italic last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-4" />,

  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-border border-b px-2 py-1.5 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-border/60 border-b px-2 py-1.5">{children}</td>,
}

/**
 * Memoised because this re-renders on every streamed token, and re-parsing the whole
 * document each time is the one thing that makes a long reply feel sluggish.
 */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  )
})
