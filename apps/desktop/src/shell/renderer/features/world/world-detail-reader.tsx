import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, LoadingSkeleton, NimiText, Timeline, TimelineGroup } from '@nimiplatform/kit/ui';
import { ArrowLeft } from 'lucide-react';
import type { WorldDetailData, WorldHistoryBundle, WorldSemanticData } from './world-detail-types.js';
import { worldReadingEntries, type WorldReadingEntry, type WorldReadingSection } from './world-detail-reading-model.js';
import { WorldStoryMarkdown } from './world-story-markdown.js';

const SECTION_ORDER: WorldReadingSection[] = ['description', 'rules', 'systems', 'levels', 'taboos', 'topology', 'causality', 'languages', 'history'];

// Long-form reading measure: 14px body text on a ~1.85 line height keeps CJK
// paragraphs comfortable without inventing per-theme values.
const READER_BODY_STYLE = { lineHeight: 1.85 } as const;

function ReaderParagraph({ text, preWrap }: { text: string; preWrap?: boolean }) {
  return (
    <NimiText
      role="body"
      style={READER_BODY_STYLE}
      className={preWrap ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]' : 'break-words [overflow-wrap:anywhere]'}
    >
      {text}
    </NimiText>
  );
}

function ReaderEntryTitle({ text }: { text: string }) {
  return <NimiText as="h3" role="card-title" className="break-words">{text}</NimiText>;
}

function ReaderEntry({ entry }: { entry: WorldReadingEntry }) {
  return (
    <article>
      {entry.title ? <ReaderEntryTitle text={entry.title} /> : null}
      {entry.body.length ? (
        <div className={`space-y-4 ${entry.title ? 'mt-3' : ''}`}>
          {entry.body.map((text, index) => <ReaderParagraph key={index} text={text} preWrap />)}
        </div>
      ) : null}
    </article>
  );
}

type HistoryChunk =
  | { kind: 'timeline'; items: WorldReadingEntry[] }
  | { kind: 'entry'; entry: WorldReadingEntry };

// Dated events keep their supplied order and render on one quiet timeline;
// undated entries fall back to the regular reading layout in place.
function ReaderHistoryEntries({ entries }: { entries: WorldReadingEntry[] }) {
  const chunks: HistoryChunk[] = [];
  entries.forEach((entry) => {
    if (entry.time) {
      const last = chunks[chunks.length - 1];
      if (last && last.kind === 'timeline') last.items.push(entry);
      else chunks.push({ kind: 'timeline', items: [entry] });
    } else {
      chunks.push({ kind: 'entry', entry });
    }
  });
  return (
    <div className="space-y-6">
      {chunks.map((chunk, chunkIndex) => chunk.kind === 'timeline' ? (
        <Timeline key={`timeline-${chunkIndex}`}>
          {chunk.items.map((entry, itemIndex) => (
            <TimelineGroup key={entry.id} date={entry.time} tone="neutral" isLast={itemIndex === chunk.items.length - 1}>
              {entry.title ? <ReaderEntryTitle text={entry.title} /> : null}
              {entry.body.length ? (
                <div className={`space-y-4 ${entry.title ? 'mt-0.5' : ''}`}>
                  {entry.body.map((text, index) => <ReaderParagraph key={index} text={text} preWrap />)}
                </div>
              ) : null}
            </TimelineGroup>
          ))}
        </Timeline>
      ) : (
        <ReaderEntry key={chunk.entry.id} entry={chunk.entry} />
      ))}
    </div>
  );
}

function ReaderCausalityFacts({ facts }: { facts: { id: string; label: string; value: string }[] }) {
  return (
    <div className="divide-y divide-[var(--nimi-border-subtle)]">
      {facts.map((fact) => (
        <div key={fact.id} className="flex items-baseline justify-between gap-6 py-3 first:pt-0 last:pb-0">
          <NimiText role="body" style={READER_BODY_STYLE}>{fact.label}</NimiText>
          <NimiText role="body" className="text-right text-[var(--nimi-text-primary)]">{fact.value}</NimiText>
        </div>
      ))}
    </div>
  );
}

type ReaderOutlineItem = { id: string; label: string; depth: number };

// @nimi-authority: rule.nimi.desktop.shell-ui.r011
// @nimi-authority: rule.nimi.desktop.shell-ui.r013
export function WorldDetailReader({ world, semantic, history, loading, incomplete, onRetry, onClose, scrollViewportRef }: {
  world: WorldDetailData;
  semantic: WorldSemanticData;
  history: WorldHistoryBundle;
  loading?: boolean;
  incomplete?: boolean;
  onRetry?: () => void;
  onClose: () => void;
  scrollViewportRef?: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const articleRef = useRef<HTMLElement | null>(null);
  const [outline, setOutline] = useState<ReaderOutlineItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const entries = useMemo(() => worldReadingEntries(world, semantic, history), [world, semantic, history]);
  const story = world.setting?.trim() || entries.find((entry) => entry.section === 'description')?.body.join('\n\n') || '';
  const sections = useMemo(() => SECTION_ORDER.filter((section) => section !== 'description').map((section) => {
    const items = entries.filter((entry) => entry.section === section);
    const causality = section === 'causality' ? semantic.causality : null;
    const causalityFacts = causality ? [
      causality.karmaEnabled != null ? { id: 'karma', label: t('WorldDetail.discovery.karma'), value: t(causality.karmaEnabled ? 'WorldDetail.discovery.yes' : 'WorldDetail.discovery.no') } : null,
      causality.fateWeight != null ? { id: 'fateWeight', label: t('WorldDetail.discovery.fateWeight'), value: String(causality.fateWeight) } : null,
    ].filter((fact): fact is { id: string; label: string; value: string } => Boolean(fact)) : [];
    return { section, items, causalityFacts };
  }).filter(({ items, causalityFacts }) => items.length > 0 || causalityFacts.length > 0), [entries, semantic, t]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    // Read the rendered Markdown headings, not lines that merely resemble
    // headings inside a fenced example. Offsets keep duplicate titles unique.
    const headings = [...article.querySelectorAll<HTMLElement>('[data-world-heading]')]
      .filter((node) => Number(node.dataset.worldHeading) <= 3);
    const supplemental = [...article.querySelectorAll<HTMLElement>('[data-reading-section]')];
    const nodes = [...headings, ...supplemental];
    if (story && !headings.length) nodes.unshift(article.querySelector<HTMLElement>('#world-reader-story')!);
    const items = nodes.map((node) => ({
      id: node.id,
      label: node.dataset.tocLabel || node.textContent?.trim() || '',
      depth: Number(node.dataset.worldHeading || 1),
    }));
    setOutline(items);
    setActiveId(items[0]?.id || '');
    const viewport = scrollViewportRef?.current;
    if (!viewport) return;
    const update = () => {
      const top = viewport.getBoundingClientRect().top + 120;
      let active = items[0]?.id || '';
      for (const node of nodes) if (node.getBoundingClientRect().top <= top) active = node.id;
      setActiveId(active);
    };
    viewport.addEventListener('scroll', update, { passive: true });
    update();
    return () => viewport.removeEventListener('scroll', update);
  }, [story, sections, scrollViewportRef]);

  const selectHeading = (id: string) => {
    const node = articleRef.current?.querySelector<HTMLElement>('[id="' + id + '"]');
    if (!node) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    node.focus({ preventScroll: true });
    setActiveId(id);
  };
  const contents = <nav aria-label={t('WorldDetail.discovery.contents')} className="space-y-1">
    {outline.map((item) => <button key={item.id} type="button" aria-current={activeId === item.id ? 'location' : undefined}
      onClick={() => selectHeading(item.id)}
      className={'block w-full rounded-md border-l-2 px-3 py-2.5 text-left text-sm leading-6 transition-colors '
        + (item.depth >= 3 ? 'pl-6 ' : '')
        + (activeId === item.id ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]' : 'border-transparent text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-panel)]')}>
      {item.label}
    </button>)}
  </nav>;

  return (
    <main className="@container mx-auto w-full max-w-[1440px] p-6 @min-[1120px]:px-10" data-testid="world-detail-reader" data-nimi-density="regular">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--nimi-border-subtle)] pb-5">
        <Button tone="ghost" size="sm" leadingIcon={<ArrowLeft size={16} />} onClick={onClose}>{t('WorldDetail.discovery.backToWorld')}</Button>
        <NimiText as="h1" role="card-title" className="max-w-[680px] break-words">{world.name}</NimiText>
      </header>
      <div className="grid items-start gap-8 @min-[960px]:grid-cols-[240px_minmax(0,1fr)] @min-[1120px]:gap-12">
        {outline.length ? <>
          <aside className="sticky top-6 hidden max-h-[calc(100vh-180px)] overflow-y-auto pr-2 @min-[960px]:block" data-testid="world-reader-contents">
            <NimiText role="section-title" className="mb-5">{t('WorldDetail.discovery.contents')}</NimiText>
            {contents}
          </aside>
          <details className="border-b border-[var(--nimi-border-subtle)] pb-4 @min-[960px]:hidden">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--nimi-text-primary)]">{t('WorldDetail.discovery.contents')}</summary>
            <div className="mt-3">{contents}</div>
          </details>
        </> : <div className="hidden @min-[960px]:block" />}
        <article ref={articleRef} className="mx-auto w-full min-w-0 max-w-[760px] space-y-12 pb-16" data-testid="world-detail-reader-content">
          {loading ? <LoadingSkeleton lines={2} label={t('WorldDetail.loading')} /> : null}
          {incomplete ? <EmptyState title={t('WorldDetail.discovery.readingIncomplete')} action={onRetry ? <Button tone="secondary" size="sm" onClick={onRetry}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
          {story ? <section id="world-reader-story" data-toc-label={t('WorldDetail.discovery.story')} tabIndex={-1}>
            <WorldStoryMarkdown content={story} title={world.name} />
          </section> : null}
          {sections.map(({ section, items, causalityFacts }) => (
            <section key={section} id={'world-reader-' + section} data-reading-section={section} data-toc-label={t('WorldDetail.discovery.reading.' + section)} tabIndex={-1} className="scroll-mt-8 space-y-5">
              <NimiText as="h2" role="section-title">{t('WorldDetail.discovery.reading.' + section)}</NimiText>
              {section === 'history' ? <ReaderHistoryEntries entries={items} /> : <div className="space-y-6">
                {items.map((entry) => <ReaderEntry key={entry.id} entry={entry} />)}
                {causalityFacts.length ? <ReaderCausalityFacts facts={causalityFacts} /> : null}
              </div>}
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}
