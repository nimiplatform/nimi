import { createElement, useCallback, useMemo, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { cn } from '@nimiplatform/nimi-kit/ui';

export type ChatMarkdownRendererProps = {
  content: string;
  appearance?: 'canonical' | 'relay';
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
    wrapperClassName: 'space-y-0 text-sm leading-[1.6] text-gray-900',
    headingClassNames: {
      1: 'mt-5 mb-2 text-lg font-semibold tracking-tight text-gray-950',
      2: 'mt-4 mb-2 text-base font-semibold tracking-tight text-gray-950',
      3: 'mt-4 mb-1 text-[15px] font-semibold text-gray-950',
      4: 'mt-3 mb-1 text-[14px] font-semibold text-gray-950',
      5: 'mt-3 mb-1 text-[13px] font-semibold uppercase tracking-wide text-gray-900',
      6: 'mt-3 mb-1 text-[12px] font-semibold uppercase tracking-wide text-gray-700',
    },
    paragraphClassName: 'my-2 whitespace-pre-wrap text-sm leading-[1.7] text-gray-900',
    inlineCodeClassName: 'rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em] text-gray-900',
    linkClassName: 'underline decoration-emerald-500/70 underline-offset-2 text-emerald-700',
    blockquoteClassName: 'my-2 border-l-2 border-emerald-300/80 pl-3 text-[13px] text-gray-700',
    listClassName: 'my-2 list-disc space-y-1 pl-5 text-sm leading-[1.7] text-gray-900',
    orderedListClassName: 'my-2 list-decimal space-y-1 pl-5 text-sm leading-[1.7] text-gray-900',
    hrClassName: 'my-4 border-gray-200',
    tableContainerClassName: 'my-3 overflow-x-auto',
    tableClassName: 'w-full border-collapse text-left text-[13px] text-gray-900',
    theadClassName: 'border-b border-gray-200 text-gray-600',
    tbodyClassName: '[&>tr:nth-child(even)]:bg-gray-50/80',
    trClassName: 'border-b border-gray-100',
    thClassName: 'px-3 py-2 font-semibold',
    tdClassName: 'px-3 py-2 align-top',
    codeBlockShellClassName: 'my-3 overflow-hidden rounded-[12px] bg-gray-950',
    codeBlockHeaderClassName: 'flex items-center justify-between px-4 py-2 text-[11px]',
    codeBlockLanguageClassName: 'font-medium uppercase tracking-wider text-gray-400',
    codeBlockActionClassName: 'flex items-center gap-1 text-gray-400 transition-colors duration-150 hover:text-gray-100',
    codeBlockCopiedClassName: 'text-emerald-300',
    codeBlockBodyClassName: 'overflow-x-auto px-4 pb-3',
    codeBlockLineNumberClassName: 'w-[1%] whitespace-nowrap pr-4 text-right align-top font-mono text-[13px] leading-[1.6] select-none text-gray-500',
    codeBlockLineClassName: 'whitespace-pre font-mono text-[13px] leading-[1.6] text-gray-100',
    codeBlockFooterClassName: 'flex w-full items-center justify-center gap-1 border-t border-gray-800 py-2 text-[11px] text-gray-400 transition-colors duration-150 hover:text-gray-100',
  },
  relay: {
    wrapperClassName: 'space-y-0 text-[15px] leading-relaxed text-[color:var(--nimi-text-primary)]',
    headingClassNames: {
      1: 'mt-8 mb-3 text-[20px] font-semibold leading-[1.3] text-text-primary',
      2: 'mt-6 mb-2 text-[17px] font-semibold leading-[1.3] text-text-primary',
      3: 'mt-5 mb-2 text-[15px] font-semibold leading-[1.3] text-text-primary',
      4: 'mt-4 mb-2 text-[14px] font-semibold leading-[1.35] text-text-primary',
      5: 'mt-4 mb-1 text-[13px] font-semibold uppercase tracking-wide text-text-primary',
      6: 'mt-4 mb-1 text-[12px] font-semibold uppercase tracking-wide text-text-secondary',
    },
    paragraphClassName: 'my-3 text-[15px] leading-[1.7] text-[color:var(--nimi-text-primary)]',
    inlineCodeClassName: 'rounded bg-bg-user-msg px-1.5 py-0.5 font-mono text-[13.5px] font-medium',
    linkClassName: 'text-accent hover:underline',
    blockquoteClassName: 'my-3 border-l-[3px] border-accent pl-4 text-text-secondary',
    listClassName: 'my-3 list-disc space-y-1.5 pl-6 text-[15px] leading-[1.7]',
    orderedListClassName: 'my-3 list-decimal space-y-1.5 pl-6 text-[15px] leading-[1.7]',
    hrClassName: 'my-6 border-border-subtle',
    tableContainerClassName: 'my-3 overflow-x-auto',
    tableClassName: 'w-full text-sm',
    theadClassName: 'border-b border-border-subtle text-left text-text-secondary',
    tbodyClassName: '[&>tr:nth-child(even)]:bg-bg-surface',
    trClassName: 'border-b border-border-subtle',
    thClassName: 'px-3 py-2 text-[13px] font-medium',
    tdClassName: 'px-3 py-2 text-[13px]',
    codeBlockShellClassName: 'my-3 overflow-hidden rounded-[10px]',
    codeBlockHeaderClassName: 'flex items-center justify-between px-4 py-2 text-[11px]',
    codeBlockLanguageClassName: 'font-medium uppercase tracking-wider text-text-secondary',
    codeBlockActionClassName: 'flex items-center gap-1 text-text-secondary transition-colors duration-150 hover:text-text-primary',
    codeBlockCopiedClassName: 'text-success',
    codeBlockBodyClassName: 'overflow-x-auto px-4 pb-3',
    codeBlockLineNumberClassName: 'w-[1%] whitespace-nowrap pr-4 text-right align-top font-mono text-[13.5px] leading-[1.6] select-none text-text-secondary',
    codeBlockLineClassName: 'whitespace-pre font-mono text-[13.5px] leading-[1.6] text-text-primary',
    codeBlockFooterClassName: 'flex w-full items-center justify-center gap-1 border-t border-border-subtle py-2 text-[11px] text-text-secondary transition-colors duration-150 hover:text-text-primary',
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
    <div
      className={config.codeBlockShellClassName}
      style={props.appearance === 'relay' ? { backgroundColor: '#161616' } : undefined}
    >
      <div className={config.codeBlockHeaderClassName}>
        <span className={config.codeBlockLanguageClassName}>
          {props.language || 'code'}
        </span>
        <button type="button" onClick={handleCopy} className={config.codeBlockActionClassName}>
          <span className={copied ? config.codeBlockCopiedClassName : undefined}>
            {copied ? 'Copied!' : 'Copy'}
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

function createMarkdownComponents(appearance: ChatMarkdownAppearance): Components {
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
        <CodeBlock appearance={appearance} language={languageMatch?.[1]} children={content} />
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
  const normalizedContent = useMemo(
    () => normalizeMarkdownContent(props.content),
    [props.content],
  );
  const components = useMemo(
    () => createMarkdownComponents(appearance),
    [appearance],
  );

  return (
    <div className={cn(APPEARANCE_CONFIG[appearance].wrapperClassName)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}
