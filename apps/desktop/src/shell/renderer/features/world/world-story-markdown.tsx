import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openExternalUrl } from '@nimiplatform/kit/shell/renderer/bridge';

type MarkdownNode = {
  type: string;
  value?: string;
  depth?: number;
  children?: MarkdownNode[];
  position?: { start: { offset?: number } };
  data?: { hProperties?: Record<string, unknown> };
};

const nodeText = (node: MarkdownNode): string => node.value ?? (node.children ?? []).map(nodeText).join('');

// @nimi-authority: rule.nimi.desktop.shell-ui.r013
// Work on parsed Markdown: fenced code cannot create a chapter, and the
// excerpt retains complete source paragraphs rather than invented summaries.
function remarkWorldStory(options: { excerpt: boolean; title?: string }) {
  return (tree: { children: MarkdownNode[] }) => {
    if (options.excerpt) {
      const start = tree.children.findIndex((node) => ['paragraph', 'list', 'blockquote', 'table'].includes(node.type));
      if (start >= 0) {
        const heading = tree.children.slice(0, start).filter((node) => node.type === 'heading').at(-1);
        const body: MarkdownNode[] = [];
        for (const node of tree.children.slice(start)) {
          if (node.type === 'heading' || body.length >= 3) break;
          if (node.type !== 'thematicBreak') body.push(node);
        }
        tree.children = [...(heading ? [heading] : []), ...body];
      }
    } else {
      const first = tree.children[0];
      // The document title already appears in the page header. All other
      // authored headings, including subsequent part titles, stay in order.
      if (first?.type === 'heading' && first.depth === 1
        && nodeText(first).replace(/^[《「]|[》」]$/g, '') === options.title) tree.children = tree.children.slice(1);
    }
    let index = 0;
    const visit = (node: MarkdownNode) => {
      if (node.type === 'heading') {
        node.data = { ...node.data, hProperties: {
          ...node.data?.hProperties,
          id: 'world-story-heading-' + (node.position?.start.offset ?? index++),
          'data-world-heading': node.depth,
          tabIndex: -1,
        } };
      }
      node.children?.forEach(visit);
    };
    tree.children.forEach(visit);
  };
}

export function WorldStoryMarkdown({ content, excerpt = false, title }: {
  content: string;
  excerpt?: boolean;
  title?: string;
}) {
  return (
    <div
      data-testid={excerpt ? 'world-story-excerpt' : 'world-story-document'}
      className={'min-w-0 break-words text-[var(--nimi-text-secondary)] [overflow-wrap:anywhere] '
        + '[&_p]:my-4 [&_p]:leading-[1.9] [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 '
        + '[&_h1]:mb-5 [&_h1]:mt-10 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-relaxed '
        + '[&_h2]:mb-4 [&_h2]:mt-9 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-relaxed '
        + '[&_h3]:mb-4 [&_h3]:mt-7 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:leading-relaxed '
        + '[&_h4]:mb-3 [&_h4]:mt-6 [&_h4]:font-semibold [&_h4]:leading-relaxed '
        + '[&_h5]:my-3 [&_h5]:font-semibold [&_h6]:my-3 [&_h6]:font-semibold '
        + '[&_[data-world-heading]]:scroll-mt-8 [&_[data-world-heading]]:text-[var(--nimi-text-primary)] '
        + '[&>h1:first-child]:mt-0 [&>h2:first-child]:mt-0 [&>h3:first-child]:mt-0 '
        + '[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-2 [&_li]:leading-[1.9] '
        + '[&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--nimi-border-subtle)] [&_blockquote]:pl-5 '
        + '[&_hr]:my-8 [&_hr]:border-[var(--nimi-border-subtle)] [&_strong]:font-semibold '
        + '[&_code]:font-mono [&_code]:text-[0.9em] [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[var(--nimi-surface-panel)] [&_pre]:p-4 '
        + '[&_th]:border-b [&_th]:border-[var(--nimi-border-subtle)] [&_th]:p-3 [&_th]:text-left [&_td]:border-b [&_td]:border-[var(--nimi-border-subtle)] [&_td]:p-3 '
        + (excerpt ? 'text-[length:var(--nimi-type-body-size)]' : 'text-base @min-[1120px]:text-[17px]')}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkWorldStory, { excerpt, title }]]}
        components={{
          // Story media is rendered from its issued public media records;
          // prose must not silently load arbitrary remote or relative images.
          img: ({ alt }) => <span>{alt}</span>,
          a: ({ href, children }) => {
            if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>;
            return <a href={href} target="_blank" rel="noreferrer" className="text-[var(--nimi-action-primary-bg)] underline underline-offset-4" onClick={(event) => { event.preventDefault(); void openExternalUrl(href); }}>{children}</a>;
          },
          table: ({ children }) => <div className="overflow-x-auto"><table className="w-full border-collapse">{children}</table></div>,
        }}
      >{content}</ReactMarkdown>
    </div>
  );
}
