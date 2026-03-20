// Markdown renderer for AI messages — wraps react-markdown + remark-gfm
// Per design.md §5 + §11 + §12

import { useState, useCallback, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  content: string;
}

function CodeBlock({ language, children }: { language?: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const lines = children.trimEnd().split('\n');
  const [expanded, setExpanded] = useState(lines.length <= 20);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [children]);

  const visibleLines = expanded ? lines : lines.slice(0, 20);

  return (
    <div className="my-3 rounded-[10px] overflow-hidden" style={{ backgroundColor: '#161616' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 text-[11px]">
        <span className="text-text-secondary font-medium uppercase tracking-wider">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-text-secondary hover:text-text-primary transition-colors duration-150"
        >
          {copied ? (
            <>
              <Check size={13} />
              <span className="text-success">Copied!</span>
            </>
          ) : (
            <>
              <Copy size={13} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      {/* Code */}
      <div className="overflow-x-auto px-4 pb-3">
        <table className="w-full border-collapse">
          <tbody>
            {visibleLines.map((line, i) => (
              <tr key={i}>
                <td className="pr-4 text-right select-none align-top text-text-secondary w-[1%] whitespace-nowrap"
                    style={{ fontSize: '13.5px', lineHeight: '1.6', fontFamily: 'var(--font-mono)' }}>
                  {i + 1}
                </td>
                <td className="whitespace-pre text-text-primary"
                    style={{ fontSize: '13.5px', lineHeight: '1.6', fontFamily: 'var(--font-mono)' }}>
                  {line}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Show more/less toggle */}
      {lines.length > 20 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1 py-2 text-[11px] text-text-secondary hover:text-text-primary border-t border-border-subtle transition-colors duration-150"
        >
          {expanded ? (
            <>
              <ChevronUp size={14} />
              <span>Show less</span>
            </>
          ) : (
            <>
              <ChevronDown size={14} />
              <span>Show more ({lines.length - 20} lines)</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-[20px] font-semibold leading-[1.3] mt-8 mb-3 text-text-primary">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[17px] font-semibold leading-[1.3] mt-6 mb-2 text-text-primary">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[15px] font-semibold leading-[1.3] mt-5 mb-2 text-text-primary">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="my-3 leading-[1.7]" style={{ fontSize: '15px' }}>{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic">{children}</em>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent hover:underline"
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || '');
    const content = String(children).replace(/\n$/, '');

    // Block code
    if (match || content.includes('\n')) {
      return <CodeBlock language={match?.[1]}>{content}</CodeBlock>;
    }

    // Inline code
    return (
      <code
        className="font-mono text-[13.5px] font-medium bg-bg-user-msg px-1.5 py-0.5 rounded"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => {
    // react-markdown wraps code blocks in <pre><code>. We handle rendering in `code`.
    return <>{children}</>;
  },
  blockquote: ({ children }) => (
    <blockquote className="border-l-[3px] border-accent pl-4 my-3 text-text-secondary">
      {children}
    </blockquote>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-6 my-3 space-y-1.5" style={{ fontSize: '15px', lineHeight: '1.7' }}>
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-6 my-3 space-y-1.5" style={{ fontSize: '15px', lineHeight: '1.7' }}>
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li>{children}</li>
  ),
  hr: () => (
    <hr className="border-border-subtle my-6" />
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border-subtle text-text-secondary text-left">
      {children}
    </thead>
  ),
  tbody: ({ children }) => (
    <tbody className="[&>tr:nth-child(even)]:bg-bg-surface">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="border-b border-border-subtle">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 font-medium text-[13px]">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-[13px]">{children}</td>
  ),
};

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose-relay">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
