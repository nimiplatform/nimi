import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BookOpen,
  Briefcase,
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheck,
  ClipboardList,
  Coins,
  Compass,
  Eye,
  Flag,
  Heart,
  HeartPulse,
  House,
  Leaf,
  MessageCircle,
  MessageSquare,
  Pause,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import type {
  HeroDemoShijingMethodId,
  HeroDemoShijingPreview,
  HeroDemoShijingTabId,
  HeroDemoShijingTone,
} from '../content/landing-content.js';
import { DemoShijingAsk } from './demo-shijing-ask.js';
import { DemoShijingMingJing } from './demo-shijing-mingjing.js';

/**
 * Interactive replica of the ShiJing (时镜) six-mirror shell
 * (nimiapp-shijing src/product/shell + tabs). The integrated top bar, the
 * primary tab bar, and the 日镜 / 月镜 / 命镜 tabs mount the app's own class
 * names on the ported stylesheet (demo-shijing.css); the other mirrors are
 * landing-owned approximations of the app's redesign previews. 命镜 is
 * method-routed by the top bar's 推演方法 select exactly like the app. Readings
 * are mock data from the landing content and no Runtime AI runs; the 命镜 chart
 * data was generated once by the app's deterministic engines.
 */

const GENERATE_MS = 1_600;

function concernIcon(name: string) {
  if (/事业|工作|合作/u.test(name)) return <Briefcase size={20} aria-hidden="true" />;
  if (/关系|伴侣|家人/u.test(name)) return <Users size={20} aria-hidden="true" />;
  if (/身心|健康|精力/u.test(name)) return <HeartPulse size={20} aria-hidden="true" />;
  return <Compass size={20} aria-hidden="true" />;
}

function rijingDateLabel(now: Date): { date: string; weekday: string } {
  return {
    date: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(now),
    weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now),
  };
}

function GeneratingButton({
  busy,
  busyLabel,
  className,
  children,
  onClick,
  ariaLabel,
}: {
  busy: boolean;
  busyLabel: string;
  className?: string;
  children: ReactNode;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={`shijing-generating-button${className ? ` ${className}` : ''}`}
      data-busy={busy ? 'true' : undefined}
      aria-busy={busy}
      aria-label={ariaLabel}
      disabled={busy}
      onClick={onClick}
    >
      {busy ? <span className="shijing-generating-button__spinner" aria-hidden="true" /> : null}
      <span className="shijing-generating-button__label">{busy ? busyLabel : children}</span>
    </button>
  );
}

/* ------------------------------------------------------------------------ */
/* 日镜                                                                     */
/* ------------------------------------------------------------------------ */

function RiJingTab({ content }: { content: HeroDemoShijingPreview['rijing'] }) {
  const [generating, setGenerating] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [riteOpen, setRiteOpen] = useState(false);
  const [lens, setLens] = useState<string>('__all__');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState('');
  const [references, setReferences] = useState<readonly string[]>(content.eventInput.references);
  const [savedHint, setSavedHint] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const dateLabel = useMemo(() => rijingDateLabel(new Date()), []);
  const hero = content.hero;
  const meter = hero.meter;
  const visibleRows = lens === '__all__'
    ? content.projections.rows
    : content.projections.rows.filter((row) => row.id === lens);

  const generate = () => {
    if (generating) return;
    setGenerating(true);
    setRefreshed(false);
    timerRef.current = setTimeout(() => {
      setGenerating(false);
      setRefreshed(true);
    }, GENERATE_MS);
  };

  const addReference = () => {
    const body = draft.trim();
    if (!body) return;
    setReferences((current) => [body, ...current]);
    setDraft('');
    setSavedHint(true);
  };

  return (
    <section className="shijing-tab shijing-rijing" data-mirror-kind="rijing" aria-label={content.title}>
      <header className="shijing-mirror-header">
        <div className="shijing-mirror-header__titles">
          <h1 id="shijing-rijing-heading">{content.title}</h1>
          <div className="shijing-mirror-header__meta" aria-hidden="true">
            <span className="shijing-rijing__date-main">{dateLabel.date}</span>
            <span className="shijing-rijing__date-sep">·</span>
            <span>{dateLabel.weekday}</span>
          </div>
        </div>
        <div className="shijing-mirror-header__actions">
          <div className="shijing-mirror-header__buttons">
            <button type="button" className="shijing-import-to-consultation">{content.importLabel}</button>
            <GeneratingButton
              className="shijing-rijing__generate"
              busy={generating}
              busyLabel={content.refreshingLabel}
              onClick={generate}
              ariaLabel={content.refreshLabel}
            >
              {content.refreshLabel}
            </GeneratingButton>
          </div>
        </div>
      </header>

      {generating ? <p role="status">{content.refreshingLabel}</p> : null}
      {refreshed && !generating ? <p className="shijing-rijing__refreshed" role="status">{content.refreshedHint}</p> : null}

      <article
        className="shijing-rijing__hero"
        aria-labelledby="shijing-rijing__hero-headline"
        data-rite-open={riteOpen}
      >
        <button
          type="button"
          className="shijing-rijing__hero-flip"
          aria-pressed={riteOpen}
          aria-label={riteOpen ? hero.flipToOverview : hero.flipToRite}
          onClick={() => setRiteOpen((open) => !open)}
        >
          <span className="shijing-rijing__hero-flip-text">{riteOpen ? hero.flipToOverview : hero.flipToRite}</span>
          <span className="shijing-rijing__hero-flip-icon" aria-hidden="true"><CalendarDays size={14} /></span>
        </button>

        <div className="shijing-rijing__hero-stage">
          <div className="shijing-rijing__hero-face shijing-rijing__hero-face--front" aria-hidden={riteOpen}>
            <div className="shijing-rijing__hero-eyebrow" aria-hidden="true">
              <span className="shijing-rijing__hero-eyebrow-dash" />
              <span>{hero.eyebrow}</span>
              <span className="shijing-rijing__hero-eyebrow-dash" />
            </div>
            <h3 id="shijing-rijing__hero-headline" className="shijing-rijing__hero-headline">{hero.headline}</h3>
            <div className="shijing-rijing__hero-subtitle-row">
              <p className="shijing-rijing__hero-subtitle">{hero.subtitle}</p>
              <div className="shijing-rijing__hero-leanings" aria-label="今日倾向">
                {hero.leanings.map((leaning) => (
                  <span key={leaning.label} className="shijing-rijing__hero-pill" data-tone={leaning.tone}>
                    <span className="shijing-rijing__hero-pill-dot" aria-hidden="true" />
                    {leaning.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="shijing-rijing__meter" aria-label="旺衰与阶段能量条">
              <div className="shijing-rijing__meter-track">
                <span className="shijing-rijing__meter-dot" style={{ left: `${meter.percent}%` }} aria-hidden="true" />
              </div>
              <div className="shijing-rijing__meter-axis" aria-hidden="true">
                <span>{hero.meterAxisStart}</span>
                <span>{hero.meterAxisEnd}</span>
              </div>
              <div className="shijing-rijing__meter-caption">
                {hero.meterStrengthLabel} <b>{meter.band}</b> {hero.meterStageConnector}{' '}
                <b>{meter.stage}</b> {hero.meterStageSuffix}{meter.guidance}
              </div>
            </div>
            <p className="shijing-rijing__hero-confidence">
              {hero.confidencePrefix}{' '}
              <b className="shijing-rijing__hero-confidence-value">{hero.confidenceLabel}</b>{' '}
              · {hero.confidenceNote}
            </p>
            <div className="shijing-rijing__hero-full">
              <section className="shijing-rijing__hero-block" aria-label={hero.eventTitle}>
                <h4 className="shijing-rijing__hero-block-title shijing-rijing__hero-block-title--muted">{hero.eventTitle}</h4>
                <p className="shijing-rijing__hero-block-body">{hero.eventBody}</p>
                <p className="shijing-rijing__hero-block-body">{hero.eventGuidance}</p>
                <p className="shijing-rijing__hero-block-body shijing-rijing__hero-block-body--soft">{hero.eventAction}</p>
              </section>
            </div>
            <div className="shijing-rijing__hero-divider" aria-hidden="true" />
            <div className="shijing-rijing__hero-wish">
              <span className="shijing-rijing__hero-wish-icon" aria-hidden="true"><Heart size={18} /></span>
              <div className="shijing-rijing__hero-wish-copy">
                <span className="shijing-rijing__hero-wish-label">{hero.closingLabel}</span>
                <p>{hero.closingWish}</p>
              </div>
            </div>
          </div>

          <section
            className="shijing-rijing__hero-face shijing-rijing__hero-face--back"
            aria-label={hero.rite.eyebrow}
            aria-hidden={!riteOpen}
          >
            <div className="shijing-rijing__hero-eyebrow" aria-hidden="true">
              <span className="shijing-rijing__hero-eyebrow-dash" />
              <span>{hero.rite.eyebrow}</span>
              <span className="shijing-rijing__hero-eyebrow-dash" />
            </div>
            <h3 className="shijing-rijing__rite-title">{hero.rite.lunarTitle}</h3>
            <p className="shijing-rijing__rite-summary">{hero.rite.ganzhiLine}</p>
            <div className="shijing-rijing__almanac-recommends">
              <div className="shijing-rijing__almanac-line" data-kind="recommend">
                <span>{hero.rite.suitableTitle}</span>
                <p>{hero.rite.suitable.join(' ')}</p>
              </div>
              <div className="shijing-rijing__almanac-line" data-kind="avoid">
                <span>{hero.rite.unsuitableTitle}</span>
                <p>{hero.rite.unsuitable.join(' ')}</p>
              </div>
            </div>
            <div className="shijing-rijing__almanac-grid">
              {hero.rite.cells.map((cell) => (
                <div key={cell.label} className="shijing-rijing__almanac-cell">
                  <span>{cell.label}</span>
                  <strong>{cell.value}</strong>
                </div>
              ))}
            </div>
            <div className="shijing-rijing__almanac-hours-panel">
              <span className="shijing-rijing__almanac-hours-heading">{hero.rite.hoursTitle}</span>
              <div className="shijing-rijing__almanac-hours" aria-label={hero.rite.hoursTitle}>
                {hero.rite.hours.map((hour) => (
                  <span key={hour.branch} data-luck={hour.luck}>
                    <b>{hour.branch}</b>
                    {hour.luck}
                  </span>
                ))}
              </div>
            </div>
          </section>
        </div>
      </article>

      <section className="shijing-rijing__projections" aria-label={content.projections.title}>
        <header className="shijing-rijing__projections-head">
          <h2 className="shijing-rijing__projections-title">{content.projections.title}</h2>
          <div className="shijing-rijing__lens" role="group" aria-label="按关注视角筛选">
            <button
              type="button"
              className="shijing-rijing__lens-chip"
              data-active={lens === '__all__'}
              aria-pressed={lens === '__all__'}
              onClick={() => setLens('__all__')}
            >
              {content.projections.allLabel}
            </button>
            {content.projections.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className="shijing-rijing__lens-chip"
                data-active={lens === row.id}
                aria-pressed={lens === row.id}
                onClick={() => setLens(row.id)}
              >
                {row.name}
              </button>
            ))}
            <button type="button" className="shijing-rijing__lens-manage" aria-haspopup="dialog">
              ✎ {content.projections.manageLabel}
            </button>
          </div>
        </header>
        <ul className="shijing-rijing__frames">
          {visibleRows.map((row) => {
            const open = expanded[row.id] ?? false;
            return (
              <li key={row.id} className="shijing-rijing__frame">
                <button
                  type="button"
                  className="shijing-rijing__frame-row"
                  aria-expanded={open}
                  aria-label={`展开「${row.name}」分镜`}
                  onClick={() => setExpanded((current) => ({ ...current, [row.id]: !open }))}
                >
                  <span className="shijing-rijing__frame-icon" data-tone={row.tone} aria-hidden="true">{concernIcon(row.name)}</span>
                  <span className="shijing-rijing__frame-meta">
                    <span className="shijing-rijing__frame-name">{row.name}</span>
                    <span className="shijing-rijing__frame-pill" data-tone={row.tone}>{row.tendencyLabel}</span>
                  </span>
                  <span className="shijing-rijing__frame-takeaway">{row.takeaway}</span>
                  <span className="shijing-rijing__frame-chevron" data-open={open} aria-hidden="true"><ChevronDown size={16} /></span>
                </button>
                {open ? (
                  <div className="shijing-rijing__frame-detail">
                    <div className="shijing-rijing__frame-detail-divider" aria-hidden="true" />
                    <p className="shijing-rijing__frame-detail-body">{row.detail}</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="shijing-rijing__event-input" aria-label={content.eventInput.title}>
        <header className="shijing-rijing__event-input-head">
          <h3 className="shijing-rijing__event-input-title">{content.eventInput.title}</h3>
          <p className="shijing-rijing__event-input-intro">{content.eventInput.intro}</p>
        </header>
        {references.length > 0 ? (
          <ul className="shijing-rijing__refs" aria-label="今日已参照的事件">
            {references.map((reference, index) => (
              <li key={`${index}-${reference}`} className="shijing-rijing__ref">
                <span className="shijing-rijing__ref-dot" aria-hidden="true" />
                <span className="shijing-rijing__ref-text">{reference}</span>
                <span className="shijing-rijing__ref-badge">{content.eventInput.refsBadge}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          className="shijing-rijing__event-input-textarea"
          value={draft}
          rows={3}
          placeholder={content.eventInput.placeholder}
          aria-label={content.eventInput.title}
          onChange={(event) => {
            setDraft(event.target.value);
            setSavedHint(false);
          }}
        />
        <div className="shijing-rijing__event-input-toolbar">
          {savedHint ? (
            <div className="shijing-rijing__event-input-hint-slot" role="status">
              <span className="shijing-rijing__event-input-hint">{content.eventInput.successHint}</span>
            </div>
          ) : null}
          <button
            type="button"
            className="shijing-rijing__event-input-submit"
            disabled={draft.trim().length === 0}
            onClick={addReference}
          >
            <span>{content.eventInput.submit}</span>
          </button>
        </div>
      </aside>

      <section className="shijing-rijing__actions" aria-label={content.actions.title}>
        <header className="shijing-rijing__actions-head">
          <h2 className="shijing-rijing__actions-title">{content.actions.title}</h2>
        </header>
        <ul className="shijing-rijing__actions-grid">
          {content.actions.groups.map((group) => (
            <li key={group.id} className="shijing-rijing__action">
              <div className="shijing-rijing__action-head">
                <span className="shijing-rijing__action-badge" aria-hidden="true"><Sparkles size={16} /></span>
                <span className="shijing-rijing__action-eyebrow">{group.name}</span>
              </div>
              <ul className="shijing-rijing__action-list">
                {group.recommendations.map((item) => (
                  <li key={item} className="shijing-rijing__action-item">
                    <span className="shijing-rijing__action-dot" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="shijing-rijing__evidence" aria-label={content.evidence.title}>
        <h2>{content.evidence.title}</h2>
        <div className="shijing-rijing__evidence-chips">
          {content.evidence.chips.map((chip) => (
            <span key={chip.label} className="shijing-rijing__evidence-chip">
              {chip.label} <b>{chip.value}</b>
            </span>
          ))}
        </div>
      </section>
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* 月镜                                                                     */
/* ------------------------------------------------------------------------ */
/* Replica of nimiapp-shijing `product/tabs/yuejing-tab.tsx`: mirror page
 * header, today hero, filter row (+ concern editor popover), weekday-aligned
 * 30-day calendar, the collapsible summary, and the two right-side panels
 * (30日行动指南 month panel, per-day detail panel). Readings come from the
 * landing content; the month interpretation (dominant tendency, counts,
 * phase tones) is derived the same way the app derives it. */

type YueJingContent = HeroDemoShijingPreview['yuejing'];
type YueJingConcern = {
  id: string;
  name: string;
  subtitle: string;
  tones: ReadonlyArray<HeroDemoShijingTone> | null;
  details: Readonly<Record<string, string>>;
};
type YueJingRecord = { id: string; date: string; body: string };
type YueJingDayKind = 'past' | 'today' | 'future';
type YueJingCell = { concern: YueJingConcern; tone: HeroDemoShijingTone };
type YueJingDay = { date: string; index: number; tone: HeroDemoShijingTone | null };

const YUEJING_TONE_SEVERITY: Record<HeroDemoShijingTone, number> = { blocked: 4, turning: 3, watch: 2, supportive: 1, steady: 0 };
const YUEJING_TONE_CLASSES: ReadonlyArray<HeroDemoShijingTone> = ['supportive', 'steady', 'watch', 'turning', 'blocked'];

function yuejingAddDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function yuejingWeekdayIndex(iso: string): number {
  return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
}

function yuejingShortMonthDay(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

function yuejingClassifyDay(date: string, today: string): YueJingDayKind {
  if (date < today) return 'past';
  if (date > today) return 'future';
  return 'today';
}

function yuejingExpandRange(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = yuejingAddDays(date, 1)) dates.push(date);
  return dates;
}

function yuejingDominant(tones: ReadonlyArray<HeroDemoShijingTone>): HeroDemoShijingTone {
  let best: HeroDemoShijingTone = 'steady';
  let bestScore = -1;
  for (const tone of tones) {
    if (YUEJING_TONE_SEVERITY[tone] > bestScore) {
      best = tone;
      bestScore = YUEJING_TONE_SEVERITY[tone];
    }
  }
  return best;
}

function yuejingCountTones(tones: ReadonlyArray<HeroDemoShijingTone>): Record<HeroDemoShijingTone, number> {
  const counts: Record<HeroDemoShijingTone, number> = { supportive: 0, steady: 0, watch: 0, turning: 0, blocked: 0 };
  for (const tone of tones) counts[tone] += 1;
  return counts;
}

function yuejingPrimary(counts: Record<HeroDemoShijingTone, number>): HeroDemoShijingTone {
  let best: HeroDemoShijingTone = 'steady';
  let bestCount = -1;
  for (const tone of YUEJING_TONE_CLASSES) {
    const count = counts[tone];
    if (count > bestCount || (count === bestCount && YUEJING_TONE_SEVERITY[tone] > YUEJING_TONE_SEVERITY[best])) {
      best = tone;
      bestCount = count;
    }
  }
  return best;
}

function yuejingConcernStyle(name: string): { bg: string; fg: string; icon: ReactNode } {
  const iconProps = { size: 22, strokeWidth: 1.6, 'aria-hidden': true } as const;
  if (/事业|工作|合作|创业/u.test(name)) return { bg: '#CFE5D5', fg: '#3F7A5C', icon: <Briefcase {...iconProps} /> };
  if (/关系|姻缘|伴侣|感情/u.test(name)) return { bg: '#F8D5D5', fg: '#C76060', icon: <Heart {...iconProps} /> };
  if (/身心|身体|健康|精力/u.test(name)) return { bg: '#E0D2EC', fg: '#7E5DA8', icon: <HeartPulse {...iconProps} /> };
  if (/财/u.test(name)) return { bg: '#F0E0AD', fg: '#9A7E2A', icon: <Coins {...iconProps} /> };
  if (/学/u.test(name)) return { bg: '#D0DEED', fg: '#4F6E94', icon: <BookOpen {...iconProps} /> };
  if (/家/u.test(name)) return { bg: '#F0D8B8', fg: '#9A6E3A', icon: <House {...iconProps} /> };
  return { bg: '#E4E4E4', fg: '#8B8B8B', icon: <Compass {...iconProps} /> };
}

function YueJingConcernIcon({ name }: { name: string }) {
  const style = yuejingConcernStyle(name);
  return (
    <span className="shijing-yuejing__panel-tend-icon" style={{ background: style.bg, color: style.fg }} aria-hidden="true">
      {style.icon}
    </span>
  );
}

const yuejingGlyphProps = { strokeWidth: 1.6, 'aria-hidden': true } as const;

function YueJingTendencyGlyph({ tone }: { tone: HeroDemoShijingTone }) {
  switch (tone) {
    case 'supportive': return <TrendingUp {...yuejingGlyphProps} />;
    case 'steady': return <Leaf {...yuejingGlyphProps} />;
    case 'watch': return <Eye {...yuejingGlyphProps} />;
    case 'turning': return <RefreshCw {...yuejingGlyphProps} />;
    case 'blocked': return <ShieldCheck {...yuejingGlyphProps} />;
  }
}

function YueJingWindowGlyph({ index }: { index: number }) {
  if (index === 0) return <Send {...yuejingGlyphProps} />;
  if (index === 1) return <Pause {...yuejingGlyphProps} />;
  return <RefreshCw {...yuejingGlyphProps} />;
}

function YueJingPhaseGlyph({ index }: { index: number }) {
  if (index === 0) return <CalendarDays {...yuejingGlyphProps} />;
  if (index === 1) return <MessageSquare {...yuejingGlyphProps} />;
  if (index === 2) return <CircleCheck {...yuejingGlyphProps} />;
  return <Flag {...yuejingGlyphProps} />;
}

function YueJingTab({ content, onAskInShijing }: { content: YueJingContent; onAskInShijing: () => void }) {
  const today = content.startDate;
  const labels = content.tendencyLabels;
  const dates = useMemo(() => Array.from({ length: 30 }, (_, index) => yuejingAddDays(today, index)), [today]);
  const [concerns, setConcerns] = useState<YueJingConcern[]>(() => content.concerns.map((concern) => ({ ...concern })));
  const [archived, setArchived] = useState<YueJingConcern[]>([]);
  const [filterId, setFilterId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [monthOpen, setMonthOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<ReadonlyArray<string>>([]);
  const [records, setRecords] = useState<YueJingRecord[]>(() => content.dayPanel.seededRecords.map((record) => ({ ...record })));

  const scoped = useMemo(
    () => (filterId ? concerns.filter((concern) => concern.id === filterId) : concerns),
    [concerns, filterId],
  );
  const cellsByIndex = useMemo(
    () => dates.map((_, index) => scoped.flatMap<YueJingCell>((concern) =>
      concern.tones ? [{ concern, tone: concern.tones[index] ?? 'steady' }] : [],
    )),
    [dates, scoped],
  );
  const days = useMemo<YueJingDay[]>(
    () => dates.map((date, index) => {
      const cells = cellsByIndex[index] ?? [];
      return { date, index, tone: cells.length > 0 ? yuejingDominant(cells.map((cell) => cell.tone)) : null };
    }),
    [dates, cellsByIndex],
  );
  const todayCells = cellsByIndex[0] ?? [];
  const todayTone = yuejingDominant(todayCells.map((cell) => cell.tone));
  const highlightedSet = useMemo(() => new Set(highlighted), [highlighted]);
  const selectedIndex = selectedDate ? dates.indexOf(selectedDate) : -1;

  function changeFilter(next: string | null) {
    setFilterId(next);
    setSelectedDate(null);
    setHighlighted([]);
    setMonthOpen(false);
  }

  function archiveConcern(id: string) {
    const target = concerns.find((concern) => concern.id === id);
    if (!target) return;
    setConcerns((current) => current.filter((concern) => concern.id !== id));
    setArchived((current) => [...current, target]);
    if (filterId === id) changeFilter(null);
  }

  function activateConcern(id: string) {
    const target = archived.find((concern) => concern.id === id);
    if (!target || concerns.length >= content.concernLimit) return;
    setArchived((current) => current.filter((concern) => concern.id !== id));
    setConcerns((current) => [...current, target]);
  }

  function addConcern(name: string, subtitle: string) {
    if (concerns.length >= content.concernLimit) return;
    const clean = name.replace(/^#/, '').trim();
    if (!clean || concerns.some((concern) => concern.name === clean)) return;
    const existing = archived.find((concern) => concern.name === clean);
    if (existing) {
      activateConcern(existing.id);
      return;
    }
    setConcerns((current) => [...current, { id: `custom-${Date.now()}`, name: clean, subtitle, tones: null, details: {} }]);
  }

  const leadingBlanks = yuejingWeekdayIndex(dates[0] ?? today);
  const trailingBlanks = 6 - yuejingWeekdayIndex(dates[dates.length - 1] ?? today);

  return (
    <section className="shijing-tab shijing-yuejing" data-mirror-kind="yuejing" aria-label={content.title}>
      <header className="shijing-mirror-header">
        <div className="shijing-mirror-header__titles">
          <h1>{content.title}</h1>
          <div className="shijing-mirror-header__meta">{content.generatedAgo}</div>
        </div>
        <div className="shijing-mirror-header__actions">
          <div className="shijing-mirror-header__buttons">
            <button type="button" className="shijing-import-to-consultation" onClick={onAskInShijing}>{content.importLabel}</button>
            <button type="button" className="shijing-generating-button shijing-yuejing__generate" disabled>{content.generateLabel}</button>
          </div>
        </div>
      </header>

      <article className="shijing-yuejing__hero" data-tendency={todayTone} aria-label={content.hero.ariaLabel}>
        <div className="shijing-yuejing__hero-headline">
          <span className="shijing-yuejing__hero-eyebrow">{content.hero.eyebrow}</span>
          <div className="shijing-yuejing__hero-tendency">
            <strong>{labels[todayTone]}</strong>
            <small>{yuejingShortMonthDay(today)} · {content.weekdayShort[yuejingWeekdayIndex(today)]}</small>
          </div>
          <p className="shijing-yuejing__hero-body">{content.todayBodyByTone[todayTone]}</p>
        </div>
        <ul className="shijing-yuejing__hero-rows" aria-label={content.hero.rowsAriaLabel}>
          {scoped.map((concern) => {
            const tone = concern.tones?.[0];
            return (
              <li key={concern.id} data-pending={tone ? undefined : 'true'}>
                <span className="shijing-yuejing__hero-row-label">{concern.name}</span>
                <span className="shijing-yuejing__hero-row-chip" data-tendency={tone ?? 'pending'}>
                  <span className="shijing-yuejing__hero-row-chip-dot" aria-hidden="true" />
                  {tone ? labels[tone] : content.hero.pending}
                </span>
              </li>
            );
          })}
          <li className="shijing-yuejing__hero-action-row">
            <button
              type="button"
              className="shijing-yuejing__hero-detail-button"
              onClick={() => {
                setSelectedDate(null);
                setMonthOpen(true);
              }}
            >
              {content.hero.detailButton}
            </button>
          </li>
        </ul>
      </article>

      <YueJingFilterRow
        content={content}
        concerns={concerns}
        archived={archived}
        filterId={filterId}
        onFilterChange={changeFilter}
        onArchive={archiveConcern}
        onActivate={activateConcern}
        onAdd={addConcern}
      />

      <section className="shijing-yuejing__calendar" aria-label={content.calendar.ariaLabel}>
        <ol className="shijing-yuejing__weekday-row" aria-hidden="true">
          {content.weekdayHeaders.map((label) => <li key={label}>{label}</li>)}
        </ol>
        <div className="shijing-yuejing__grid" role="grid" aria-label={content.calendar.gridAriaLabel}>
          {Array.from({ length: leadingBlanks }, (_, index) => (
            <div key={`lead-${index}`} className="shijing-yuejing__blank" role="presentation" />
          ))}
          {days.map((day) => {
            const kind = yuejingClassifyDay(day.date, today);
            const selected = selectedDate === day.date;
            const marker = content.calendar.markers[day.date] ?? { kind: 'lunar_day', label: content.calendar.lunarDays[day.index] ?? '' };
            const hasRecord = records.some((record) => record.date === day.date);
            return (
              <article
                key={day.date}
                className="shijing-yuejing__day"
                role="gridcell"
                data-day-kind={kind}
                data-tendency={day.tone ?? 'empty'}
                data-selected={selected}
                data-window-highlighted={highlightedSet.has(day.date)}
                data-date={day.date}
              >
                <button
                  type="button"
                  className="shijing-yuejing__day-face"
                  onClick={() => setSelectedDate(selected ? null : day.date)}
                  aria-expanded={selected}
                  aria-label={[day.date, marker.label, day.tone ? labels[day.tone] : null].filter(Boolean).join(' · ')}
                >
                  <span className="shijing-yuejing__day-weekday">{content.weekdayShort[yuejingWeekdayIndex(day.date)]}</span>
                  {kind === 'today' ? (
                    <span className="shijing-yuejing__day-today-badge">{content.calendar.todayBadge}</span>
                  ) : hasRecord ? (
                    <span className="shijing-yuejing__day-edit-mark" aria-label={content.calendar.hasRecordAriaLabel}>✎</span>
                  ) : null}
                  <span className="shijing-yuejing__day-number">
                    <span className="shijing-yuejing__day-number-value">{Number(day.date.slice(-2))}</span>
                    {marker.label ? (
                      <span className="shijing-yuejing__day-lunisolar" data-marker-kind={marker.kind}>{marker.label}</span>
                    ) : null}
                  </span>
                  {day.tone ? <span className="shijing-yuejing__day-tendency">{labels[day.tone]}</span> : null}
                </button>
              </article>
            );
          })}
          {Array.from({ length: trailingBlanks }, (_, index) => (
            <div key={`tail-${index}`} className="shijing-yuejing__blank" role="presentation" />
          ))}
        </div>
      </section>

      {filterId === null ? (
        <details className="shijing-yuejing__details">
          <summary>{content.details.summary}</summary>
          <p className="shijing-yuejing__summary">{content.details.body}</p>
          <div className="shijing-yuejing__details-evidence">
            <h3>{content.details.evidenceTitle}</h3>
            <ul>
              {content.details.evidence.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </details>
      ) : null}

      {selectedDate && selectedIndex >= 0 ? (
        <YueJingDayPanel
          content={content}
          date={selectedDate}
          index={selectedIndex}
          kind={yuejingClassifyDay(selectedDate, today)}
          cells={cellsByIndex[selectedIndex] ?? []}
          records={records.filter((record) => record.date === selectedDate)}
          onClose={() => setSelectedDate(null)}
          onSave={(body) => setRecords((current) => [...current, { id: `rec-${Date.now()}`, date: selectedDate, body }])}
          onEdit={(id, body) => setRecords((current) => current.map((record) => (record.id === id ? { ...record, body } : record)))}
          onDelete={(id) => setRecords((current) => current.filter((record) => record.id !== id))}
          onAsk={() => {
            setSelectedDate(null);
            onAskInShijing();
          }}
        />
      ) : null}
      {monthOpen ? (
        <YueJingMonthPanel
          content={content}
          days={days}
          concerns={scoped}
          onHighlight={setHighlighted}
          onSelectDate={(date) => {
            setSelectedDate(date);
            setMonthOpen(false);
          }}
          onClose={() => setMonthOpen(false)}
        />
      ) : null}
    </section>
  );
}

function YueJingFilterRow({
  content,
  concerns,
  archived,
  filterId,
  onFilterChange,
  onArchive,
  onActivate,
  onAdd,
}: {
  content: YueJingContent;
  concerns: ReadonlyArray<YueJingConcern>;
  archived: ReadonlyArray<YueJingConcern>;
  filterId: string | null;
  onFilterChange: (id: string | null) => void;
  onArchive: (id: string) => void;
  onActivate: (id: string) => void;
  onAdd: (name: string, subtitle: string) => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  return (
    <div className="shijing-yuejing__filter-row" role="toolbar" aria-label={content.filter.toolbarAriaLabel}>
      <div className="shijing-yuejing__filter" role="group" aria-label={content.filter.concernAriaLabel}>
        <span className="shijing-yuejing__filter-label" aria-hidden="true">{content.filter.concernLabel}</span>
        <button type="button" className="shijing-yuejing__filter-pill" aria-pressed={filterId === null} onClick={() => onFilterChange(null)}>
          {content.filter.all}
        </button>
        {concerns.map((concern) => (
          <button
            key={concern.id}
            type="button"
            className="shijing-yuejing__filter-pill"
            aria-pressed={filterId === concern.id}
            onClick={() => onFilterChange(concern.id)}
          >
            {concern.name}
          </button>
        ))}
        <span className="shijing-yuejing__editor-anchor">
          <button
            type="button"
            className="shijing-yuejing__filter-manage"
            aria-expanded={editorOpen}
            aria-haspopup="dialog"
            onClick={() => setEditorOpen((open) => !open)}
          >
            {content.filter.manage}
          </button>
          {editorOpen ? (
            <YueJingConcernEditor
              content={content}
              concerns={concerns}
              archived={archived}
              onArchive={onArchive}
              onActivate={onActivate}
              onAdd={onAdd}
              onClose={() => setEditorOpen(false)}
            />
          ) : null}
        </span>
      </div>
      <ul className="shijing-yuejing__legend" aria-label={content.filter.legendAriaLabel}>
        {YUEJING_TONE_CLASSES.map((tone) => (
          <li key={tone} data-tendency={tone}>
            <span className="shijing-yuejing__legend-dot" aria-hidden="true" />
            {content.tendencyLabels[tone]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function YueJingConcernEditor({
  content,
  concerns,
  archived,
  onArchive,
  onActivate,
  onAdd,
  onClose,
}: {
  content: YueJingContent;
  concerns: ReadonlyArray<YueJingConcern>;
  archived: ReadonlyArray<YueJingConcern>;
  onArchive: (id: string) => void;
  onActivate: (id: string) => void;
  onAdd: (name: string, subtitle: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const atLimit = concerns.length >= content.concernLimit;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!popoverRef.current || !target) return;
      if (popoverRef.current.contains(target)) return;
      if (target.closest?.('button[aria-expanded][aria-haspopup="dialog"]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [onClose]);

  const suggestions = [
    ...archived.map((concern) => ({ key: `arc-${concern.id}`, name: concern.name, subtitle: concern.subtitle, activate: () => onActivate(concern.id) })),
    ...content.concernPresets
      .filter((preset) => !concerns.some((concern) => concern.name === preset.name) && !archived.some((concern) => concern.name === preset.name))
      .map((preset) => ({ key: `pre-${preset.name}`, name: preset.name, subtitle: preset.subtitle, activate: () => onAdd(preset.name, preset.subtitle) })),
  ];
  const addTitle = atLimit ? `已达激活上限 ${content.concernLimit}` : content.concernEditor.add;

  return (
    <div ref={popoverRef} className="shijing-yuejing__editor" role="dialog" aria-label={content.concernEditor.ariaLabel}>
      <header className="shijing-yuejing__editor-head">
        <strong>{content.concernEditor.title}</strong>
        <span className="shijing-yuejing__editor-count">{concerns.length}/{content.concernLimit}</span>
      </header>
      <p className="shijing-yuejing__editor-subtitle">{content.concernEditor.subtitle}</p>
      {concerns.length > 0 ? (
        <section className="shijing-yuejing__editor-section">
          <h4>{content.concernEditor.activeHeading}</h4>
          <ul>
            {concerns.map((concern) => (
              <li key={concern.id}>
                <div className="shijing-yuejing__editor-row-text">
                  <strong>{concern.name}</strong>
                  <small>{concern.subtitle}</small>
                </div>
                <button type="button" className="shijing-yuejing__editor-remove" onClick={() => onArchive(concern.id)}>
                  {content.concernEditor.remove}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {suggestions.length > 0 ? (
        <section className="shijing-yuejing__editor-section">
          <h4>{content.concernEditor.addableHeading}</h4>
          <ul>
            {suggestions.map((suggestion) => (
              <li key={suggestion.key}>
                <div className="shijing-yuejing__editor-row-text">
                  <strong>{suggestion.name}</strong>
                  <small>{suggestion.subtitle}</small>
                </div>
                <button type="button" className="shijing-yuejing__editor-add" disabled={atLimit} title={addTitle} onClick={suggestion.activate}>
                  {content.concernEditor.add}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="shijing-yuejing__editor-custom">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder={content.concernEditor.customPlaceholder}
          disabled={atLimit}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !atLimit && draft.trim().length > 0) {
              event.preventDefault();
              onAdd(draft, '');
              setDraft('');
            }
          }}
        />
        <button
          type="button"
          className="shijing-yuejing__editor-add"
          disabled={atLimit || draft.trim().length === 0}
          onClick={() => {
            onAdd(draft, '');
            setDraft('');
          }}
        >
          {content.concernEditor.add}
        </button>
      </div>
    </div>
  );
}

function YueJingDayPanel({
  content,
  date,
  index,
  kind,
  cells,
  records,
  onClose,
  onSave,
  onEdit,
  onDelete,
  onAsk,
}: {
  content: YueJingContent;
  date: string;
  index: number;
  kind: YueJingDayKind;
  cells: ReadonlyArray<YueJingCell>;
  records: ReadonlyArray<YueJingRecord>;
  onClose: () => void;
  onSave: (body: string) => void;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string) => void;
  onAsk: () => void;
}) {
  const copy = content.dayPanel;
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const isPlan = kind === 'future';
  const weekday = content.weekdayShort[yuejingWeekdayIndex(date)] ?? '';
  const marker = content.calendar.markers[date];
  const recordKind = isPlan ? copy.recordKinds.plan : copy.recordKinds.memory;

  useEffect(() => {
    setDraft('');
    setEditingId(null);
    setEditDraft('');
  }, [date]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="shijing-yuejing__panel-backdrop" onClick={onClose} role="presentation" aria-hidden="true" />
      <aside
        className="shijing-yuejing__panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${yuejingShortMonthDay(date)} ${weekday} 详情`}
        data-day-kind={kind}
      >
        <button type="button" className="shijing-yuejing__panel-close" onClick={onClose} aria-label={copy.close}>
          <X size={20} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <header className="shijing-yuejing__panel-head">
          <strong>{yuejingShortMonthDay(date)}</strong>
          <small>{weekday} · {copy.kindLabels[kind]}</small>
        </header>

        <section className="shijing-yuejing__panel-section shijing-yuejing__panel-calendar" aria-label={copy.calendarTitle}>
          <h3>{copy.calendarTitle}</h3>
          <dl className="shijing-yuejing__panel-calendar-grid">
            <div>
              <dt>{copy.lunarLabel}</dt>
              <dd>{copy.lunar[index]}</dd>
            </div>
            <div>
              <dt>{copy.ganzhiLabel}</dt>
              <dd>{copy.ganzhi[index]}</dd>
            </div>
            {marker?.kind === 'solar_term' ? (
              <div>
                <dt>{copy.solarTermLabel}</dt>
                <dd>{marker.label}</dd>
              </div>
            ) : null}
            {marker?.kind === 'festival' ? (
              <div>
                <dt>{copy.festivalsLabel}</dt>
                <dd>{marker.label}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="shijing-yuejing__panel-section">
          <h3>{copy.currentTendency}</h3>
          <ul className="shijing-yuejing__panel-tendencies">
            {cells.map((cell) => {
              const detail = cell.concern.details[date];
              return (
                <li key={cell.concern.id} data-tendency={cell.tone}>
                  <YueJingConcernIcon name={cell.concern.name} />
                  <div className="shijing-yuejing__panel-tend-text">
                    <strong>{cell.concern.name}</strong>
                    {detail ? <p>{detail}</p> : null}
                  </div>
                  <span className="shijing-yuejing__panel-tend-chip" data-tendency={cell.tone}>
                    <span className="shijing-yuejing__panel-tend-dot" aria-hidden="true" />
                    {content.tendencyLabels[cell.tone]}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="shijing-yuejing__panel-section">
          <h3>{copy.entryHeadings[kind]}</h3>
          <textarea
            className="shijing-yuejing__panel-entry"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder={isPlan ? copy.placeholders.plan : copy.placeholders.memory}
          />
          <div className="shijing-yuejing__panel-entry-foot">
            <button
              type="button"
              className="shijing-yuejing__panel-save"
              disabled={draft.trim().length === 0}
              onClick={() => {
                onSave(draft.trim());
                setDraft('');
              }}
            >
              <Pencil size={15} strokeWidth={1.6} aria-hidden="true" />
              <span>{isPlan ? copy.saveLabels.plan : copy.saveLabels.memory}</span>
            </button>
          </div>
        </section>

        <section className="shijing-yuejing__panel-section">
          <h3>{copy.recordsTitle} ({records.length})</h3>
          {records.length === 0 ? (
            <div className="shijing-yuejing__panel-records-empty" role="status">
              <span className="shijing-yuejing__panel-records-empty-icon" aria-hidden="true">
                <ClipboardList size={22} strokeWidth={1.6} />
              </span>
              <p>{copy.recordsEmpty}</p>
            </div>
          ) : (
            <ul className="shijing-yuejing__panel-records" aria-label={`已记录的${recordKind}`}>
              {records.map((record) => {
                const editing = editingId === record.id;
                return (
                  <li key={record.id} data-editing={editing || undefined}>
                    {editing ? (
                      <>
                        <textarea
                          className="shijing-yuejing__panel-record-edit"
                          value={editDraft}
                          onChange={(event) => setEditDraft(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              setEditingId(null);
                            }
                          }}
                          autoFocus
                          aria-label={copy.editRecordContent}
                        />
                        <div className="shijing-yuejing__panel-record-edit-actions">
                          <button type="button" className="shijing-yuejing__panel-record-cancel" onClick={() => setEditingId(null)}>
                            {copy.cancel}
                          </button>
                          <button
                            type="button"
                            className="shijing-yuejing__panel-record-confirm"
                            disabled={editDraft.trim().length === 0 || editDraft.trim() === record.body}
                            onClick={() => {
                              onEdit(record.id, editDraft.trim());
                              setEditingId(null);
                            }}
                          >
                            {copy.save}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="shijing-yuejing__panel-record-body">{record.body}</span>
                        <div className="shijing-yuejing__panel-record-actions">
                          <button type="button" data-action="ask" aria-label={copy.askThisRecord} title={copy.askThisRecord} onClick={onAsk}>
                            <MessageCircle size={14} strokeWidth={1.6} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            data-action="edit"
                            aria-label={`编辑这条${recordKind}`}
                            title={copy.edit}
                            onClick={() => {
                              setEditingId(record.id);
                              setEditDraft(record.body);
                            }}
                          >
                            <Pencil size={14} strokeWidth={1.6} aria-hidden="true" />
                          </button>
                          <button type="button" data-action="delete" aria-label={`删除这条${recordKind}`} title={copy.delete} onClick={() => onDelete(record.id)}>
                            <Trash2 size={14} strokeWidth={1.6} aria-hidden="true" />
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </aside>
    </>
  );
}

function YueJingMonthPanel({
  content,
  days,
  concerns,
  onHighlight,
  onSelectDate,
  onClose,
}: {
  content: YueJingContent;
  days: ReadonlyArray<YueJingDay>;
  concerns: ReadonlyArray<YueJingConcern>;
  onHighlight: (dates: ReadonlyArray<string>) => void;
  onSelectDate: (date: string) => void;
  onClose: () => void;
}) {
  const copy = content.monthPanel;
  const labels = content.tendencyLabels;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const generatedDays = days.filter((day) => day.tone !== null);
  const dayCounts = yuejingCountTones(generatedDays.flatMap((day) => (day.tone ? [day.tone] : [])));
  const cellCounts = yuejingCountTones(concerns.flatMap((concern) => concern.tones ?? []));
  const primary = yuejingPrimary(dayCounts);
  const language = copy.tendencyLanguage[primary];
  const generatedCount = generatedDays.length;

  function highlightRange(ranges: ReadonlyArray<{ from: string; to: string }>) {
    const dates = ranges.flatMap((range) => yuejingExpandRange(range.from, range.to));
    if (dates.length > 0) onHighlight(dates);
  }

  function selectAction(item: { from: string; to: string }) {
    const dates = yuejingExpandRange(item.from, item.to);
    const first = dates[0];
    if (!first) return;
    onHighlight(dates);
    onSelectDate(first);
  }

  return (
    <>
      <div className="shijing-yuejing__panel-backdrop" onClick={onClose} role="presentation" aria-hidden="true" />
      <aside
        className="shijing-yuejing__panel shijing-yuejing__month-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${copy.rangeLabel} ${copy.title}`}
        data-panel-kind="month"
      >
        <button type="button" className="shijing-yuejing__panel-close" onClick={onClose} aria-label={copy.close}>
          <X size={20} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <header className="shijing-yuejing__panel-head shijing-yuejing__month-head">
          <strong>{copy.title}</strong>
          <small>{copy.rangeLabel} · {copy.generatedPrefix}{generatedCount}{copy.generatedSuffix} · {concerns.length} {copy.concernsSuffix}</small>
        </header>

        {generatedCount === 0 ? (
          <div className="shijing-yuejing__month-empty">{copy.empty}</div>
        ) : (
          <>
            <p className="shijing-yuejing__month-action-notice">
              <span aria-hidden="true"><YueJingWindowGlyph index={0} /></span>
              {copy.actionNotice}
            </p>

            <section className="shijing-yuejing__month-section" aria-label={copy.conclusionTitle}>
              <h3><span className="shijing-yuejing__month-num" aria-hidden="true">1</span>{copy.conclusionTitle}</h3>
              <div className="shijing-yuejing__month-conclusion">
                <article className="shijing-yuejing__month-primary" data-tendency={primary}>
                  <div className="shijing-yuejing__month-primary-head">
                    <span className="shijing-yuejing__month-primary-icon" aria-hidden="true"><YueJingTendencyGlyph tone={primary} /></span>
                    <strong className="shijing-yuejing__month-primary-label">{labels[primary]}</strong>
                  </div>
                  <p className="shijing-yuejing__month-primary-body">{language.body}</p>
                  <div className="shijing-yuejing__month-tag-groups">
                    <div>
                      <span>{copy.bestForLabel}</span>
                      <ul>{language.bestFor.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                    <div data-kind="avoid">
                      <span>{copy.avoidLabel}</span>
                      <ul>{language.avoid.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  </div>
                </article>
                <article className="shijing-yuejing__month-distribution">
                  <h4>{copy.distributionTitle}</h4>
                  <ul>
                    {YUEJING_TONE_CLASSES.map((tone) => (
                      <li key={tone} data-tendency={tone}>
                        <span className="shijing-yuejing__month-stat-dot" aria-hidden="true" />
                        <span>{labels[tone]}</span>
                        <strong>{dayCounts[tone]} {copy.dayUnit}</strong>
                      </li>
                    ))}
                  </ul>
                </article>
              </div>
            </section>

            <section className="shijing-yuejing__month-section" aria-label={copy.windowsTitle}>
              <h3><span className="shijing-yuejing__month-num" aria-hidden="true">2</span>{copy.windowsTitle}</h3>
              <ul className="shijing-yuejing__month-windows-grid">
                {copy.windows.map((window, index) => (
                  <li key={window.title} data-tendency={window.tone}>
                    <button type="button" onClick={() => highlightRange(window.ranges)} aria-label={`${window.title} ${window.ranges.map((range) => range.label).join('、')}`}>
                      <span className="shijing-yuejing__month-window-icon" aria-hidden="true"><YueJingWindowGlyph index={index} /></span>
                      <strong>{window.title}</strong>
                      <span className="shijing-yuejing__month-window-dates">
                        {window.ranges.map((range) => <span key={range.label}>{range.label}</span>)}
                      </span>
                      <p>{window.brief}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="shijing-yuejing__month-section" aria-label={copy.concernActionsTitle}>
              <h3><span className="shijing-yuejing__month-num" aria-hidden="true">3</span>{copy.concernActionsTitle}</h3>
              <ul className="shijing-yuejing__month-concerns">
                {concerns.map((concern) => {
                  const action = copy.concernActions.find((entry) => entry.concernId === concern.id);
                  const concernPrimary = concern.tones ? yuejingPrimary(yuejingCountTones(concern.tones)) : null;
                  return (
                    <li key={concern.id} data-primary={concernPrimary ?? undefined}>
                      <div className="shijing-yuejing__month-concern-head">
                        <YueJingConcernIcon name={concern.name} />
                        <div>
                          <strong>{concern.name}</strong>
                          {concernPrimary ? (
                            <span className="shijing-yuejing__month-concern-axis">{copy.primaryAxisPrefix}{labels[concernPrimary]}</span>
                          ) : (
                            <span className="shijing-yuejing__month-concern-axis" data-pending="true">{copy.notGenerated}</span>
                          )}
                        </div>
                      </div>
                      {concernPrimary && action ? (
                        <>
                          <p className="shijing-yuejing__month-concern-summary">{action.summary}</p>
                          <div className="shijing-yuejing__month-concern-checklist">
                            <h5>{copy.checklistTitle}</h5>
                            <ul>
                              {action.checklist.map((item) => (
                                <li key={`${item.window}-${item.label}`}>
                                  <button type="button" onClick={() => selectAction(item)}>
                                    <span className="shijing-yuejing__month-check" aria-hidden="true"><Check size={11} strokeWidth={2} /></span>
                                    <span>
                                      <strong>{item.window}</strong>
                                      {item.label}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <ul className="shijing-yuejing__month-reminders" aria-label={`${concern.name} ${copy.remindersSuffix}`}>
                            {action.reminders.map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        </>
                      ) : (
                        <p className="shijing-yuejing__month-concern-summary">{copy.pendingConcernBody}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="shijing-yuejing__month-section shijing-yuejing__month-more" aria-label={copy.supplementaryAriaLabel}>
              <div className="shijing-yuejing__month-accordion-list">
                <details className="shijing-yuejing__month-accordion">
                  <summary>
                    <span className="shijing-yuejing__month-accordion-icon" aria-hidden="true"><YueJingPhaseGlyph index={0} /></span>
                    {copy.rhythmTitle}
                    <span className="shijing-yuejing__month-accordion-chevron" aria-hidden="true">›</span>
                  </summary>
                  <ol className="shijing-yuejing__month-timeline">
                    {copy.phases.map((phase, index) => {
                      const phaseTones = days.flatMap((day) => (day.date >= phase.from && day.date <= phase.to && day.tone ? [day.tone] : []));
                      const phaseTone = phaseTones.length > 0 ? yuejingPrimary(yuejingCountTones(phaseTones)) : 'steady';
                      return (
                        <li key={phase.title} data-tendency={phaseTone}>
                          <span className="shijing-yuejing__month-timeline-icon" aria-hidden="true"><YueJingPhaseGlyph index={index} /></span>
                          <div className="shijing-yuejing__month-timeline-card">
                            <header>
                              <strong>{phase.title} {phase.name}</strong>
                              <span>{yuejingShortMonthDay(phase.from)}–{yuejingShortMonthDay(phase.to)}</span>
                            </header>
                            <dl className="shijing-yuejing__month-timeline-meta">
                              <div><dt>{copy.themeLabel}</dt><dd>{phase.theme}</dd></div>
                              <div><dt>{copy.suitableLabel}</dt><dd>{phase.suitable}</dd></div>
                              <div data-kind="avoid"><dt>{copy.unsuitableLabel}</dt><dd>{phase.unsuitable}</dd></div>
                            </dl>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </details>

                <details className="shijing-yuejing__month-accordion">
                  <summary>
                    <span className="shijing-yuejing__month-accordion-icon" aria-hidden="true"><YueJingTendencyGlyph tone={primary} /></span>
                    {copy.dailyDistributionTitle}
                    <span className="shijing-yuejing__month-accordion-chevron" aria-hidden="true">›</span>
                  </summary>
                  <ul className="shijing-yuejing__month-stats" aria-label={copy.distributionTitle}>
                    {YUEJING_TONE_CLASSES.map((tone) => (
                      <li key={tone} data-tendency={tone}>
                        <span className="shijing-yuejing__month-stat-head">
                          <span className="shijing-yuejing__month-stat-dot" aria-hidden="true" />
                          {labels[tone]}
                          <strong>{dayCounts[tone]} {copy.dayUnit}</strong>
                        </span>
                        <span className="shijing-yuejing__month-stat-bar" aria-hidden="true">
                          <i style={{ width: `${Math.round((dayCounts[tone] / generatedCount) * 100)}%` }} />
                        </span>
                      </li>
                    ))}
                  </ul>
                  <ol className="shijing-yuejing__month-rhythm-grid" aria-label={`${copy.rangeLabel} ${copy.rhythmAriaLabel}`}>
                    {days.map((day) => (
                      <li
                        key={day.date}
                        data-tendency={day.tone ?? 'empty'}
                        title={`${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8, 10))} · ${day.tone ? labels[day.tone] : copy.pending}`}
                      >
                        <span className="shijing-yuejing__month-rhythm-cell"><span aria-hidden="true" /></span>
                      </li>
                    ))}
                  </ol>
                  <div className="shijing-yuejing__month-rhythm-axis" aria-hidden="true">
                    <span>{copy.startLabel}</span>
                    <span>{copy.endLabel}</span>
                  </div>
                </details>

                <details className="shijing-yuejing__month-accordion">
                  <summary>
                    <span className="shijing-yuejing__month-accordion-icon" aria-hidden="true"><Check size={16} strokeWidth={1.6} /></span>
                    {copy.evidenceTitle}
                    <span className="shijing-yuejing__month-accordion-chevron" aria-hidden="true">›</span>
                  </summary>
                  <ul className="shijing-yuejing__month-evidence-list">
                    {copy.evidence.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                  <ul className="shijing-yuejing__month-counts" aria-label={copy.countsAriaLabel}>
                    {YUEJING_TONE_CLASSES.filter((tone) => cellCounts[tone] > 0).map((tone) => (
                      <li key={tone} data-tendency={tone}>
                        <span className="shijing-yuejing__panel-tend-dot" aria-hidden="true" />
                        {labels[tone]} {cellCounts[tone]} {copy.countUnit}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </section>
          </>
        )}
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* 年镜                                                                     */
/* ------------------------------------------------------------------------ */

const TONE_SCORE: Record<HeroDemoShijingTone, number> = { supportive: 4, steady: 3, turning: 2, watch: 1.5, blocked: 1 };
const TONE_COLOR: Record<HeroDemoShijingTone, string> = { supportive: '#4ecca3', steady: '#5b78ed', watch: '#d49b3a', blocked: '#d0705f', turning: '#b376e3' };

function NianJingTab({ content }: { content: HeroDemoShijingPreview['nianjing'] }) {
  const [selected, setSelected] = useState(content.years[0]?.year ?? 0);
  const current = content.years.find((entry) => entry.year === selected) ?? content.years[0];
  const points = content.years.map((entry, index) => ({
    x: 20 + (index * 760) / Math.max(content.years.length - 1, 1),
    y: 100 - TONE_SCORE[entry.tone] * 20,
    tone: entry.tone,
    year: entry.year,
  }));
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
  return (
    <section className="shijing-tab shijing-nianjing" data-mirror-kind="nianjing" aria-label={content.title}>
      <header className="shijing-mirror-header">
        <div className="shijing-mirror-header__titles">
          <h1>{content.title}</h1>
          <div className="shijing-mirror-header__meta">{content.subtitle}</div>
        </div>
      </header>
      <section className="sjd-glass" aria-label={content.subtitle}>
        <svg className="sjd-nianjing__chart" viewBox="0 0 800 120" aria-hidden="true">
          <path d={path} fill="none" stroke="#4ecca3" strokeWidth="2" strokeLinejoin="round" />
          {points.map((point) => (
            <circle
              key={point.year}
              cx={point.x}
              cy={point.y}
              r={point.year === selected ? 7 : 5}
              fill={point.year === selected ? TONE_COLOR[point.tone] : '#fff'}
              stroke={TONE_COLOR[point.tone]}
              strokeWidth="2"
            />
          ))}
        </svg>
        <div className="sjd-nianjing__years">
          {content.years.map((entry) => (
            <button
              key={entry.year}
              type="button"
              className="sjd-nianjing__year sjd-tone"
              data-tone={entry.tone}
              data-active={entry.year === selected}
              aria-pressed={entry.year === selected}
              onClick={() => setSelected(entry.year)}
            >
              <b>{entry.year}</b>
              <small>{entry.label}</small>
            </button>
          ))}
        </div>
      </section>
      {current ? (
        <section className="sjd-glass" aria-label={content.selectedYearEyebrow}>
          <div className="sjd-nianjing__summary">
            <div>
              <span className="sjd-eyebrow">{content.selectedYearEyebrow}</span>
              <h2>
                {current.year} 年
                <span className="sjd-pill sjd-tone" data-tone={current.tone}>{current.label}</span>
              </h2>
              <p>{current.year === content.years[0]?.year ? content.summaryBody : `${current.year} 年整体节奏为「${current.label}」；点击右上角刷新可按当前关注生成完整年度解读。`}</p>
            </div>
            <div className="sjd-nianjing__lead sjd-tone" data-tone={current.tone}>
              <span className="sjd-eyebrow">{content.yearLeadLabel}</span>
              <strong>{current.label}</strong>
              <div className="sjd-bar"><span style={{ width: `${TONE_SCORE[current.tone] * 25}%` }} /></div>
            </div>
          </div>
        </section>
      ) : null}
      <section className="sjd-glass" aria-label="关注">
        <div className="sjd-nianjing__concerns">
          {content.concerns.map((concern) => (
            <article key={concern.name} className="sjd-nianjing__concern sjd-tone" data-tone={concern.tone}>
              <header>
                <span>{concern.name}</span>
                <span className="sjd-pill">{concern.label}</span>
              </header>
              <div className="sjd-bar"><span style={{ width: `${TONE_SCORE[concern.tone] * 25}%` }} /></div>
              <p>{concern.body}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* 命镜                                                                     */
/* ------------------------------------------------------------------------ */

// 命镜 is method-routed and lives in demo-shijing-mingjing.tsx (DemoShijingMingJing).

/* ------------------------------------------------------------------------ */
/* 合镜                                                                     */
/* ------------------------------------------------------------------------ */

// 合镜 first-run state — the app's immersive intake hero
// (nimiapp-shijing tabs/hejing/hejing-immersive-empty.tsx, 合镜 grade of
// onboarding/immersive-intake-gate.css). The app shows this until the first
// relationship person exists; the demo keeps it as the 合镜 entry screen.
function HeJingTab({ content }: { content: HeroDemoShijingPreview['hejing'] }) {
  return (
    <section className="shijing-hejing" data-mirror-kind="hejing" aria-label={content.title}>
      <section
        className="shijing-intake-hero"
        data-mirror-kind="hejing"
        aria-label={content.ariaLabel}
        style={{ backgroundImage: `url(${content.heroImage}), linear-gradient(150deg, #14241a 0%, #20382a 100%)` }}
      >
        <div className="shijing-intake-hero__content">
          <p className="shijing-intake-hero__eyebrow">{content.eyebrow}</p>
          <h1 className="shijing-intake-hero__title">
            {content.titleLead}
            <br />
            {content.titleEmphasis}
          </h1>
          <span className="shijing-intake-hero__divider" aria-hidden="true" />
          <p className="shijing-intake-hero__body">{content.body}</p>
          <div className="shijing-intake-hero__actions">
            <button type="button" className="shijing-intake-hero__action">
              {content.primaryAction}
              <span className="shijing-intake-hero__action-arrow" aria-hidden="true">→</span>
            </button>
          </div>
          <p className="shijing-intake-hero__subnote">{content.stepsHint}</p>
        </div>
        <p className="shijing-intake-hero__footer">
          {content.footer}
          <span className="shijing-intake-hero__footer-rule" aria-hidden="true" />
        </p>
      </section>
    </section>
  );
}

// 问镜 lives in demo-shijing-ask.tsx (DemoShijingAsk).

/* ------------------------------------------------------------------------ */
/* Shell                                                                    */
/* ------------------------------------------------------------------------ */

export function DemoShijingPreview({
  content,
  initialTab = 'rijing',
  initialMethodProfile,
}: {
  content: HeroDemoShijingPreview;
  initialTab?: HeroDemoShijingTabId;
  initialMethodProfile?: HeroDemoShijingMethodId;
}) {
  const [activeTab, setActiveTab] = useState<HeroDemoShijingTabId>(initialTab);
  const [methodProfile, setMethodProfile] = useState<HeroDemoShijingMethodId>(
    initialMethodProfile ?? content.methodProfiles[0]?.id ?? 'bazi_ziping_v1',
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const initial = Array.from(content.accountName)[0] ?? '·';

  return (
    <div className="demo-shijing-root" data-demo-shijing-root="true" data-demo-owns-scroll="true" data-demo-interactive="true">
      <div className="shijing-shell" data-active-tab={activeTab}>
        <header className="shijing-topbar">
          <div className="shijing-topbar__brand">
            <span className="shijing-topbar__wordmark">{content.brandName}</span>
            <span className="shijing-topbar__tagline" aria-hidden="true">{content.brandTagline}</span>
          </div>
          <nav className="shijing-primary-tabbar" aria-label={content.navAriaLabel}>
            {content.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-current={activeTab === tab.id ? 'page' : undefined}
                data-mirror-kind={tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="shijing-topbar__method">
            <select
              id="shijing-global-method-profile"
              className="shijing-topbar__method-select"
              aria-label="推演方法"
              value={methodProfile}
              onChange={(event) => setMethodProfile(event.target.value as HeroDemoShijingMethodId)}
            >
              {content.methodProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.label}</option>
              ))}
            </select>
          </div>
          <div className="shijing-topbar__account" ref={accountRef}>
            <button
              type="button"
              className="shijing-topbar__avatar-button"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label={`${content.accountMenuLabel} - ${content.accountName}`}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="shijing-topbar__avatar" aria-hidden="true">{initial}</span>
              <span className="shijing-topbar__account-name">{content.accountName}</span>
            </button>
            {menuOpen ? (
              <div className="shijing-account-menu" role="menu" aria-label="设置">
                {['档案', '关注', '重要经历', '设置'].map((label) => (
                  <button key={label} type="button" role="menuitem" onClick={() => setMenuOpen(false)}>{label}</button>
                ))}
              </div>
            ) : null}
          </div>
        </header>
        <main className="shijing-shell__main" role="main">
          {activeTab === 'rijing' ? <RiJingTab content={content.rijing} /> : null}
          {activeTab === 'yuejing' ? <YueJingTab content={content.yuejing} onAskInShijing={() => setActiveTab('shijing')} /> : null}
          {activeTab === 'nianjing' ? <NianJingTab content={content.nianjing} /> : null}
          {activeTab === 'mingjing' ? <DemoShijingMingJing content={content.mingjing} methodProfile={methodProfile} /> : null}
          {activeTab === 'hejing' ? <HeJingTab content={content.hejing} /> : null}
          {activeTab === 'shijing' ? <DemoShijingAsk content={content.ask} /> : null}
        </main>
      </div>
    </div>
  );
}
