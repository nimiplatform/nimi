import { createElement, useCallback, useMemo, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { cn } from '@nimiplatform/kit/ui';
import { resolveChatCopy, type ChatCopy } from '../copy.js';

export type ChatMarkdownRendererProps = {
  content: string;
  appearance?: 'canonical';
  /** Optional copy overrides merged over the default English strings. */
  copy?: ChatCopy;
};

type ChatMarkdownAppearance = NonNullable<ChatMarkdownRendererProps['appearance']>;

type AppearanceConfig = {
  wrapperClassName: string;
  headingClassNames: Record<1 | 2 | 3 | 4 | 5 | 6, string>;
  paragraphClassName: string;
  inlineCodeClassName: string;
  linkClassName: string;
  blockquoteClassName: string;
  listClassName: string;
  orderedListClassName: string;
  hrClassName: string;
  tableContainerClassName: string;
  tableClassName: string;
  theadClassName: string;
  tbodyClassName: string;
  trClassName: string;
  thClassName: string;
  tdClassName: string;
  codeBlockShellClassName: string;
  codeBlockHeaderClassName: string;
  codeBlockLanguageClassName: string;
  codeBlockActionClassName: string;
  codeBlockCopiedClassName: string;
  codeBlockBodyClassName: string;
  codeBlockLineNumberClassName: string;
  codeBlockLineClassName: string;
  codeBlockFooterClassName: string;
};

type MarkdownChildrenProps = {
  children?: ReactNode;
};

type MarkdownLinkProps = MarkdownChildrenProps & {
  href?: string;
};

type MarkdownCodeProps = ComponentPropsWithoutRef<'code'> & {
  children?: ReactNode;
  className?: string;
};

const APPEARANCE_CONFIG: Record<ChatMarkdownAppearance, AppearanceConfig> = {
  canonical: {
    wrapperClassName: 'space-y-0 text-sm leading-[1.6] text-[var(--nimi-text-primary)]',
    headingClassNames: {
      1: 'mt-5 mb-2 text-lg font-semibold tracking-tight text-[var(--nimi-text-primary)]',
      2: 'mt-4 mb-2 text-base font-semibold tracking-tight text-[var(--nimi-text-primary)]',
      3: 'mt-4 mb-1 text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]',
      4: 'mt-3 mb-1 text-[length:var(--nimi-type-body-size)] font-semibold text-[var(--nimi-text-primary)]',
      5: 'mt-3 mb-1 text-[length:var(--nimi-type-body-sm-size)] font-semibold uppercase tracking-wide text-[var(--nimi-text-primary)]',
      6: 'mt-3 mb-1 text-[length:var(--nimi-type-caption-size)] font-semibold uppercase tracking-wide text-[var(--nimi-text-secondary)]',
    },
    paragraphClassName: 'my-2 whitespace-pre-wrap text-sm leading-[1.7] text-[var(--nimi-text-primary)]',
    inlineCodeClassName: 'rounded bg-[var(--nimi-surface-panel)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--nimi-text-primary)]',
    linkClassName: 'underline decoration-[var(--nimi-action-primary-bg)]/70 underline-offset-2 text-[var(--nimi-action-primary-bg)]',
    blockquoteClassName: 'my-2 border-l-2 border-[var(--nimi-action-primary-bg)]/40 pl-3 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]',
    listClassName: 'my-2 list-disc space-y-1 pl-5 text-sm leading-[1.7] text-[var(--nimi-text-primary)]',
    orderedListClassName: 'my-2 list-decimal space-y-1 pl-5 text-sm leading-[1.7] text-[var(--nimi-text-primary)]',
    hrClassName: 'my-4 border-[var(--nimi-border-subtle)]',
    tableContainerClassName: 'my-3 overflow-x-auto',
    tableClassName: 'w-full border-collapse text-left text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-primary)]',
    theadClassName: 'border-b border-[var(--nimi-border-subtle)] text-[var(--nimi-text-secondary)]',
    tbodyClassName: '[&>tr:nth-child(even)]:bg-[color-mix(in_srgb,var(--nimi-surface-panel)_80%,transparent)]',
    trClassName: 'border-b border-[var(--nimi-border-subtle)]',
    thClassName: 'px-3 py-2 font-semibold',
    tdClassName: 'px-3 py-2 align-top',
    // Intentional always-dark code surface: keeps syntax contrast in both schemes.
    codeBlockShellClassName: 'my-3 overflow-hidden rounded-[var(--nimi-radius-md)] bg-gray-950',
    codeBlockHeaderClassName: 'flex items-center justify-between px-4 py-2 text-[length:var(--nimi-type-overline-size)]',
    codeBlockLanguageClassName: 'font-medium uppercase tracking-wider text-gray-400',
    codeBlockActionClassName: 'flex items-center gap-1 text-gray-400 transition-colors duration-[var(--nimi-motion-fast)] hover:text-gray-100',
    codeBlockCopiedClassName: 'text-[var(--nimi-status-success)]',
    codeBlockBodyClassName: 'overflow-x-auto px-4 pb-3',
    codeBlockLineNumberClassName: 'w-[1%] whitespace-nowrap pr-4 text-right align-top font-mono text-[length:var(--nimi-type-mono-size)] leading-[1.6] select-none text-gray-500',
    codeBlockLineClassName: 'whitespace-pre font-mono text-[length:var(--nimi-type-mono-size)] leading-[1.6] text-gray-100',
    codeBlockFooterClassName: 'flex w-full items-center justify-center gap-1 border-t border-gray-800 py-2 text-[length:var(--nimi-type-overline-size)] text-gray-400 transition-colors duration-[var(--nimi-motion-fast)] hover:text-gray-100',
  },
};

function sanitizeLinkHref(href: string): string | null {
  const raw = String(href || '').trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.replace(/\s+/g, '');
  if (/^https?:\/\//i.test(normalized) || /^mailto:/i.test(normalized) || /^tel:/i.test(normalized)) {
    return raw;
  }
  return null;
}

function normalizeMarkdownContent(content: string): string {
  const rawLines = String(content || '').replace(/\r/g, '').split('\n');
  const normalizedLines: string[] = [];
  let inCodeFence = false;

  for (const rawLine of rawLines) {
    const line = rawLine || '';
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      normalizedLines.push(line);
      continue;
    }
    if (!inCodeFence) {
      const inlineHeadingMatch = line.match(/^(.*?[。！？.!?])(\s+)(#{1,6}\s+.+)$/u);
      if (inlineHeadingMatch) {
        normalizedLines.push(inlineHeadingMatch[1] || '');
        normalizedLines.push(inlineHeadingMatch[3] || '');
        continue;
      }
    }
    normalizedLines.push(line);
  }

  return normalizedLines.join('\n');
}

function Heading(props: {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  appearance: ChatMarkdownAppearance;
  children: ReactNode;
}) {
  const Tag = `h${props.level}` as keyof React.JSX.IntrinsicElements;
  const config = APPEARANCE_CONFIG[props.appearance];
  return createElement(Tag, { className: config.headingClassNames[props.level] }, props.children);
}

function CodeBlock(props: {
  appearance: ChatMarkdownAppearance;
  copy: Required<ChatCopy>;
  language?: string;
  children: string;
}) {
  const config = APPEARANCE_CONFIG[props.appearance];
  const [copied, setCopied] = useState(false);
  const lines = props.children.trimEnd().split('\n');
  const [expanded, setExpanded] = useState(lines.length <= 20);

  const handleCopy = useCallback(() => {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      return;
    }
    clipboard.writeText(props.children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      // no-op
    });
  }, [props.children]);

  const visibleLines = expanded ? lines : lines.slice(0, 20);

  return (
    <div className={config.codeBlockShellClassName}>
      <div className={config.codeBlockHeaderClassName}>
        <span className={config.codeBlockLanguageClassName}>
          {props.language || 'code'}
        </span>
        <button type="button" onClick={handleCopy} className={config.codeBlockActionClassName}>
          <span className={copied ? config.codeBlockCopiedClassName : undefined}>
            {copied ? props.copy.markdownCopiedLabel : props.copy.markdownCopyLabel}
          </span>
        </button>
      </div>
      <div className={config.codeBlockBodyClassName}>
        <table className="w-full border-collapse">
          <tbody>
            {visibleLines.map((line, index) => (
              <tr key={`code-line-${index}`}>
                <td className={config.codeBlockLineNumberClassName}>{index + 1}</td>
                <td className={config.codeBlockLineClassName}>{line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lines.length > 20 ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className={config.codeBlockFooterClassName}
        >
          {expanded ? 'Show less' : `Show more (${lines.length - 20} lines)`}
        </button>
      ) : null}
    </div>
  );
}

function createMarkdownComponents(appearance: ChatMarkdownAppearance, copy: Required<ChatCopy>): Components {
  const config = APPEARANCE_CONFIG[appearance];
  const renderHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => (
    ((props: MarkdownChildrenProps) => <Heading level={level} appearance={appearance}>{props.children}</Heading>) as NonNullable<Components['h1']>
  );
  const renderParagraph = ((props: MarkdownChildrenProps) => (
    <p className={config.paragraphClassName}>{props.children}</p>
  )) as NonNullable<Components['p']>;
  const renderStrong = ((props: MarkdownChildrenProps) => (
    <strong className="font-semibold">{props.children}</strong>
  )) as NonNullable<Components['strong']>;
  const renderEmphasis = ((props: MarkdownChildrenProps) => (
    <em className="italic">{props.children}</em>
  )) as NonNullable<Components['em']>;
  const renderLink = ((props: MarkdownLinkProps) => {
    const safeHref = sanitizeLinkHref(String(props.href || ''));
    if (!safeHref) {
      return <>{props.children}</>;
    }
    return (
      <a
        href={safeHref}
        target="_blank"
        rel="noopener noreferrer"
        className={config.linkClassName}
      >
        {props.children}
      </a>
    );
  }) as NonNullable<Components['a']>;
  const renderCode = ((props: MarkdownCodeProps) => {
    const content = String(props.children || '').replace(/\n$/, '');
    const languageMatch = /language-([a-z0-9_-]+)/i.exec(props.className || '');
    if (languageMatch || content.includes('\n')) {
      return (
        <CodeBlock appearance={appearance} copy={copy} language={languageMatch?.[1]} children={content} />
      );
    }
    return (
      <code className={config.inlineCodeClassName}>
        {props.children}
      </code>
    );
  }) as NonNullable<Components['code']>;
  const renderBlockquote = ((props: MarkdownChildrenProps) => (
    <blockquote className={config.blockquoteClassName}>{props.children}</blockquote>
  )) as NonNullable<Components['blockquote']>;
  const renderUnorderedList = ((props: MarkdownChildrenProps) => (
    <ul className={config.listClassName}>{props.children}</ul>
  )) as NonNullable<Components['ul']>;
  const renderOrderedList = ((props: MarkdownChildrenProps) => (
    <ol className={config.orderedListClassName}>{props.children}</ol>
  )) as NonNullable<Components['ol']>;
  const renderTableHead = ((props: MarkdownChildrenProps) => (
    <thead className={config.theadClassName}>{props.children}</thead>
  )) as NonNullable<Components['thead']>;
  const renderTableBody = ((props: MarkdownChildrenProps) => (
    <tbody className={config.tbodyClassName}>{props.children}</tbody>
  )) as NonNullable<Components['tbody']>;
  const renderTableRow = ((props: MarkdownChildrenProps) => (
    <tr className={config.trClassName}>{props.children}</tr>
  )) as NonNullable<Components['tr']>;
  const renderTableHeader = ((props: MarkdownChildrenProps) => (
    <th className={config.thClassName}>{props.children}</th>
  )) as NonNullable<Components['th']>;
  const renderTableCell = ((props: MarkdownChildrenProps) => (
    <td className={config.tdClassName}>{props.children}</td>
  )) as NonNullable<Components['td']>;

  return {
    h1: renderHeading(1),
    h2: renderHeading(2) as NonNullable<Components['h2']>,
    h3: renderHeading(3) as NonNullable<Components['h3']>,
    h4: renderHeading(4) as NonNullable<Components['h4']>,
    h5: renderHeading(5) as NonNullable<Components['h5']>,
    h6: renderHeading(6) as NonNullable<Components['h6']>,
    p: renderParagraph,
    strong: renderStrong,
    em: renderEmphasis,
    a: renderLink,
    code: renderCode,
    pre: (((props: MarkdownChildrenProps) => <>{props.children}</>) as NonNullable<Components['pre']>),
    blockquote: renderBlockquote,
    ul: renderUnorderedList,
    ol: renderOrderedList,
    li: (((props: MarkdownChildrenProps) => <li>{props.children}</li>) as NonNullable<Components['li']>),
    hr: () => <hr className={config.hrClassName} />,
    table: (((props: MarkdownChildrenProps) => (
      <div className={config.tableContainerClassName}>
        <table className={config.tableClassName}>{props.children}</table>
      </div>
    )) as NonNullable<Components['table']>),
    thead: renderTableHead,
    tbody: renderTableBody,
    tr: renderTableRow,
    th: renderTableHeader,
    td: renderTableCell,
  };
}

export function ChatMarkdownRenderer(props: ChatMarkdownRendererProps) {
  const appearance = props.appearance || 'canonical';
  const copy = useMemo(() => resolveChatCopy(props.copy), [props.copy]);
  const normalizedContent = useMemo(
    () => normalizeMarkdownContent(props.content),
    [props.content],
  );
  const components = useMemo(
    () => createMarkdownComponents(appearance, copy),
    [appearance, copy],
  );

  return (
    <div className={cn(APPEARANCE_CONFIG[appearance].wrapperClassName)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}
