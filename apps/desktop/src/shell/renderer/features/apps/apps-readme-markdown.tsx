import type { ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openExternalUrl } from '@nimiplatform/kit/shell/renderer/bridge';

export function readmeExternalHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const parsed = new URL(href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Project README document surface. react-markdown emits no raw HTML, and
 * images are reduced to their alt text because relative asset paths have no
 * trusted base inside the shell.
 */
export function AppsReadmeMarkdown({ content }: { readonly content: string }): ReactElement {
  return (
    <div data-testid="apps-readme-markdown" className="min-w-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 mt-6 text-xl font-semibold leading-8 text-[color:var(--nimi-text-primary)] first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-5 text-lg font-semibold leading-7 text-[color:var(--nimi-text-primary)] first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-4 text-base font-semibold leading-6 text-[color:var(--nimi-text-primary)] first:mt-0">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1.5 mt-4 text-sm font-semibold leading-6 text-[color:var(--nimi-text-primary)] first:mt-0">{children}</h4>
          ),
          p: ({ children }) => (
            <p className="my-3 text-sm leading-6 text-[color:var(--nimi-text-secondary)] first:mt-0 last:mb-0">{children}</p>
          ),
          a: ({ children, href }) => {
            const externalHref = readmeExternalHref(href);
            if (!externalHref) {
              return <span className="font-medium text-[var(--nimi-text-secondary)]">{children}</span>;
            }
            return (
              <a
                href={externalHref}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[var(--nimi-action-primary-bg)] underline decoration-[color-mix(in_srgb,var(--nimi-action-primary-bg)_40%,transparent)] underline-offset-2 hover:decoration-current"
                onClick={(event) => {
                  event.preventDefault();
                  void openExternalUrl(externalHref).catch(() => undefined);
                }}
              >
                {children}
              </a>
            );
          },
          code: ({ children, className }) => {
            if (className) {
              return <code className={className}>{children}</code>;
            }
            return (
              <code className="rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_68%,transparent)] px-1.5 py-0.5 font-mono text-xs text-[color:var(--nimi-text-primary)]">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-active)_54%,transparent)] p-3 font-mono text-xs leading-5 text-[color:var(--nimi-text-primary)] first:mt-0 last:mb-0">
              {children}
          </pre>
          ),
          ul: ({ children }) => (
            <ul className="my-3 list-disc space-y-1 pl-5 text-sm leading-6 text-[color:var(--nimi-text-secondary)]">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 list-decimal space-y-1 pl-5 text-sm leading-6 text-[color:var(--nimi-text-secondary)]">{children}</ol>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-[color:var(--nimi-border-strong)] pl-3 text-sm italic leading-6 text-[color:var(--nimi-text-muted)]">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-5 border-[color:var(--nimi-border-subtle)]" />,
          img: ({ alt }) => (
            <span className="my-2 inline-flex items-center rounded-md border border-dashed border-[color:var(--nimi-border-subtle)] px-2 py-1 text-xs text-[color:var(--nimi-text-muted)]">
              {alt || 'image'}
            </span>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-[color:var(--nimi-border-subtle)]">
              <table className="w-full border-collapse text-xs leading-5">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-active)_54%,transparent)] px-3 py-2 text-left font-semibold text-[color:var(--nimi-text-primary)]">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-[color:var(--nimi-border-subtle)] px-3 py-2 text-[color:var(--nimi-text-secondary)] last:border-b-0">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
