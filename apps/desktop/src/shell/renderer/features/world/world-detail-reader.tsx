import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, List, X } from 'lucide-react';
import { Button, EmptyState, IconButton, LoadingSkeleton, OverlayShell, ScrollArea, Timeline, TimelineGroup } from '@nimiplatform/kit/ui';
import { useNimiReducedMotion } from '@nimiplatform/kit/ui/motion';
import type { WorldDetailData, WorldHistoryBundle, WorldSemanticData } from './world-detail-types.js';
import { worldReadingEntries, type WorldReadingEntry, type WorldReadingSection } from './world-detail-reading-model.js';
import { WorldStoryMarkdown } from './world-story-markdown.js';
import {
  loadReaderPreferences,
  ReaderContents,
  ReaderSettings,
  saveReaderPreferences,
  type ReaderOutlineItem,
  type ReaderPreferences,
  type ReaderWidth,
} from './world-reader-controls.js';

const SECTION_ORDER: WorldReadingSection[] = ['description', 'rules', 'systems', 'levels', 'taboos', 'topology', 'causality', 'languages', 'history'];

const READER_MEASURE: Record<ReaderWidth, string> = {
  narrow: '580px',
  standard: '680px',
  wide: '800px',
};

function ReaderParagraph({ text, preWrap }: { text: string; preWrap?: boolean }) {
  return (
    <p className={preWrap ? 'world-reader-paragraph world-reader-paragraph--prewrap' : 'world-reader-paragraph'}>
      {text}
    </p>
  );
}

function ReaderEntryTitle({ text }: { text: string }) {
  return <h3 className="world-reader-entry-title">{text}</h3>;
}

function ReaderEntry({ entry }: { entry: WorldReadingEntry }) {
  return (
    <article className="world-reader-entry">
      {entry.title ? <ReaderEntryTitle text={entry.title} /> : null}
      {entry.body.length ? (
        <div className="world-reader-entry-body">
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
    <div className="world-reader-entries">
      {chunks.map((chunk, chunkIndex) => chunk.kind === 'timeline' ? (
        <Timeline key={`timeline-${chunkIndex}`} className="world-reader-timeline">
          {chunk.items.map((entry, itemIndex) => (
            <TimelineGroup
              key={entry.id}
              date={entry.time ? <span className="world-reader-timeline-date">{entry.time}</span> : undefined}
              tone="neutral"
              isLast={itemIndex === chunk.items.length - 1}
            >
              {entry.title ? <ReaderEntryTitle text={entry.title} /> : null}
              {entry.body.length ? (
                <div className="world-reader-entry-body">
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
    <dl className="world-reader-facts">
      {facts.map((fact) => (
        <div key={fact.id} className="world-reader-fact-row">
          <dt className="world-reader-fact-label">{fact.label}</dt>
          <dd className="world-reader-fact-value">{fact.value}</dd>
        </div>
      ))}
    </dl>
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
  const reducedMotion = useNimiReducedMotion();
  const rootRef = useRef<HTMLElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const pendingAnchor = useRef<{ node: HTMLElement; top: number } | null>(null);
  const [outline, setOutline] = useState<ReaderOutlineItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [preferences, setPreferences] = useState<ReaderPreferences>(() => loadReaderPreferences());
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
      const narrow = root.clientWidth < 980;
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

  const changePreferences = (next: ReaderPreferences | ((previous: ReaderPreferences) => ReaderPreferences)) => {
    rememberPosition();
    setPreferences((previous) => {
      const resolved = typeof next === 'function' ? next(previous) : next;
      saveReaderPreferences(resolved);
      return resolved;
    });
  };
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
    if (story && !headings.length) {
      const storySection = article.querySelector<HTMLElement>('#world-reader-story');
      if (storySection) nodes.unshift(storySection);
    }
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
      if (progressBarRef.current) {
        const maxScroll = viewport.scrollHeight - viewport.clientHeight;
        const ratio = maxScroll > 0 ? Math.min(1, Math.max(0, viewport.scrollTop / maxScroll)) : 0;
        progressBarRef.current.style.transform = `scaleX(${ratio})`;
      }
    };
    viewport.addEventListener('scroll', update, { passive: true });
    update();
    return () => viewport.removeEventListener('scroll', update);
  }, [story, sections, preferences, contentsHidden, geometry.height, scrollViewportRef]);

  const selectHeading = (id: string, moveFocus = true) => {
    const node = articleRef.current?.querySelector<HTMLElement>('[id="' + id + '"]');
    if (!node) return;
    const preferInstant = reducedMotion || document.documentElement?.dataset.nimiReducedMotion === 'true';
    node.scrollIntoView({ behavior: preferInstant ? 'auto' : 'smooth', block: 'start' });
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
    '--world-reader-measure': READER_MEASURE[preferences.width],
    '--world-reader-viewport-height': geometry.height ? `${geometry.height}px` : '100vh',
    '--world-reader-header-height': `${geometry.headerHeight}px`,
  } as CSSProperties;
  const eraLabel = world.era?.trim() || null;
  const masthead = (
    <header className="world-reader-masthead" data-testid="world-reader-masthead">
      <div className="world-reader-masthead-kicker">
        <span>{t('WorldDetail.discovery.story')}</span>
        {eraLabel ? (
          <>
            <span className="world-reader-masthead-dot" aria-hidden="true" />
            <span>{eraLabel}</span>
          </>
        ) : null}
      </div>
      <h1 className="world-reader-masthead-title">{world.name}</h1>
      <div className="world-reader-masthead-rule" aria-hidden="true" />
    </header>
  );

  return (
    <main
      ref={rootRef}
      style={readerStyle}
      className="world-detail-content world-reader"
      data-sidebar={sidebarVisible}
      data-reader-theme={preferences.theme}
      data-reader-layout={preferences.layout}
      data-testid="world-detail-reader"
      data-nimi-density="regular"
    >
      <aside className="world-reader-sidebar" hidden={!sidebarVisible} data-testid="world-reader-contents">
        <div className="world-reader-sidebar-heading">
          <h2 className="world-reader-sidebar-title">{t('WorldDetail.reader.contents')}</h2>
          <Button tone="ghost" size="sm" onClick={toggleContents}>{t('WorldDetail.reader.hideContents')}</Button>
        </div>
        <ScrollArea className="min-h-0 flex-1" contentClassName="px-3 pb-8">{contents()}</ScrollArea>
      </aside>
      <div className="world-reader-page">
        <header
          ref={headerRef}
          className="world-reader-header nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
          data-nimi-material="glass-regular"
          data-nimi-tone="overlay"
        >
          <div className="world-reader-heading-row">
            <div className="world-reader-running-head">
              {!sidebarVisible && outline.length ? (
                <Button
                  tone="ghost"
                  size="sm"
                  leadingIcon={<List size={16} />}
                  aria-expanded={geometry.narrow ? drawerOpen : !contentsHidden}
                  onClick={() => geometry.narrow ? setDrawerOpen(true) : toggleContents()}
                  data-testid="world-reader-show-contents"
                >
                  {t('WorldDetail.reader.contents')}
                </Button>
              ) : null}
              <div className="world-reader-running-crumbs">
                <span className="world-reader-running-title" title={world.name}>{world.name}</span>
                {current?.label && current.label !== world.name ? (
                  <>
                    <span className="world-reader-running-sep" aria-hidden="true">/</span>
                    <span className="world-reader-running-current" title={current.label} aria-live="polite">{current.label}</span>
                  </>
                ) : null}
              </div>
            </div>
            <ReaderSettings value={preferences} onChange={changePreferences} />
          </div>
          <div className="world-reader-progress" aria-hidden="true">
            <div ref={progressBarRef} className="world-reader-progress-bar" />
          </div>
        </header>
        <article ref={articleRef} className="world-reader-article" data-testid="world-detail-reader-content">
          {loading ? <LoadingSkeleton lines={2} label={t('WorldDetail.loading')} /> : null}
          {incomplete ? <EmptyState title={t('WorldDetail.discovery.readingIncomplete')} action={onRetry ? <Button tone="secondary" size="sm" onClick={onRetry}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
          {story ? (
            <section id="world-reader-story" data-toc-label={t('WorldDetail.discovery.story')} tabIndex={-1} className="world-reader-story-section">
              {masthead}
              <WorldStoryMarkdown content={story} title={world.name} />
            </section>
          ) : masthead}
          {sections.map(({ section, items, causalityFacts }) => (
            <section key={section} id={'world-reader-' + section} data-reading-section={section} data-toc-label={t('WorldDetail.discovery.reading.' + section)} tabIndex={-1} className="world-reader-section">
              <h2 className="world-reader-section-title">{t('WorldDetail.discovery.reading.' + section)}</h2>
              {section === 'history' ? <ReaderHistoryEntries entries={items} /> : (
                <div className="world-reader-entries">
                  {items.map((entry) => <ReaderEntry key={entry.id} entry={entry} />)}
                  {causalityFacts.length ? <ReaderCausalityFacts facts={causalityFacts} /> : null}
                </div>
              )}
            </section>
          ))}
        </article>
        {current ? (
          <footer
            className="world-reader-footer nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
            data-nimi-material="glass-regular"
            data-nimi-tone="overlay"
            aria-label={t('WorldDetail.reader.sectionNavigation')}
          >
            <div className="world-reader-footer-inner">
              <span className="world-reader-current" title={current.label}>{current.label}</span>
              {next ? (
                <button type="button" className="world-reader-next" onClick={() => selectHeading(next.id)} data-testid="world-reader-next">
                  <span>
                    <span className="world-reader-next-label">{t('WorldDetail.reader.next')}</span>
                    <span className="world-reader-next-title">{next.label}</span>
                  </span>
                  <ArrowRight size={15} className="shrink-0" />
                </button>
              ) : null}
            </div>
          </footer>
        ) : null}
      </div>
      <OverlayShell open={drawerOpen} kind="drawer" side="left" onClose={() => setDrawerOpen(false)} data-testid="world-reader-drawer"
        title={<div className="flex items-center justify-between gap-4"><span>{t('WorldDetail.reader.contents')}</span><IconButton tone="ghost" size="sm" icon={<X size={18} />} aria-label={t('WorldDetail.reader.closeContents')} onClick={() => setDrawerOpen(false)} /></div>}
        panelClassName="flex flex-col rounded-none" contentClassName="min-h-0 flex-1 px-0 pb-0"
        panelStyle={{ left: geometry.left, right: 'auto', top: geometry.top, height: geometry.height - geometry.headerHeight, width: 'min(300px, calc(100vw - 32px))', maxWidth: 'calc(100vw - 32px)' }}>
        <ScrollArea className="h-full" contentClassName="px-4 pb-6">{contents(true)}</ScrollArea>
      </OverlayShell>
    </main>
  );
}
