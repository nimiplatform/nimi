import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type {
  HeroDemoShijingBaziRoute,
  HeroDemoShijingElement,
  HeroDemoShijingMethodId,
  HeroDemoShijingMingjing,
  HeroDemoShijingQizhengRoute,
  HeroDemoShijingQizhengStar,
  HeroDemoShijingTone,
  HeroDemoShijingZiweiRoute,
  HeroDemoShijingZiweiStar,
} from '../content/landing-content.js';

/**
 * Interactive replica of the ShiJing 命镜 (Destiny Mirror) tab. Like the app
 * (nimiapp-shijing product/tabs/mingjing-tab.tsx) it is method-routed: the
 * global 推演方法 select decides whether the 八字子平法, 紫微斗数(三合派), or
 * 七政四余/果老星宗 route renders. Each route mounts the app's own class names
 * on the ported stylesheet (demo-shijing.css, mingjing-*.css section). The
 * chart data is engine-generated fixture content; AI readings are mock data
 * and "generate" only simulates the wait.
 */

const GENERATE_MS = 1_600;

const CORE_ORDER = ['personality', 'strengths', 'long_term_themes', 'relationship_pattern', 'career_inclination'] as const;
const PROFILE_ORDER = ['life_pattern', 'strengths', 'long_term_theme', 'relationship_pattern', 'career_inclination'] as const;
const FIVE_ELEMENTS: readonly HeroDemoShijingElement[] = ['wood', 'fire', 'earth', 'metal', 'water'];
const HUA_LEGEND = ['禄', '权', '科', '忌'] as const;

function fill(template: string, count: number): string {
  return template.replace('{count}', String(count));
}

/* ------------------------------------------------------------------------ */
/* Shared bits: generating button, info popover, icons                      */
/* ------------------------------------------------------------------------ */

function GeneratingButton({
  busy,
  busyLabel,
  className,
  children,
  onClick,
}: {
  busy: boolean;
  busyLabel: string;
  className?: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`shijing-generating-button${className ? ` ${className}` : ''}`}
      data-busy={busy ? 'true' : undefined}
      aria-busy={busy}
      disabled={busy}
      onClick={onClick}
    >
      {busy ? <span className="shijing-generating-button__spinner" aria-hidden="true" /> : null}
      <span className="shijing-generating-button__label">{busy ? busyLabel : children}</span>
    </button>
  );
}

function useSimulatedGenerate(): { busy: boolean; run: () => void } {
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const run = useCallback(() => {
    if (busy) return;
    setBusy(true);
    timer.current = setTimeout(() => setBusy(false), GENERATE_MS);
  }, [busy]);
  return { busy, run };
}

// Stands in for the kit Popover the app uses (mingjing-info.tsx): a toggle
// button with an inline bubble anchored below it.
function MingJingInfo({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <span className="sjd-info" ref={ref}>
      <button
        type="button"
        className="shijing-mingjing-info__button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <circle cx="12" cy="8" r="0.7" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open ? <span className="shijing-mingjing-info__bubble" role="tooltip">{children}</span> : null}
    </span>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
    </svg>
  );
}

/* ------------------------------------------------------------------------ */
/* 八字子平法 route                                                          */
/* ------------------------------------------------------------------------ */

function BaziRoute({
  content,
  tendency,
  readingCopy,
}: {
  content: HeroDemoShijingBaziRoute;
  tendency: Record<HeroDemoShijingTone, string>;
  readingCopy: HeroDemoShijingMingjing['reading'];
}) {
  const stagesRef = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState(content.events.items);
  return (
    <>
      <BaziHero content={content.hero} tendency={tendency} onSeeStages={() => stagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
      <div className="shijing-mingjing__panels" data-mingjing-route="bazi_ziping_v1">
        <BaziPaipan content={content.paipan} />
        <div ref={stagesRef} className="shijing-mingjing__anchor">
          <BaziDayun content={content.dayun} tendency={tendency} />
        </div>
        <BaziLiunian content={content.liunian} tendency={tendency} />
        <BaziEvents content={content.events} tendency={tendency} events={events} onChange={setEvents} />
        <BaziReading content={content.reading} readingCopy={readingCopy} />
      </div>
      <button type="button" className="shijing-mj-footer-cta">{content.rectifyEntry}</button>
    </>
  );
}

function BaziHero({
  content,
  tendency,
  onSeeStages,
}: {
  content: HeroDemoShijingBaziRoute['hero'];
  tendency: Record<HeroDemoShijingTone, string>;
  onSeeStages: () => void;
}) {
  const labels: Record<HeroDemoShijingElement, string> = { wood: '木', fire: '火', earth: '土', metal: '金', water: '水' };
  return (
    <header className="shijing-mj-hero" data-strength={content.strengthClass}>
      <div className="shijing-mj-hero__glow" aria-hidden="true" />
      <div className="shijing-mj-hero__main">
        <p className="shijing-mj-hero__eyebrow">{content.eyebrow}</p>
        <h1 className="shijing-mj-hero__title">{content.title}</h1>
        <p className="shijing-mj-hero__summary">
          <span>{content.dayMaster}</span>
          <span className="shijing-mj-hero__dot">·</span>
          <span>{content.patternTag}</span>
          <span className="shijing-mj-hero__dot">·</span>
          <span>{content.strengthTag}</span>
        </p>
        <p className="shijing-mj-hero__persona">{content.persona}</p>
      </div>
      <aside className="shijing-mj-hero__panel">
        <div className="shijing-mj-hero__favor">
          <p className="shijing-mj-hero__favor-title">{content.favorableTitle}</p>
          <div className="shijing-mj-hero__chips">
            {content.favorable.length > 0
              ? content.favorable.map((el) => <span key={el} className="shijing-mj-hero__chip" data-element={el}>{labels[el]}</span>)
              : <span className="shijing-mj-hero__chip-empty">—</span>}
          </div>
          <p className="shijing-mj-hero__favor-hint">{content.favorableHint}</p>
        </div>
        <div className="shijing-mj-hero__favor shijing-mj-hero__favor--adverse">
          <p className="shijing-mj-hero__favor-title">{content.adverseTitle}</p>
          <div className="shijing-mj-hero__chips">
            {content.adverse.length > 0
              ? content.adverse.map((el) => <span key={el} className="shijing-mj-hero__chip shijing-mj-hero__chip--muted" data-element={el}>{labels[el]}</span>)
              : <span className="shijing-mj-hero__chip-empty">—</span>}
          </div>
        </div>
        <div className="shijing-mj-hero__stage">
          <p className="shijing-mj-hero__stage-label">{content.currentStageLabel}</p>
          {content.current ? (
            <p className="shijing-mj-hero__stage-value">
              <span className="shijing-mj-hero__stage-pillar" data-element={content.current.stemElement}>{content.current.pillar}</span>
              <span className="shijing-mj-hero__stage-text">{content.dayunWord} · {content.current.ageRange}</span>
              <span className="shijing-mj-hero__stage-badge" data-nature={content.current.nature}>{tendency[content.current.nature]}</span>
            </p>
          ) : (
            <p className="shijing-mj-hero__stage-value shijing-mj-hero__stage-value--empty">{content.notStarted}</p>
          )}
          <button type="button" className="shijing-mj-hero__cta" onClick={onSeeStages}>{content.seeStages}</button>
        </div>
      </aside>
    </header>
  );
}

function ElementNames({ elements, labels }: { elements: ReadonlyArray<HeroDemoShijingElement>; labels: Record<HeroDemoShijingElement, string> }) {
  if (elements.length === 0) return <span className="shijing-paipan__empty">—</span>;
  return (
    <>
      {elements.map((el, index) => (
        <span key={el} data-element={el}>{index > 0 ? '、' : ''}{labels[el]}</span>
      ))}
    </>
  );
}

function BaziPaipan({ content }: { content: HeroDemoShijingBaziRoute['paipan'] }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const five = content.five;
  const max = Math.max(1, ...FIVE_ELEMENTS.map((el) => five.count[el]));
  return (
    <section className="shijing-mingjing-paipan" aria-label={content.sectionTitle}>
      <div className="shijing-paipan__head">
        <div>
          <h2 className="shijing-paipan__title">{content.sectionTitle}</h2>
          <p className="shijing-paipan__intro">{content.sectionIntro}</p>
        </div>
        <span className="shijing-paipan__structure-badge">{content.structureBadge}</span>
      </div>

      <div className="shijing-paipan__pillar-grid" aria-label={content.sectionTitle}>
        {content.columns.map((col) => (
          <article key={col.position} className="shijing-paipan__pillar-card" data-daymaster={col.isDay ? '' : undefined}>
            {col.isDay ? <span className="shijing-paipan__day-badge">{content.dayBadge}</span> : null}
            <p className="shijing-paipan__pillar-role">{content.pillarLabels[col.position]} · {content.roles[col.position]}</p>
            <p className="shijing-paipan__glyphs" aria-label={`${content.pillarLabels[col.position]} ${col.stemHanzi}${col.branchHanzi}`}>
              <span data-element={col.stemElement}>{col.stemHanzi}</span>
              <span data-element={col.branchElement}>{col.branchHanzi}</span>
            </p>
            <p className="shijing-paipan__ten-god">
              {col.isDay ? `${content.dayMaster} · ${content.roles.day}` : `${content.rows.tenGod} · ${col.tenGod}`}
            </p>
          </article>
        ))}
      </div>

      <div className="shijing-mingjing-five" aria-label={five.title}>
        <div className="shijing-mingjing-five__head shijing-mingjing-panel__title-row">
          <h3 className="shijing-mingjing-five__title">{five.title}</h3>
          <p className="shijing-mingjing-five__summary">{five.summary}</p>
          <MingJingInfo label={`${five.title}说明`}><p>{five.explanation}</p></MingJingInfo>
        </div>
        <div className="shijing-mingjing-five__bars">
          {FIVE_ELEMENTS.map((el) => (
            <div
              key={el}
              className="shijing-mingjing-five__bar"
              data-element={el}
              data-dominant={el === five.dominant ? '' : undefined}
              data-weakest={el === five.weakest ? '' : undefined}
            >
              <span className="shijing-mingjing-five__count">{five.count[el]}</span>
              <span className="shijing-mingjing-five__value" style={{ height: `${Math.round((five.count[el] / max) * 100)}%` }} />
              <span className="shijing-mingjing-five__label">{five.labels[el]}</span>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="shijing-paipan__toggle"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>{expanded ? content.collapse : content.expand}</span>
        <ChevronIcon className="shijing-paipan__toggle-icon" />
      </button>

      {expanded ? (
        <div id={detailId} className="shijing-paipan__detail">
          <p className="shijing-paipan__detail-title">{content.detailTitle}</p>
          <div className="shijing-paipan__table-wrap">
            <table className="shijing-paipan__table">
              <thead>
                <tr>
                  <th className="shijing-paipan__corner" scope="col"></th>
                  {content.columns.map((col) => (
                    <th key={col.position} scope="col" data-daymaster={col.isDay ? '' : undefined}>
                      {content.pillarLabels[col.position]}
                      {col.isDay ? <span>{content.dayMaster}</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th className="shijing-paipan__row-label" scope="row">{content.rows.hidden}</th>
                  {content.columns.map((col) => (
                    <td key={col.position}>
                      <span className="shijing-paipan__hidden-run">
                        {col.hidden.map((h, index) => (
                          <em key={`${h.hanzi}-${index}`} data-element={h.element} data-weight={h.weight}>{h.hanzi}</em>
                        ))}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th className="shijing-paipan__row-label" scope="row">{content.rows.nayin}</th>
                  {content.columns.map((col) => <td key={col.position}>{col.nayin}</td>)}
                </tr>
                <tr>
                  <th className="shijing-paipan__row-label" scope="row">{content.rows.terrain}</th>
                  {content.columns.map((col) => <td key={col.position}>{col.terrain}</td>)}
                </tr>
                <tr>
                  <th className="shijing-paipan__row-label" scope="row">{content.rows.voidRow}</th>
                  {content.columns.map((col) => <td key={col.position}>{col.isVoid ? content.voidMark : content.voidEmpty}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="shijing-paipan__summary" aria-label={content.geju.strengthLabel}>
            <span className="shijing-paipan__summary-chip">
              {content.geju.strengthLabel}: <strong>{content.strengthBand}</strong>
              <span>({content.geju.supportRatioLabel} {content.supportRatio})</span>
            </span>
            <span className="shijing-paipan__summary-chip">
              {content.geju.yong}: <ElementNames elements={content.yong} labels={five.labels} />
            </span>
            <span className="shijing-paipan__summary-chip shijing-paipan__summary-chip--muted">
              {content.geju.ji}: <ElementNames elements={content.ji} labels={five.labels} />
            </span>
            <span className="shijing-paipan__summary-chip">
              {content.geju.relationsLabel}: {content.relations.length > 0 ? content.relations.join(' / ') : content.geju.relationsEmpty}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function BaziDayun({ content, tendency }: { content: HeroDemoShijingBaziRoute['dayun']; tendency: Record<HeroDemoShijingTone, string> }) {
  const currentPeriod = content.currentIndex >= 0 ? content.periods[content.currentIndex] : undefined;
  const [expandedYear, setExpandedYear] = useState<number | null>(currentPeriod?.startYear ?? null);
  const distantStart = content.periods.findIndex((period) => period.startAge >= content.distantStartAge);
  const regular = distantStart >= 0 ? content.periods.slice(0, distantStart) : content.periods;
  const distant = distantStart >= 0 ? content.periods.slice(distantStart) : [];

  const renderRow = (period: HeroDemoShijingBaziRoute['dayun']['periods'][number]) => {
    const expanded = expandedYear === period.startYear;
    const contentId = `sjd-dayun-${period.startYear}`;
    return (
      <li
        key={period.startYear}
        className="shijing-dayun__row"
        data-nature={period.nature}
        data-favor={period.favor}
        data-current={period.isCurrent ? '' : undefined}
        data-inflection={period.isInflection ? '' : undefined}
        data-distant={period.startAge >= content.distantStartAge ? '' : undefined}
        data-expanded={expanded ? '' : undefined}
      >
        <button
          type="button"
          className="shijing-dayun__row-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpandedYear(expanded ? null : period.startYear)}
        >
          <span className="shijing-dayun__identity">
            <span className="shijing-dayun__pillar" data-element={period.stemElement}>{period.pillar}</span>
          </span>
          <span className="shijing-dayun__row-copy">
            <span className="shijing-dayun__row-title">
              <span className="shijing-dayun__stage-title">{period.phaseTitle}</span>
              <span className="shijing-dayun__technical">
                <span className="shijing-dayun__term-grid">
                  <span className="shijing-dayun__term"><small>{content.cols.age}</small>{period.startAge}–{period.endAge}岁</span>
                  <span className="shijing-dayun__term"><small>{content.cols.years}</small>{period.startYear}–{period.endYear}</span>
                  <span className="shijing-dayun__term"><small>{content.cols.tenGod}</small>{period.tenGod}</span>
                  <span className="shijing-dayun__term"><small>{content.cols.terrain}</small>{period.terrainLabel}</span>
                </span>
              </span>
            </span>
          </span>
          <span className="shijing-dayun__row-nature" data-favor={period.favor}>
            <span className="shijing-dayun__nature-dot" aria-hidden="true" />
            {tendency[period.nature]}
          </span>
          <span className="shijing-dayun__chevron" aria-hidden="true">{expanded ? '⌄' : '›'}</span>
        </button>
        <div id={contentId} className="shijing-dayun__explanation" hidden={!expanded}>
          <p>{period.explanation}</p>
        </div>
      </li>
    );
  };

  return (
    <section className="shijing-mingjing-panel shijing-mingjing-dayun" aria-label={content.sectionTitle}>
      <header className="shijing-mingjing-panel__head">
        <div className="shijing-mingjing-panel__title-row">
          <h2 className="shijing-mingjing-panel__title">{content.sectionTitle}</h2>
          <MingJingInfo label={`${content.sectionTitle}说明`}>
            <p>{content.explanation}</p>
            <p>{content.directionLabel} · {content.startAgeLabel}</p>
          </MingJingInfo>
        </div>
        <p className="shijing-mingjing-panel__intro shijing-dayun__intro">
          {content.introSegments.map((seg, index) =>
            seg.tone ? (
              <strong
                key={index}
                className="shijing-dayun__intro-mark"
                data-tone={seg.tone}
                data-nature={seg.tone === 'current' ? currentPeriod?.nature : undefined}
              >
                {seg.text}
              </strong>
            ) : (
              <span key={index}>{seg.text}</span>
            ),
          )}
        </p>
      </header>

      <ol className="shijing-dayun__timeline" aria-hidden="true">
        {content.periods.map((period, index) => {
          const isCurrent = index === content.currentIndex;
          const isHighlight = index === content.highlightIndex;
          return (
            <li
              key={period.startYear}
              className="shijing-dayun__seg"
              data-nature={period.nature}
              data-current={isCurrent ? '' : undefined}
              data-highlight={isHighlight ? '' : undefined}
            >
              {isCurrent ? <span className="shijing-dayun__seg-here">{content.currentLabel}</span> : null}
              <span className="shijing-dayun__seg-bar">
                <span className="shijing-dayun__seg-label">{isHighlight ? content.highlightLabel : tendency[period.nature]}</span>
              </span>
              <span className="shijing-dayun__seg-age">{period.startAge}–{period.endAge}</span>
            </li>
          );
        })}
      </ol>

      <div className="shijing-dayun__matrix-head" aria-hidden="true">
        <span>{content.cols.pillar}</span>
        <span>{content.cols.age} / {content.cols.years} / {content.cols.tenGod} / {content.cols.terrain}</span>
        <span>{content.cols.nature}</span>
        <span />
      </div>

      <ol className="shijing-dayun__list">
        {regular.map(renderRow)}
        {distant.length > 0 ? (
          <li className="shijing-dayun__distant-shell">
            <details className="shijing-dayun__distant-group">
              <summary className="shijing-dayun__distant-toggle">
                <span className="shijing-dayun__distant-copy">
                  <strong>{content.distantTitle}</strong>
                  <span>{content.distantDescription}</span>
                </span>
                <span className="shijing-dayun__distant-chevron" aria-hidden="true">›</span>
              </summary>
              <ol className="shijing-dayun__distant-list">{distant.map(renderRow)}</ol>
            </details>
          </li>
        ) : null}
      </ol>
    </section>
  );
}

function BaziLiunian({ content, tendency }: { content: HeroDemoShijingBaziRoute['liunian']; tendency: Record<HeroDemoShijingTone, string> }) {
  return (
    <section className="shijing-mingjing-panel shijing-mingjing-liunian" aria-label={content.title}>
      <header className="shijing-mingjing-panel__head">
        <div className="shijing-mingjing-panel__title-row">
          <h2 className="shijing-mingjing-panel__title">{content.title}</h2>
          <MingJingInfo label={`${content.title}说明`}>
            <p>{content.intro}</p>
            <p>{content.explanation}</p>
          </MingJingInfo>
        </div>
        <p className="shijing-mingjing-panel__intro">{content.horizonLabel}</p>
      </header>
      {content.windows.length > 0 ? (
        <ol className="shijing-liunian__list">
          {content.windows.map((window, index) => {
            const visibleBasis = window.basis.slice(0, 2);
            const hiddenBasis = Math.max(0, window.basis.length - visibleBasis.length);
            const visibleRelations = window.relations.slice(0, 2);
            const hiddenRelations = Math.max(0, window.relations.length - visibleRelations.length);
            return (
              <li key={`${window.range}-${index}`} className="shijing-liunian__card" data-nature={window.nature} data-favor={window.favor} data-salience={window.salience}>
                <header className="shijing-liunian__card-head">
                  <span className="shijing-liunian__range">{window.range}</span>
                  <span className="shijing-liunian__badge" data-nature={window.nature}>{window.badge}</span>
                  <span className="shijing-liunian__salience" data-salience={window.salience}>{content.salienceLabels[window.salience]}</span>
                </header>
                <p className="shijing-liunian__plain">{window.plain}</p>
                <div className="shijing-liunian__years-wrap">
                  <span className="shijing-liunian__label">{content.yearsLabel}</span>
                  <ul className="shijing-liunian__years">
                    {window.pillars.map((yp) => (
                      <li key={yp.year}>
                        <span className="shijing-liunian__year">{yp.year}</span>
                        <span className="shijing-liunian__ganzhi">{yp.ganzhi}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <details className="shijing-liunian__details">
                  <summary>{content.detailToggle}</summary>
                  <div className="shijing-liunian__evidence">
                    <div className="shijing-liunian__evidence-head">
                      <span>{content.evidenceLabel}</span>
                      <strong data-favor={window.favor}>{tendency[window.nature]} · {content.favorLabels[window.favor] ?? window.favor}</strong>
                    </div>
                    {window.dayunPillar ? <span className="shijing-liunian__dayun">{content.dayunLabel}: {window.dayunPillar}</span> : null}
                    {visibleRelations.length > 0 ? (
                      <ul className="shijing-liunian__relations">
                        {visibleRelations.map((rel, i) => <li key={i}>{rel}</li>)}
                        {hiddenRelations > 0 ? <li className="shijing-liunian__relations-more">{fill(content.relationMore, hiddenRelations)}</li> : null}
                      </ul>
                    ) : null}
                    {visibleBasis.length > 0 ? (
                      <ul className="shijing-liunian__basis">
                        {visibleBasis.map((b, i) => <li key={i}>{b}</li>)}
                        {hiddenBasis > 0 ? <li className="shijing-liunian__basis-more">{fill(content.basisMore, hiddenBasis)}</li> : null}
                      </ul>
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="shijing-liunian__empty" role="status">{content.empty}</p>
      )}
    </section>
  );
}

type EventItem = HeroDemoShijingBaziRoute['events']['items'][number];

function BaziEvents({
  content,
  tendency,
  events,
  onChange,
}: {
  content: HeroDemoShijingBaziRoute['events'];
  tendency: Record<HeroDemoShijingTone, string>;
  events: ReadonlyArray<EventItem>;
  onChange: (next: ReadonlyArray<EventItem>) => void;
}) {
  const [date, setDate] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState(false);
  const sorted = useMemo(() => [...events].sort((a, b) => a.date.localeCompare(b.date)), [events]);

  function handleAdd() {
    if (!date || body.trim().length === 0) {
      setError(true);
      return;
    }
    // The demo has no engine: new events land on the timeline without a resonance overlay.
    onChange([...events, { id: `evt-${Date.now()}`, date, body: body.trim(), resonance: null }]);
    setDate('');
    setBody('');
    setError(false);
  }

  return (
    <section className="shijing-mingjing-panel shijing-mingjing-events" aria-label={content.title}>
      <header className="shijing-mingjing-panel__head">
        <div className="shijing-mingjing-panel__title-row">
          <h2 className="shijing-mingjing-panel__title">{content.title}</h2>
          <MingJingInfo label={`${content.title}说明`}>
            <p>{content.intro}</p>
            <p>{content.explanation}</p>
          </MingJingInfo>
        </div>
      </header>

      <div className="shijing-mj-events__recorder">
        <label className="shijing-mj-events__field shijing-mj-events__field--date">
          <span className="shijing-mj-events__sr">{content.dateLabel}</span>
          <input type="date" className="shijing-mj-events__date-input" value={date} max="2100-12-31" placeholder={content.datePlaceholder} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="shijing-mj-events__field shijing-mj-events__field--grow">
          <span className="shijing-mj-events__sr">{content.bodyLabel}</span>
          <input type="text" value={body} placeholder={content.bodyPlaceholder} onChange={(e) => setBody(e.target.value)} />
        </label>
        <button type="button" className="shijing-mj-events__add" onClick={handleAdd}>{content.add}</button>
      </div>
      {error ? <p className="shijing-mj-events__error" role="alert">{content.invalidHint}</p> : null}

      {sorted.length === 0 ? (
        <p className="shijing-mj-events__empty">{content.empty}</p>
      ) : (
        <>
          <p className="shijing-mj-events__hint">{content.preGenHint}</p>
          <ul className="shijing-mj-events__list">
            {sorted.map((event) => {
              const r = event.resonance;
              return (
                <li key={event.id} className="shijing-mj-events__item" data-nature={r?.dayunNature}>
                  <time className="shijing-mj-events__date" dateTime={event.date}>{event.date}</time>
                  <div className="shijing-mj-events__main">
                    <p className="shijing-mj-events__body">{event.body}</p>
                    {r ? (
                      <div className="shijing-mj-events__resonance">
                        <span className="shijing-mj-events__chip" data-nature={r.dayunNature}>
                          <span className="shijing-mj-events__chip-label">{content.dayunColumn}</span>
                          <span className="shijing-mj-events__chip-value">{r.dayunPillar ?? '—'}{r.dayunTenGod ? `·${r.dayunTenGod}` : ''}</span>
                          <span className="shijing-mj-events__chip-nature">{tendency[r.dayunNature]}</span>
                        </span>
                        <span className="shijing-mj-events__chip" data-nature={r.liunianNature}>
                          <span className="shijing-mj-events__chip-label">{content.liunianColumn}</span>
                          <span className="shijing-mj-events__chip-value">{r.liunianPillar}</span>
                          <span className="shijing-mj-events__chip-nature">{tendency[r.liunianNature]}</span>
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <button type="button" className="shijing-mj-events__delete" aria-label={content.delete} onClick={() => onChange(events.filter((item) => item.id !== event.id))}>×</button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function BaziReading({ content, readingCopy }: { content: HeroDemoShijingBaziRoute['reading']; readingCopy: HeroDemoShijingMingjing['reading'] }) {
  const { busy, run } = useSimulatedGenerate();
  const output = content.output;
  return (
    <section className="shijing-mingjing-panel shijing-mingjing-reading" aria-label={content.coreTitle}>
      <header className="shijing-mingjing-panel__head shijing-mj-reading__head">
        <div>
          <p className="shijing-mingjing__eyebrow">{content.eyebrow}</p>
          <div className="shijing-mingjing-panel__title-row">
            <h2 className="shijing-mingjing-panel__title">{content.coreTitle}</h2>
            <MingJingInfo label={`${content.coreTitle}说明`}><p>{content.explanation}</p></MingJingInfo>
          </div>
        </div>
        <GeneratingButton className="shijing-mj-reading__generate" busy={busy} busyLabel={readingCopy.generating} onClick={run}>
          {readingCopy.regenerate}
        </GeneratingButton>
      </header>
      <p className="shijing-mj-reading__summary">{output.summary}</p>
      <dl className="shijing-mj-reading__core">
        {CORE_ORDER.map((key) => (
          <div key={key} className="shijing-mj-reading__core-item">
            <dt>{content.coreLabels[key]}</dt>
            <dd>{output.core[key]}</dd>
          </div>
        ))}
      </dl>
      <h3 className="shijing-mj-reading__subtitle">{content.strategiesTitle}</h3>
      <ol className="shijing-mj-reading__strategies">
        {output.strategies.map((s) => (
          <li key={s.pillar} className="shijing-mj-reading__strategy">
            <div className="shijing-mj-reading__phase">
              <span className="shijing-mj-reading__pillar">{s.pillar}</span>
              <span className="shijing-mj-reading__age">{s.ageRange}岁</span>
              <span className="shijing-mj-reading__theme">{s.theme}</span>
            </div>
            <p className="shijing-mj-reading__strategy-text">{s.strategy}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* 紫微斗数(三合派) route                                                    */
/* ------------------------------------------------------------------------ */

type ZiweiPalace = HeroDemoShijingZiweiRoute['palaces'][number];

function palaceKey(palace: ZiweiPalace): string {
  return `${palace.branch}:${palace.name}:${palace.index}`;
}

function ageRange(palace: ZiweiPalace): string {
  return `${palace.startAge}-${palace.endAge}`;
}

function StarChip({ star, major }: { star: HeroDemoShijingZiweiStar; major: boolean }) {
  return (
    <span className="shijing-ziwei-star" data-major={major ? '' : undefined} data-bright={star.brightness || undefined} data-mutagen={star.mutagen || undefined}>
      <span className="shijing-ziwei-star__name">{star.name}</span>
      {star.brightness ? <span className="shijing-ziwei-star__brightness">{star.brightness}</span> : null}
      {star.mutagen ? <span className="shijing-ziwei-star__hua">{star.mutagen}</span> : null}
    </span>
  );
}

function PalaceStars({ palace, emptyLabel }: { palace: ZiweiPalace; emptyLabel: string }) {
  const empty = palace.major.length === 0 && palace.minor.length === 0;
  return (
    <div className="shijing-ziwei-palace__stars">
      {palace.major.map((star) => <StarChip key={`major:${star.name}`} star={star} major />)}
      {palace.minor.map((star) => <StarChip key={`minor:${star.name}`} star={star} major={false} />)}
      {empty ? <span className="shijing-ziwei-palace__empty">{emptyLabel}</span> : null}
    </div>
  );
}

function ZiweiRoute({ content, readingCopy }: { content: HeroDemoShijingZiweiRoute; readingCopy: HeroDemoShijingMingjing['reading'] }) {
  const c = content.copy;
  const defaultPalace = content.palaces.find((p) => p.isSoul) ?? content.palaces[0];
  const [selectedKey, setSelectedKey] = useState(defaultPalace ? palaceKey(defaultPalace) : '');
  const selected = content.palaces.find((p) => palaceKey(p) === selectedKey) ?? defaultPalace;
  const { busy, run } = useSimulatedGenerate();
  const basisItems = [
    [c.basis.soulPalace, content.basis.soulPalace],
    [c.basis.bodyPalace, content.basis.bodyPalace],
    [c.basis.fiveElements, content.basis.fiveElementsClass],
    [c.basis.soulStar, content.basis.soulStar],
    [c.basis.bodyStar, content.basis.bodyStar],
    [c.basis.palaces, String(content.basis.palaceCount)],
  ] as const;

  return (
    <div className="shijing-mingjing__panels shijing-mingjing__panels--ziwei" data-mingjing-route="ziwei_sanhe_v1">
      <section className="shijing-ziwei-persona" aria-label={c.chartTitle}>
        <div className="shijing-ziwei-persona__mark" aria-hidden="true">{c.personaMark}</div>
        <div className="shijing-ziwei-persona__identity">
          <h3>{c.personaTitle}</h3>
          <p>{c.personaSubtitle}</p>
        </div>
        <dl className="shijing-ziwei-persona__facts">
          {basisItems.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="shijing-ziwei-workspace">
        <section className="shijing-mingjing-panel shijing-ziwei-chart" aria-label={c.astrolabeAria}>
          <header className="shijing-ziwei-chart__head">
            <div>
              <h2 className="shijing-mingjing-panel__title">{c.chartTitle}</h2>
              <p>{c.chartHint}</p>
            </div>
            <div className="shijing-ziwei-chart__legend" aria-label={c.sihuaLabel}>
              {HUA_LEGEND.map((hua) => <span key={hua} data-mutagen={hua}>{hua}</span>)}
            </div>
          </header>
          <div className="shijing-ziwei-grid" role="list" aria-label={c.chartTitle}>
            {content.palaces.map((palace) => {
              const key = palaceKey(palace);
              const isSelected = key === selectedKey;
              return (
                <button
                  key={key}
                  type="button"
                  className="shijing-ziwei-palace"
                  data-branch={palace.branch}
                  data-selected={isSelected ? '' : undefined}
                  data-soul={palace.isSoul ? '' : undefined}
                  data-body={palace.isBody ? '' : undefined}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedKey(key)}
                >
                  <span className="shijing-ziwei-palace__top">
                    <span className="shijing-ziwei-palace__name">
                      {palace.name}
                      {palace.isBody ? <span className="shijing-ziwei-palace__body-mark">{c.bodyRole}</span> : null}
                    </span>
                    <span className="shijing-ziwei-palace__age">{ageRange(palace)}</span>
                  </span>
                  <PalaceStars palace={palace} emptyLabel={c.emptyPalace} />
                  <span className="shijing-ziwei-palace__branch">{palace.stem}{palace.branch}</span>
                </button>
              );
            })}
            <div className="shijing-ziwei-center">
              <p>{c.centralEyebrow}</p>
              <h3>{c.chartTitle}</h3>
              <dl>
                <div><dt>{c.basis.fiveElements}</dt><dd>{content.basis.fiveElementsClass}</dd></div>
                <div><dt>{c.basis.soulStar}</dt><dd>{content.basis.soulStar}</dd></div>
                <div><dt>{c.basis.bodyStar}</dt><dd>{content.basis.bodyStar}</dd></div>
              </dl>
            </div>
          </div>
        </section>
        {selected ? <ZiweiPalaceDetail content={content} palace={selected} /> : null}
      </div>

      <section className="shijing-mingjing-panel shijing-mingjing-reading shijing-ziwei-brief" aria-label={c.briefAria}>
        <header className="shijing-mingjing-panel__head shijing-mj-reading__head">
          <div>
            <p className="shijing-mingjing__eyebrow">{c.briefEyebrow}</p>
            <h2 className="shijing-mingjing-panel__title">{c.briefTitle}</h2>
          </div>
          <GeneratingButton className="shijing-mj-reading__generate" busy={busy} busyLabel={readingCopy.generating} onClick={run}>
            {readingCopy.regenerate}
          </GeneratingButton>
        </header>
        <p className="shijing-mj-reading__summary shijing-ziwei-brief__summary">{content.reading.summary}</p>
        <dl className="shijing-mj-reading__core shijing-ziwei-brief__grid">
          {PROFILE_ORDER.map((key) => (
            <div key={key} className="shijing-mj-reading__core-item shijing-ziwei-brief__card">
              <span className="shijing-ziwei-brief__numeral" aria-hidden="true">{c.profileNumerals[key]}</span>
              <dt>{c.profileLabels[key]}</dt>
              <dd>{content.reading.profile[key]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function ZiweiPalaceDetail({ content, palace }: { content: HeroDemoShijingZiweiRoute; palace: ZiweiPalace }) {
  const c = content.copy;
  const domain = content.palaceDomains[palace.name] ?? content.defaultPalaceDomain;
  const guidance = content.reading.decadeGuidance.find((item) => item.ageRange === ageRange(palace) && item.palaceName === palace.name) ?? null;
  const roles = [palace.isSoul ? c.soulRole : null, palace.isBody ? c.bodyRole : null, c.selectedRole].filter((role): role is string => Boolean(role));
  const majorNames = palace.major.map((star) => star.name).join(' ') || c.emptyPalace;
  return (
    <aside className="shijing-mingjing-panel shijing-ziwei-detail" aria-label={c.palaceDetailEyebrow}>
      <header className="shijing-ziwei-detail__head">
        <p className="shijing-mingjing__eyebrow">{c.palaceDetailEyebrow}</p>
        <div className="shijing-ziwei-detail__roles">{roles.map((role) => <span key={role}>{role}</span>)}</div>
      </header>
      <div className="shijing-ziwei-detail__heading">
        <h2>
          {palace.name}
          <span className="shijing-ziwei-detail__age">{ageRange(palace)}</span>
        </h2>
        <p className="shijing-ziwei-detail__tagline">{domain.tagline}</p>
      </div>
      <div className="shijing-ziwei-detail__stars">
        <div className="shijing-ziwei-detail__star-col">
          <h3>{c.majorStars}</h3>
          <div className="shijing-ziwei-palace__stars">
            {palace.major.map((star) => <StarChip key={`major:${star.name}`} star={star} major />)}
            {palace.major.length === 0 ? <span className="shijing-ziwei-palace__empty">{c.emptyPalace}</span> : null}
          </div>
        </div>
        <div className="shijing-ziwei-detail__star-col">
          <h3>{c.minorStars} · {c.stemBranchLabel}</h3>
          <div className="shijing-ziwei-detail__minor">
            <div className="shijing-ziwei-palace__stars">
              {palace.minor.map((star) => <StarChip key={`minor:${star.name}`} star={star} major={false} />)}
              {palace.minor.length === 0 ? <span className="shijing-ziwei-detail__dash">—</span> : null}
            </div>
            <span className="shijing-ziwei-detail__branch">{palace.stem}{palace.branch}</span>
          </div>
        </div>
      </div>
      <section className="shijing-ziwei-detail__interpretation">
        <h3>{c.interpretationTitle}</h3>
        <p>{domain.scope}</p>
        <p>{domain.boundary}</p>
      </section>
      <section className="shijing-ziwei-detail__decade">
        <h3>{c.decadeTitle}</h3>
        <div className="shijing-ziwei-detail__decade-head">
          <span>{ageRange(palace)} · {palace.name}</span>
          <strong>{guidance?.theme ?? majorNames}</strong>
        </div>
        <p>{guidance?.strategy ?? c.decadeEmpty}</p>
      </section>
    </aside>
  );
}

/* ------------------------------------------------------------------------ */
/* 七政四余 / 果老星宗 route                                                 */
/* ------------------------------------------------------------------------ */

interface ActiveTerm { key: string; x: number; y: number }

interface GlossaryContextValue {
  has: (key: string) => boolean;
  show: (key: string, anchor: HTMLElement) => void;
  hide: () => void;
  pin: (key: string, anchor: HTMLElement) => void;
}

const GlossaryContext = createContext<GlossaryContextValue | null>(null);

// Port of qizheng-glossary.tsx. Coordinates are relative to the demo root
// (which contains layout), so the popover is positioned absolutely within it.
function QizhengGlossaryProvider({ gloss, children }: { gloss: Record<string, string>; children: ReactNode }) {
  const [active, setActive] = useState<ActiveTerm | null>(null);
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);
  pinnedRef.current = pinned;

  const has = useCallback((key: string) => Object.prototype.hasOwnProperty.call(gloss, key), [gloss]);
  const place = useCallback((key: string, anchor: HTMLElement): ActiveTerm => {
    const rect = anchor.getBoundingClientRect();
    const root = anchor.closest('.demo-shijing-root')?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return { key, x: rect.left + rect.width / 2 - root.left, y: rect.top - root.top };
  }, []);
  const show = useCallback((key: string, anchor: HTMLElement) => {
    if (pinnedRef.current || !has(key)) return;
    setActive(place(key, anchor));
  }, [has, place]);
  const hide = useCallback(() => {
    if (!pinnedRef.current) setActive(null);
  }, []);
  const pin = useCallback((key: string, anchor: HTMLElement) => {
    if (!has(key)) return;
    setActive((prev) => {
      if (pinnedRef.current && prev?.key === key) {
        setPinned(false);
        return null;
      }
      setPinned(true);
      return place(key, anchor);
    });
  }, [has, place]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!pinnedRef.current) return;
      const target = event.target as Element | null;
      if (!target?.closest('[data-gloss-term]') && !target?.closest('[data-gloss-pop]')) {
        setPinned(false);
        setActive(null);
      }
    };
    const onScroll = () => {
      if (!pinnedRef.current) setActive(null);
    };
    document.addEventListener('click', onDocClick, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('click', onDocClick, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  const value = useMemo<GlossaryContextValue>(() => ({ has, show, hide, pin }), [has, show, hide, pin]);
  const text = active ? gloss[active.key] : null;
  return (
    <GlossaryContext.Provider value={value}>
      {children}
      {active && text ? (
        <div data-gloss-pop className="shijing-qz-pop" style={{ left: `${active.x}px`, top: `${active.y - 10}px` }} role="tooltip">
          <div className="shijing-qz-pop__bubble">
            <div className="shijing-qz-pop__title">{active.key}</div>
            <div className="shijing-qz-pop__text">{text}</div>
          </div>
          <div className="shijing-qz-pop__arrow" />
        </div>
      ) : null}
    </GlossaryContext.Provider>
  );
}

function GlossTerm({ termKey, children, className }: { termKey: string; children?: ReactNode; className?: string }) {
  const ctx = useContext(GlossaryContext);
  const ref = useRef<HTMLButtonElement>(null);
  if (!ctx || !ctx.has(termKey)) return <span className={className}>{children ?? termKey}</span>;
  return (
    <button
      ref={ref}
      type="button"
      data-gloss-term
      className={`shijing-qz-term${className ? ` ${className}` : ''}`}
      aria-label={termKey}
      onMouseEnter={() => { if (ref.current) ctx.show(termKey, ref.current); }}
      onMouseLeave={() => ctx.hide()}
      onClick={(event) => {
        event.stopPropagation();
        if (ref.current) ctx.pin(termKey, ref.current);
      }}
    >
      {children ?? termKey}
    </button>
  );
}

const R = 168;
const RI = 96;
const MID_R = (R + RI) / 2;

function polar(r: number, angle: number): [number, number] {
  const a = (angle * Math.PI) / 180;
  return [180 + r * Math.sin(a), 180 - r * Math.cos(a)];
}

function segmentPath(index: number): string {
  const mid = index * 30;
  const [x1, y1] = polar(R, mid - 15);
  const [x2, y2] = polar(R, mid + 15);
  const [x3, y3] = polar(RI, mid + 15);
  const [x4, y4] = polar(RI, mid - 15);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L${x3.toFixed(1)} ${y3.toFixed(1)} A${RI} ${RI} 0 0 0 ${x4.toFixed(1)} ${y4.toFixed(1)} Z`;
}

function QizhengRoute({ content, readingCopy }: { content: HeroDemoShijingQizhengRoute; readingCopy: HeroDemoShijingMingjing['reading'] }) {
  const x = content.copy;
  const defaultIndex = useMemo(() => {
    let best = content.palaces[0];
    for (const palace of content.palaces) {
      if (palace.occupants.length > (best?.occupants.length ?? -1)) best = palace;
    }
    return best?.index ?? 0;
  }, [content.palaces]);
  const [view, setView] = useState<'plain' | 'data'>('plain');
  const [selectedIndex, setSelectedIndex] = useState(defaultIndex);
  const chartRef = useRef<HTMLDivElement>(null);
  const { busy, run } = useSimulatedGenerate();
  const aiByKey = useMemo(() => {
    const map: Record<string, { theme: string; strategy: string }> = {};
    for (const item of content.reading.starGuidance) map[item.bodyKey] = { theme: item.theme, strategy: item.strategy };
    return map;
  }, [content.reading.starGuidance]);

  const goPalace = (houseName: string) => {
    const target = content.palaces.find((p) => p.name === houseName);
    if (target) setSelectedIndex(target.index);
    chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <QizhengGlossaryProvider gloss={content.gloss}>
      <div className="shijing-mingjing__panels shijing-qz" data-mingjing-route="qizheng_siyu_guolao_v1">
        <QizhengHero content={content} />

        <div className="shijing-qz-view-toggle">
          <p className="shijing-qz-view-toggle__intro">{x.viewIntro}</p>
          <div className="shijing-qz-toggle" role="tablist" aria-label={x.viewToggleAria}>
            <button type="button" role="tab" aria-selected={view === 'plain'} className="shijing-qz-toggle__btn" data-active={view === 'plain' ? '' : undefined} onClick={() => setView('plain')}>{x.viewPlain}</button>
            <button type="button" role="tab" aria-selected={view === 'data'} className="shijing-qz-toggle__btn" data-active={view === 'data' ? '' : undefined} onClick={() => setView('data')}>{x.viewData}</button>
          </div>
        </div>

        {view === 'plain' ? (
          <div className="shijing-qz-plain">
            <section className="shijing-mingjing-panel shijing-qz-explainer" aria-label={x.explainerTitle}>
              <div className="shijing-qz-explainer__head">
                <InfoIcon className="shijing-qz-explainer__icon" />
                <h3 className="shijing-qz-explainer__title">{x.explainerTitle}</h3>
              </div>
              <p className="shijing-qz-explainer__body">{x.explainerBody}</p>
              <div className="shijing-qz-explainer__cards">
                <div className="shijing-qz-explainer__card">
                  <div className="shijing-qz-explainer__card-title"><GlossTerm termKey="七政">{x.terms.qizheng}</GlossTerm> · {x.qizhengCardTitle}</div>
                  <div className="shijing-qz-explainer__card-body">{x.qizhengCardBody}</div>
                </div>
                <div className="shijing-qz-explainer__card">
                  <div className="shijing-qz-explainer__card-title"><GlossTerm termKey="四余">{x.terms.siyu}</GlossTerm> · {x.siyuCardTitle}</div>
                  <div className="shijing-qz-explainer__card-body">{x.siyuCardBody}</div>
                </div>
              </div>
              <p className="shijing-qz-explainer__hint">{x.explainerHint}</p>
            </section>
            <div ref={chartRef} className="shijing-mingjing__anchor">
              <QizhengChart content={content} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
            </div>
            <QizhengStars content={content} aiByKey={aiByKey} onGoPalace={goPalace} />
            <QizhengPatterns content={content} />
          </div>
        ) : (
          <QizhengDataView content={content} />
        )}

        <div className="shijing-qz-reading" aria-label={x.readingAria}>
          <section className="shijing-qz-cta">
            <div className="shijing-qz-cta__copy">
              <p className="shijing-qz-cta__eyebrow">{x.ctaEyebrow}</p>
              <h3 className="shijing-qz-cta__title">{x.ctaTitle}</h3>
              <p className="shijing-qz-cta__body">{x.ctaBody}</p>
            </div>
            <GeneratingButton className="shijing-qz-cta__button" busy={busy} busyLabel={readingCopy.generating} onClick={run}>
              {readingCopy.regenerate}
            </GeneratingButton>
          </section>
          <section className="shijing-mingjing-panel shijing-qz-result">
            <div className="shijing-qz-result__head">
              <SparkleIcon className="shijing-qz-result__icon" />
              <h3 className="shijing-qz-result__title">{content.hero.title} · {x.readingTitleSuffix}</h3>
            </div>
            <p className="shijing-qz-result__summary">{content.reading.summary}</p>
            <dl className="shijing-qz-result__profile">
              {PROFILE_ORDER.map((key) => (
                <div key={key} className="shijing-qz-result__profile-item">
                  <dt>{x.profileLabels[key]}</dt>
                  <dd>{content.reading.profile[key]}</dd>
                </div>
              ))}
            </dl>
            <h4 className="shijing-qz-result__subtitle">{x.starGuidanceTitle}</h4>
            <ol className="shijing-qz-result__guidance">
              {content.reading.starGuidance.map((item) => (
                <li key={item.bodyKey} className="shijing-qz-result__guide">
                  <div className="shijing-qz-result__guide-head">
                    <span className="shijing-qz-result__guide-star">{item.bodyLabel}</span>
                    <span className="shijing-qz-result__guide-where">{item.houseName} · {item.mansion}</span>
                    <span className="shijing-qz-result__guide-theme">{item.theme}</span>
                  </div>
                  <p className="shijing-qz-result__guide-text">{item.strategy}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </QizhengGlossaryProvider>
  );
}

function QizhengHero({ content }: { content: HeroDemoShijingQizhengRoute }) {
  const x = content.copy;
  const hero = content.hero;
  const tailChips = hero.subtitleChips.slice(1);
  return (
    <section className="shijing-qz-hero" aria-label={x.heroEyebrow}>
      <div className="shijing-qz-hero__grid">
        <div className="shijing-qz-hero__main">
          <p className="shijing-qz-hero__eyebrow">{x.heroEyebrow}</p>
          <h2 className="shijing-qz-hero__title">{hero.title}</h2>
          <div className="shijing-qz-hero__subtitle">
            <span>
              <GlossTerm termKey="命主" className="shijing-qz-term--light">{x.terms.mingZhu}</GlossTerm>
              {hero.mingZhuLabel}
            </span>
            {tailChips.map((chip) => (
              <span key={chip}><span className="shijing-qz-hero__sep">·</span>{chip}</span>
            ))}
          </div>
          <p className="shijing-qz-hero__lead">{hero.oneLiner}</p>
          <p className="shijing-qz-hero__body">{hero.paragraph}</p>
        </div>
        <div className="shijing-qz-hero__side">
          <div className="shijing-qz-hero__group">
            <p className="shijing-qz-hero__group-title">{x.favorableTitle}</p>
            <div className="shijing-qz-hero__chips">
              {hero.favorable.map((label, index) => (
                <span key={label} className="shijing-qz-hero__chip" data-primary={index === 0 ? '' : undefined}>{label}</span>
              ))}
            </div>
          </div>
          {hero.watch.length > 0 ? (
            <div className="shijing-qz-hero__group">
              <p className="shijing-qz-hero__group-title">{x.watchTitle}</p>
              <div className="shijing-qz-hero__chips">
                {hero.watch.map((label) => <span key={label} className="shijing-qz-hero__chip shijing-qz-hero__chip--watch">{label}</span>)}
              </div>
            </div>
          ) : null}
          <div className="shijing-qz-hero__basis">
            <p className="shijing-qz-hero__group-title">{x.basisTitle}</p>
            <p className="shijing-qz-hero__basis-value">{hero.basisLabel}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function QizhengChart({ content, selectedIndex, onSelect }: { content: HeroDemoShijingQizhengRoute; selectedIndex: number; onSelect: (index: number) => void }) {
  const x = content.copy;
  const palaces = content.palaces;
  const selected = palaces.find((p) => p.index === selectedIndex) ?? palaces[0];
  const mingColor = palaces.flatMap((p) => p.occupants).find((occ) => occ.isMing)?.color ?? '#5a8ec0';
  return (
    <section className="shijing-mingjing-panel shijing-qz-chart" aria-label={x.chartTitle}>
      <div className="shijing-qz-section-head">
        <h3 className="shijing-qz-section-title">{x.chartTitle}</h3>
        <span className="shijing-qz-section-hint">{x.chartHint}</span>
      </div>
      <div className="shijing-qz-chart__layout">
        <div className="shijing-qz-wheel">
          <svg viewBox="0 0 360 360" className="shijing-qz-wheel__svg" role="img" aria-label={x.chartTitle}>
            {palaces.map((palace) => {
              const isSel = palace.index === selectedIndex;
              const occupied = palace.occupants.length > 0;
              const style: CSSProperties = {
                fill: isSel ? 'rgba(78,204,163,0.18)' : occupied ? 'rgba(255,255,255,0.5)' : 'rgba(248,250,252,0.4)',
                stroke: isSel ? 'var(--mingjing-accent)' : 'var(--mingjing-card-border)',
                strokeWidth: isSel ? 1.6 : 1,
                cursor: 'pointer',
                transition: 'fill 160ms, stroke 160ms',
              };
              return <path key={palace.name} d={segmentPath(palace.index)} style={style} onClick={() => onSelect(palace.index)} />;
            })}
            {palaces.map((palace) => {
              const isSel = palace.index === selectedIndex;
              const occupied = palace.occupants.length > 0;
              const [lx, ly] = polar(MID_R + 22, palace.index * 30);
              const labelStyle: CSSProperties = {
                fill: isSel ? '#1f8a5b' : occupied ? 'var(--mingjing-ink-strong)' : 'var(--mingjing-ink-faint)',
                fontSize: '13px',
                fontWeight: isSel || occupied ? 700 : 500,
                textAnchor: 'middle',
                dominantBaseline: 'middle',
                pointerEvents: 'none',
              };
              return (
                <g key={palace.name}>
                  <text x={lx.toFixed(1)} y={ly.toFixed(1)} style={labelStyle}>{palace.name}</text>
                  {palace.occupants.map((occ, k) => {
                    const n = palace.occupants.length;
                    const da = (k - (n - 1) / 2) * 13;
                    const [cx, cy] = polar(MID_R - 14, palace.index * 30 + da);
                    return <circle key={occ.key} cx={cx.toFixed(1)} cy={cy.toFixed(1)} r={3.6} style={{ fill: occ.color }} />;
                  })}
                </g>
              );
            })}
          </svg>
          <div className="shijing-qz-wheel__center" style={{ '--qz-ming-color': mingColor } as CSSProperties}>
            <div className="shijing-qz-wheel__center-eyebrow">{x.wheelCenterEyebrow}</div>
            <div className="shijing-qz-wheel__center-star">{content.hero.mingZhuLabel}</div>
            <div className="shijing-qz-wheel__center-basis">{content.hero.basisLabel}</div>
          </div>
        </div>
        {selected ? (
          <div className="shijing-qz-detail">
            <div className="shijing-qz-detail__head">
              <span className="shijing-qz-detail__name">{selected.name}</span>
              <span className="shijing-qz-detail__count">{selected.countLabel}</span>
              <span className="shijing-qz-detail__range">{selected.range}</span>
            </div>
            <p className="shijing-qz-detail__domain">{selected.domain}</p>
            {selected.occupants.map((star) => <QizhengOccupantRow key={star.key} star={star} mingLabel={x.terms.mingZhu} />)}
            {selected.isEmpty ? (
              <div className="shijing-qz-detail__empty">
                <div className="shijing-qz-detail__empty-title"><GlossTerm termKey="空宫">{x.terms.emptyHouse}</GlossTerm> · {x.emptyDetail}</div>
                {selected.ruler ? <div className="shijing-qz-detail__ruler">{selected.ruler}</div> : null}
              </div>
            ) : null}
            <div className="shijing-qz-detail__deep">
              <div className="shijing-qz-deep-label">{x.deepTitle}</div>
              <p className="shijing-qz-deep-text">{selected.deep}</p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function QizhengOccupantRow({ star, mingLabel }: { star: HeroDemoShijingQizhengStar; mingLabel: string }) {
  return (
    <div className="shijing-qz-occ">
      <span className="shijing-qz-glyph shijing-qz-glyph--sm" style={{ background: star.bg, color: star.color }}>{star.label}</span>
      <div className="shijing-qz-occ__body">
        <div className="shijing-qz-occ__head">
          <b>{star.label}</b>
          <span className="shijing-qz-occ__planet">{star.planet}</span>
          {star.isMing ? <span className="shijing-qz-tag shijing-qz-tag--ming">{mingLabel}</span> : null}
          <span className="shijing-qz-tag" data-strength={star.strength}>{star.strengthLabel}</span>
        </div>
        <div className="shijing-qz-occ__meaning">{star.essence}</div>
      </div>
    </div>
  );
}

function QizhengStars({
  content,
  aiByKey,
  onGoPalace,
}: {
  content: HeroDemoShijingQizhengRoute;
  aiByKey: Record<string, { theme: string; strategy: string }>;
  onGoPalace: (houseName: string) => void;
}) {
  const x = content.copy;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <section className="shijing-qz-stars" aria-label={x.starsTitle}>
      <div className="shijing-qz-section-head shijing-qz-section-head--loose">
        <h3 className="shijing-qz-section-title">{x.starsTitle}</h3>
        <span className="shijing-qz-section-hint">{x.starsHint}</span>
      </div>
      <div className="shijing-qz-stars__grid">
        {content.stars.map((star) => {
          const expanded = !!open[star.key];
          const ai = aiByKey[star.key];
          const glyphChars = Array.from(star.label);
          const glyphHead = glyphChars[0] ?? '';
          const glyphTail = glyphChars.slice(1).join('');
          return (
            <article key={star.key} className="shijing-qz-star" data-expanded={expanded ? '' : undefined}>
              <button type="button" className="shijing-qz-star__head" aria-expanded={expanded} onClick={() => setOpen((prev) => ({ ...prev, [star.key]: !prev[star.key] }))}>
                <span className="shijing-qz-glyph" style={{ color: star.color }}>
                  <span className="shijing-qz-glyph__swatch" style={{ background: star.bg }}>{glyphHead}</span>
                  {glyphTail ? <span className="shijing-qz-glyph__tail">{glyphTail}</span> : null}
                </span>
                <span className="shijing-qz-star__body">
                  <span className="shijing-qz-star__title">
                    <b>{star.label}</b>
                    <span className="shijing-qz-star__planet">{star.planet}</span>
                  </span>
                  <span className="shijing-qz-star__meaning">{star.essence}</span>
                  <span className="shijing-qz-star__chips">
                    <span
                      className="shijing-qz-chip shijing-qz-chip--go"
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        onGoPalace(star.houseName);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.stopPropagation();
                          event.preventDefault();
                          onGoPalace(star.houseName);
                        }
                      }}
                    >
                      {x.starGoPalace} {star.houseName} ↗
                    </span>
                    <span className="shijing-qz-chip" data-strength={star.strength}>{star.strengthLabel}</span>
                    <span className="shijing-qz-chip shijing-qz-chip--mono">{star.degree}</span>
                  </span>
                </span>
                <ChevronIcon className="shijing-qz-star__chevron" />
              </button>
              {expanded ? (
                <div className="shijing-qz-star__detail">
                  <div className="shijing-qz-star__deep">
                    <p>{star.deep}</p>
                    {ai && ai.strategy ? (
                      <div className="shijing-qz-star__ai">
                        <div className="shijing-qz-deep-label">{x.starGuidanceTitle}</div>
                        {ai.theme ? <p className="shijing-qz-star__ai-theme">{ai.theme}</p> : null}
                        <p>{ai.strategy}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function QizhengPatterns({ content }: { content: HeroDemoShijingQizhengRoute }) {
  const x = content.copy;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (content.patterns.length === 0) return null;
  return (
    <section className="shijing-qz-patterns" aria-label={x.patternsTitle}>
      <div className="shijing-qz-section-head shijing-qz-section-head--loose">
        <h3 className="shijing-qz-section-title">{x.patternsTitle}</h3>
        <span className="shijing-qz-section-hint">{x.patternsHint}</span>
      </div>
      <div className="shijing-qz-patterns__list">
        {content.patterns.map((pattern) => {
          const expanded = !!open[pattern.id];
          return (
            <article key={pattern.id} className="shijing-qz-pattern" data-expanded={expanded ? '' : undefined}>
              <button type="button" className="shijing-qz-pattern__head" aria-expanded={expanded} onClick={() => setOpen((prev) => ({ ...prev, [pattern.id]: !prev[pattern.id] }))}>
                <span className="shijing-qz-pattern__tag" data-tone={pattern.tone}>{pattern.tag}</span>
                <span className="shijing-qz-pattern__body">
                  <span className="shijing-qz-pattern__title">{pattern.title}</span>
                  <span className="shijing-qz-pattern__summary">{pattern.summary}</span>
                </span>
                <span className="shijing-qz-pattern__glyphs">
                  {pattern.glyphs.map((glyph, index) => (
                    <span key={`${glyph.name}-${index}`} className="shijing-qz-pattern__glyph" style={{ background: glyph.color }}>{glyph.name}</span>
                  ))}
                </span>
                <ChevronIcon className="shijing-qz-pattern__chevron" />
              </button>
              {expanded ? <div className="shijing-qz-pattern__detail"><p>{pattern.deep}</p></div> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function QizhengDataView({ content }: { content: HeroDemoShijingQizhengRoute }) {
  const x = content.copy;
  return (
    <div className="shijing-qz-data">
      <section className="shijing-mingjing-panel" aria-label={x.chartAria}>
        <div className="shijing-qz-section-head">
          <h3 className="shijing-qz-section-title">{x.basisSectionTitle}</h3>
          <span className="shijing-qz-section-hint">{x.basisSectionHint}</span>
        </div>
        <div className="shijing-qz-basis">
          {content.basisRows.map((row) => (
            <div key={row.term} className="shijing-qz-basis__item">
              <div className="shijing-qz-basis__k"><GlossTerm termKey={row.term}>{row.label}</GlossTerm></div>
              <div className="shijing-qz-basis__v">{row.value}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="shijing-mingjing-panel" aria-label={x.bodiesTitle}>
        <h3 className="shijing-qz-section-title shijing-qz-section-title--solo">{x.bodiesTitle}</h3>
        <div className="shijing-qz-luogong">
          <div className="shijing-qz-luogong__head">
            <span>{x.bodyColumns.body}</span>
            <span>{x.bodyColumns.house}</span>
            <span><GlossTerm termKey="宿">{x.bodyColumns.mansion}</GlossTerm></span>
            <span><GlossTerm termKey="宫势">{x.bodyColumns.position}</GlossTerm></span>
            <span><GlossTerm termKey="黄道度">{x.bodyColumns.longitude}</GlossTerm></span>
          </div>
          {content.stars.map((star) => (
            <div key={star.key} className="shijing-qz-luogong__row">
              <span className="shijing-qz-luogong__name">
                <span className="shijing-qz-luogong__dot" style={{ background: star.color }} />
                <b>{star.label}</b>
              </span>
              <span>{star.houseName}</span>
              <span className="shijing-qz-luogong__mono">{star.mansion}</span>
              <span><span className="shijing-qz-chip" data-strength={star.strength}>{star.strengthLabel}</span></span>
              <span className="shijing-qz-luogong__mono">{star.degree}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="shijing-mingjing-panel" aria-label={x.housesTitle}>
        <h3 className="shijing-qz-section-title shijing-qz-section-title--solo">{x.housesTitle}</h3>
        <div className="shijing-qz-palace-list">
          {content.houses.map((house) => (
            <div key={house.name} className="shijing-qz-palace-row">
              <b className="shijing-qz-palace-row__name">{house.name}</b>
              <span className="shijing-qz-palace-row__range">{house.range}</span>
              <span className="shijing-qz-palace-row__occ" data-empty={house.occupants ? undefined : ''}>{house.occupants || x.emptyHouse}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Route shell                                                              */
/* ------------------------------------------------------------------------ */

export function DemoShijingMingJing({
  content,
  methodProfile,
}: {
  content: HeroDemoShijingMingjing;
  methodProfile: HeroDemoShijingMethodId;
}) {
  return (
    <section className="shijing-tab shijing-mingjing" data-mirror-kind="mingjing" aria-label={content.title}>
      <header className="shijing-mirror-header">
        <div className="shijing-mirror-header__titles">
          <h1>{content.title}</h1>
        </div>
      </header>
      {methodProfile === 'bazi_ziping_v1' ? (
        <BaziRoute key="bazi" content={content.bazi} tendency={content.tendencyLabels} readingCopy={content.reading} />
      ) : methodProfile === 'ziwei_sanhe_v1' ? (
        <ZiweiRoute key="ziwei" content={content.ziwei} readingCopy={content.reading} />
      ) : (
        <QizhengRoute key="qizheng" content={content.qizheng} readingCopy={content.reading} />
      )}
    </section>
  );
}
