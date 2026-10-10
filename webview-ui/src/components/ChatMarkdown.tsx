import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Agent replies as formatted Markdown: headings, lists, bold, code, GitHub tables.
 * react-markdown never renders raw HTML from the text, so agent output can't inject markup.
 */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          // Wide tables scroll inside the bubble instead of stretching the chat.
          table: ({ children }) => (
            <div className="chat-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
