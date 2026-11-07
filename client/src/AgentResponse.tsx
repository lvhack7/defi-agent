import type { ComponentProps } from 'react'
import Markdown from 'markdown-to-jsx'

function ResponseLink({ children, href, title }: ComponentProps<'a'>) {
  return <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
}

function ResponseTable({ children }: ComponentProps<'table'>) {
  return <div className="response-table"><table>{children}</table></div>
}

export function AgentResponse({ text }: { text: string }) {
  return <div className="agent-response">
    <Markdown options={{
      disableParsingRawHTML: true,
      forceBlock: true,
      overrides: {
        a: { component: ResponseLink },
        table: { component: ResponseTable },
        img: () => null,
      },
      }}
    >{text}</Markdown>
  </div>
}
