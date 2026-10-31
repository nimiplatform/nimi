import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, List, X } from 'lucide-react';
import { Button, EmptyState, IconButton, LoadingSkeleton, NimiText, OverlayShell, ScrollArea, Timeline, TimelineGroup } from '@nimiplatform/kit/ui';
import type { WorldDetailData, WorldHistoryBundle, WorldSemanticData } from './world-detail-types.js';
import { worldReadingEntries, type WorldReadingEntry, type WorldReadingSection } from './world-detail-reading-model.js';
import { WorldStoryMarkdown } from './world-story-markdown.js';
import { DEFAULT_READER_PREFERENCES, ReaderContents, ReaderSettings, type ReaderOutlineItem, type ReaderPreferences } from './world-reader-controls.js';

const SECTION_ORDER: WorldReadingSection[] = ['description', 'rules', 'systems', 'levels', 'taboos', 'topology', 'causality', 'languages', 'history'];

const READER_BODY_STYLE = { fontSize: 'var(--world-reader-font-size)', lineHeight: 'var(--world-reader-line-height)' } as const;

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

// @nimi-authority: rule.nimi.desktop.shell-ui.r011
// @nimi-authority: rule.nimi.desktop.shell-ui.r013
export function WorldDetailReader({ world, semantic, history, loading, incomplete, onRetry, scrollViewportRef }: {
  world: WorldDetailData;
  semantic: WorldSemanticData;
  history: WorldHistoryBundle;
  loading?: boolean;
  incomplete?: boolean;
  onRetry?: () => void;
  scrollViewportRef?: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const pendingAnchor = useRef<{ node: HTMLElement; top: number } | null>(null);
  const [outline, setOutline] = useState<ReaderOutlineItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [preferences, setPreferences] = useState(DEFAULT_READER_PREFERENCES);
  const [contentsHidden, setContentsHidden] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [geometry, setGeometry] = useState({ narrow: false, height: 0, headerHeight: 0, left: 0, top: 0 });
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

  useLayoutEffect(() => {
    const root = rootRef.current;
    const header = headerRef.current;
    const viewport = scrollViewportRef?.current;
    if (!root || !header || !viewport) return;
    const measure = () => {
      const bounds = viewport.getBoundingClientRect();
      const headerHeight = header.getBoundingClientRect().height;
      const narrow = root.clientWidth < 1050;
      setGeometry({ narrow, height: viewport.clientHeight, headerHeight, left: bounds.left, top: bounds.top + headerHeight });
      if (!narrow) setDrawerOpen(false);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(header);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [scrollViewportRef]);

  // Anchor the visible paragraph before changing typography or column width.
  // Reflow should never move the reader to a different part of the document.
  const rememberPosition = () => {
    const top = (headerRef.current?.getBoundingClientRect().bottom ?? 0) + 16;
    const node = [...(articleRef.current?.querySelectorAll<HTMLElement>('p, li, th, td, h1, h2, h3, h4, h5, h6') ?? [])]
      .find((element) => !element.querySelector('p, li, th, td') && element.getBoundingClientRect().bottom > top);
    pendingAnchor.current = node ? { node, top: node.getBoundingClientRect().top } : null;
  };
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current;
    const viewport = scrollViewportRef?.current;
    if (anchor && viewport) viewport.scrollTop += anchor.node.getBoundingClientRect().top - anchor.top;
    pendingAnchor.current = null;
  }, [preferences, contentsHidden, scrollViewportRef]);

  const changePreferences = (next: ReaderPreferences) => { rememberPosition(); setPreferences(next); };
  const toggleContents = () => { rememberPosition(); setContentsHidden((value) => !value); };

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
      const top = (headerRef.current?.getBoundingClientRect().bottom ?? viewport.getBoundingClientRect().top) + 120;
      let active = items[0]?.id || '';
      for (const node of nodes) if (node.getBoundingClientRect().top <= top) active = node.id;
      setActiveId(active);
    };
    viewport.addEventListener('scroll', update, { passive: true });
    update();
    return () => viewport.removeEventListener('scroll', update);
  }, [story, sections, scrollViewportRef]);

  const selectHeading = (id: string, moveFocus = true) => {
    const node = articleRef.current?.querySelector<HTMLElement>('[id="' + id + '"]');
    if (!node) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    if (moveFocus) node.focus({ preventScroll: true });
    setActiveId(id);
    // Reveal the selected heading without closing chapters opened by the user.
    const ancestors: ReaderOutlineItem[] = [];
    for (const item of outline) {
      while (ancestors.length && ancestors.at(-1)!.depth >= item.depth) ancestors.pop();
      if (item.id === id) break;
      ancestors.push(item);
    }
    setExpanded((previous) => ({ ...previous, ...Object.fromEntries(ancestors.map((item) => [item.id, true])) }));
  };
  const contents = (inDrawer = false) => <ReaderContents items={outline} activeId={activeId} expanded={expanded}
    onExpand={(id, open) => setExpanded((previous) => ({ ...previous, [id]: open }))}
    onSelect={(id) => {
      // The modal owns focus until its exit finishes; let Kit restore the
      // directory trigger instead of focusing an aria-hidden document.
      if (inDrawer) { setDrawerOpen(false); selectHeading(id, false); }
      else selectHeading(id);
    }} />;
  const activeIndex = outline.findIndex((item) => item.id === activeId);
  const current = outline[activeIndex];
  const next = outline[activeIndex + 1];
  const sidebarVisible = outline.length > 0 && !contentsHidden && !geometry.narrow;
  const readerStyle = {
    '--world-reader-font-size': `${preferences.fontSize}px`,
    '--world-reader-line-height': preferences.lineHeight,
    '--world-reader-measure': preferences.width === 'wide' ? '900px' : '780px',
    '--world-reader-viewport-height': geometry.height ? `${geometry.height}px` : '100vh',
    '--world-reader-header-height': `${geometry.headerHeight}px`,
  } as CSSProperties;

  return (
    <main ref={rootRef} style={readerStyle} className="world-detail-content world-reader" data-sidebar={sidebarVisible} data-testid="world-detail-reader" data-nimi-density="regular">
      <aside className="world-reader-sidebar" hidden={!sidebarVisible} data-testid="world-reader-contents">
        <div className="world-reader-sidebar-heading">
          <NimiText as="h2" role="page-title">{t('WorldDetail.reader.contents')}</NimiText>
          <Button tone="ghost" size="sm" onClick={toggleContents}>{t('WorldDetail.reader.hideContents')}</Button>
        </div>
        <ScrollArea className="min-h-0 flex-1" contentClassName="px-5 pb-8">{contents()}</ScrollArea>
      </aside>
      <div className="world-reader-page">
        <header ref={headerRef} className="world-reader-header">
          <div className="world-reader-heading-row">
            <div className="world-reader-identity">
              <h1>{world.name}</h1><NimiText role="caption">{t('WorldDetail.discovery.story')}</NimiText>
            </div>
            <ReaderSettings value={preferences} onChange={changePreferences} />
          </div>
          {!sidebarVisible && outline.length ? <div className="world-reader-compact-navigation">
            <Button tone="secondary" size="sm" leadingIcon={<List size={17} />} aria-expanded={geometry.narrow ? drawerOpen : !contentsHidden}
              onClick={() => geometry.narrow ? setDrawerOpen(true) : toggleContents()} data-testid="world-reader-show-contents">{t('WorldDetail.reader.contents')}</Button>
            <NimiText role="caption" className="min-w-0 truncate" title={current?.label} aria-live="polite">{current?.label}</NimiText>
          </div> : null}
        </header>
        <article ref={articleRef} className="world-reader-article space-y-12" data-testid="world-detail-reader-content">
          {loading ? <LoadingSkeleton lines={2} label={t('WorldDetail.loading')} /> : null}
          {incomplete ? <EmptyState title={t('WorldDetail.discovery.readingIncomplete')} action={onRetry ? <Button tone="secondary" size="sm" onClick={onRetry}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
          {story ? <section id="world-reader-story" data-toc-label={t('WorldDetail.discovery.story')} tabIndex={-1}>
            <WorldStoryMarkdown content={story} title={world.name} />
          </section> : null}
          {sections.map(({ section, items, causalityFacts }) => (
            <section key={section} id={'world-reader-' + section} data-reading-section={section} data-toc-label={t('WorldDetail.discovery.reading.' + section)} tabIndex={-1} className="space-y-5">
              <NimiText as="h2" role="section-title">{t('WorldDetail.discovery.reading.' + section)}</NimiText>
              {section === 'history' ? <ReaderHistoryEntries entries={items} /> : <div className="space-y-6">
                {items.map((entry) => <ReaderEntry key={entry.id} entry={entry} />)}
                {causalityFacts.length ? <ReaderCausalityFacts facts={causalityFacts} /> : null}
              </div>}
            </section>
          ))}
        </article>
        {current ? <footer className="world-reader-footer" aria-label={t('WorldDetail.reader.sectionNavigation')}>
          <NimiText role="caption" className="world-reader-current" title={current.label}>{current.label}</NimiText>
          {next ? <button type="button" className="world-reader-next" onClick={() => selectHeading(next.id)} data-testid="world-reader-next">
            <span><span className="world-reader-next-label">{t('WorldDetail.reader.next')}</span><span>{next.label}</span></span><ArrowRight size={18} className="shrink-0" />
          </button> : null}
        </footer> : null}
      </div>
      <OverlayShell open={drawerOpen} kind="drawer" onClose={() => setDrawerOpen(false)} data-testid="world-reader-drawer"
        title={<div className="flex items-center justify-between gap-4"><span>{t('WorldDetail.reader.contents')}</span><IconButton tone="ghost" size="sm" icon={<X size={18} />} aria-label={t('WorldDetail.reader.closeContents')} onClick={() => setDrawerOpen(false)} /></div>}
        panelClassName="flex flex-col rounded-none" contentClassName="min-h-0 flex-1 px-0 pb-0"
        panelStyle={{ left: geometry.left, right: 'auto', top: geometry.top, height: geometry.height - geometry.headerHeight, width: 'min(320px, calc(100vw - 32px))', maxWidth: 'calc(100vw - 32px)' }}>
        <ScrollArea className="h-full" contentClassName="px-5 pb-6">{contents(true)}</ScrollArea>
      </OverlayShell>
    </main>
  );
}
