import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { S } from '../../app-shell/page-style.js';
import { NoteAnchor } from './report-user-notes.js';
import { exportReportAsPng, printReport } from './report-export.js';
import { ReportActionBar } from './reports-action-bar.js';
import { ProfessionalSummaryModal } from './reports-professional-view.js';
import type { NarrativeReportContent, NarrativeSection } from './structured-report.js';

const SERIF = "var(--font-serif, 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STSong', Georgia, serif)";
const MONO = "var(--nimi-font-mono, 'JetBrains Mono', 'SF Mono', ui-monospace, monospace)";
const FG1 = S.text;
const FG2 = '#334155';
const FG3 = S.sub;
const FG4 = '#94a3b8';
const ACCENT = S.accent;

const KIND_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  growth:    { color: '#0ea5e9', bg: 'rgba(14,165,233,0.10)', label: '成长' },
  sleep:     { color: '#6366f1', bg: 'rgba(99,102,241,0.10)', label: '作息' },
  health:    { color: '#ec4899', bg: 'rgba(236,72,153,0.10)', label: '健康' },
  nutrition: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', label: '饮食' },
  milestone: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.10)', label: '里程碑' },
  journal:   { color: '#10b981', bg: 'rgba(16,185,129,0.10)', label: '观察' },
  emotion:   { color: '#10b981', bg: 'rgba(16,185,129,0.10)', label: '情感' },
  default:   { color: ACCENT,    bg: 'rgba(78,204,163,0.12)', label: '记录' },
};

function kindOf(section: NarrativeSection) {
  const id = (section.id || '').toLowerCase();
  for (const key of Object.keys(KIND_STYLE)) {
    if (id.includes(key)) return KIND_STYLE[key]!;
  }
  return KIND_STYLE.default!;
}

// Old reports generated before the child-centric prompt change may contain
// caregiver-addressed openers like "亲爱的妈妈，感谢你..." We detect those and
// fall back to safer text so the hero doesn't scream the wrong subject.
const CAREGIVER_PATTERNS: RegExp[] = [
  /^亲爱的(妈妈|爸爸|家长|父母|爹娘|你)/,
  /^(感谢|谢谢)你/,
  /^你这个月/,
  /^你辛苦了/,
  /^致\s*(妈妈|爸爸|家长|父母)/,
];

function looksCaregiverAddressed(text: string | null | undefined): boolean {
  if (!text) return false;
  const head = text.trim().slice(0, 24);
  return CAREGIVER_PATTERNS.some((re) => re.test(head));
}

function sanitizeForChildFocus(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (looksCaregiverAddressed(trimmed)) return null;
  return trimmed;
}

function splitTeaser(source: string): { keyword: string; sub: string } {
  const trimmed = source.trim();
  if (!trimmed) return { keyword: '', sub: '' };
  const match = trimmed.match(/^([\u4e00-\u9fa5]{2,4}|\S{2,6})[，,。.\s·—-]+(.+)$/);
  if (match) return { keyword: match[1]!, sub: match[2]!.trim() };
  if (trimmed.length <= 6) return { keyword: trimmed, sub: '' };
  return { keyword: trimmed.slice(0, 3), sub: trimmed.slice(3).trim() };
}

function firstSentence(text: string) {
  if (!text) return '';
  const m = text.trim().match(/^[^。.!?！？]+[。.!?！？]?/);
  return m ? m[0]!.trim() : text.trim();
}

function monthFromIso(iso: string | undefined) {
  const d = iso ? new Date(iso) : new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/* ── Editable helpers ── */

function EditPencil({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="编辑" style={{
      position: 'absolute', top: -4, right: -4,
      width: 24, height: 24, borderRadius: 6, border: 0, cursor: 'pointer',
      background: 'rgba(255,255,255,0.9)', color: FG3,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      opacity: 0, transition: 'opacity 120ms',
    }} className="edit-pencil"
    onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      </svg>
    </button>
  );
}

function HoverEditable({
  text, canEdit, onSave, children,
}: { text: string; canEdit: boolean; onSave: (v: string) => void; children: (text: string) => React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const start = () => { setDraft(text); setEditing(true); setTimeout(() => ref.current?.focus(), 0); };
  if (editing) {
    return (
      <div>
        <textarea ref={ref} value={draft} onChange={(e) => setDraft(e.target.value)}
          style={{
            width: '100%', minHeight: 96, padding: '10px 12px',
            borderRadius: 10, border: `1px solid ${ACCENT}`,
            background: 'rgba(255,255,255,0.9)', color: FG1,
            fontFamily: 'inherit', fontSize: 15, lineHeight: 1.7, outline: 'none', resize: 'vertical',
          }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={() => { onSave(draft); setEditing(false); }}
            style={{ padding: '6px 14px', borderRadius: 8, border: 0, background: ACCENT, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>保存</button>
          <button onClick={() => setEditing(false)}
            style={{ padding: '6px 14px', borderRadius: 8, border: 0, background: 'transparent', color: FG3, fontSize: 12, cursor: 'pointer' }}>取消</button>
        </div>
      </div>
    );
  }
  return (
    <div className="group" style={{ position: 'relative' }}>
      {children(text)}
      {canEdit && <EditPencil onClick={start} />}
    </div>
  );
}

/* ── Icons ── */

function QuoteIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 11H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2v10a4 4 0 01-4 4M21 11h-5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2v10a4 4 0 01-4 4" />
    </svg>
  );
}

/* ── Main viewer ── */

interface Props {
  content: NarrativeReportContent;
  reportId?: string;
  onContentUpdate?: (u: NarrativeReportContent) => void;
  periodStart?: string;
  periodEnd?: string;
  ageMonthsStart?: number;
  ageMonthsEnd?: number;
  childName?: string;
  /** Current user's family role, taken from child.recorderProfiles[0].name. */
  selfRoleName?: string;
}

export function MonthlyLetterViewer({
  content, reportId, onContentUpdate,
  periodStart, periodEnd, ageMonthsStart, ageMonthsEnd, childName, selfRoleName,
}: Props) {
  const canEdit = Boolean(reportId && onContentUpdate);
  const editField = (field: 'opening' | 'closingMessage' | 'milestoneReplay', value: string) =>
    onContentUpdate?.({ ...content, [field]: value });
  const editSection = (id: string, narrative: string) =>
    onContentUpdate?.({
      ...content,
      narrativeSections: content.narrativeSections.map((s) => s.id === id ? { ...s, narrative } : s),
    });
  const handleNoteChange = (next: NarrativeReportContent) => onContentUpdate?.(next);

  const articleRef = useRef<HTMLElement>(null);
  const [professionalOpen, setProfessionalOpen] = useState(false);
  const [professionalPrintPending, setProfessionalPrintPending] = useState(false);

  const handlePrintLetter = () => printReport('letter');
  const handlePrintProfessional = () => {
    // Close the modal so only the professional printable subtree remains
    // visible; styles.css hides the letter article by scope.
    setProfessionalOpen(false);
    setProfessionalPrintPending(true);
    setTimeout(() => {
      printReport('professional');
      setProfessionalPrintPending(false);
    }, 50);
  };
  const handleSaveImage = async () => {
    await exportReportAsPng(articleRef.current, {
      filename: `${((childName && childName.trim()) || '成长报告')}-${periodStart?.slice(0, 7) ?? ''}.png`,
      backgroundColor: '#fffdf5',
    });
  };
  const focusNoteComposer = () => {
    const composer = articleRef.current?.querySelector<HTMLElement>('.report-note-composer');
    if (composer) {
      composer.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (composer.querySelector('button, textarea') as HTMLElement | null)?.focus();
    }
  };

  const { month } = monthFromIso(periodStart ?? content.generatedAt);
  const issueNo = String(month).padStart(2, '0');
  const name = (childName && childName.trim()) || content.title.replace(/的?(月度|本月|这个月|四月|三月|五月).*$/, '').trim() || 'Ta';

  const cleanTeaser = sanitizeForChildFocus(content.teaser);
  const cleanOpening = sanitizeForChildFocus(content.opening);
  const cleanClosing = sanitizeForChildFocus(content.closingMessage);

  // Hero keyword — prefer the AI-distilled `keyword` field. Fall back to
  // deriving from teaser/opening (with name-guard) for legacy reports.
  let heroKeyword = '';
  let heroSub = '';
  const nameLower = name.trim().toLowerCase();
  const keywordIsName = (k: string) => {
    const t = k.trim().toLowerCase();
    return !t || t === nameLower || t.startsWith(nameLower) || nameLower.startsWith(t);
  };
  if (content.keyword && content.keyword.trim() && !keywordIsName(content.keyword)) {
    heroKeyword = content.keyword.trim();
    heroSub = (content.keywordSub && content.keywordSub.trim()) || '';
  } else {
    const sources = [
      cleanTeaser,
      cleanOpening ? firstSentence(cleanOpening) : null,
      content.narrativeSections[0]?.title ?? null,
    ].filter((s): s is string => Boolean(s));
    for (const src of sources) {
      const split = splitTeaser(src);
      if (split.keyword && !keywordIsName(split.keyword)) {
        heroKeyword = split.keyword;
        heroSub = split.sub;
        break;
      }
    }
  }

  const heroLine = cleanOpening ?? cleanTeaser ?? '';

  const isLegacyCaregiverAddressed =
    looksCaregiverAddressed(content.opening) ||
    looksCaregiverAddressed(content.teaser) ||
    looksCaregiverAddressed(content.closingMessage);

  const momentsCount = content.narrativeSections.length
    + (content.highlights?.length ?? 0)
    + (content.milestoneReplay ? 1 : 0);

  const highlights = (content.highlights?.length ?? 0) > 0
    ? content.highlights!.slice(0, 3).map((body, i) => ({
        title: firstSentence(body) || `亮点 ${i + 1}`,
        body,
      }))
    : [];

  const pullQuoteRaw = cleanClosing
    || content.milestoneReplay
    || cleanTeaser
    || (cleanOpening ? firstSentence(cleanOpening) : null)
    || '';
  const pullQuoteField: 'closingMessage' | 'milestoneReplay' | 'opening' | null =
    cleanClosing ? 'closingMessage'
      : content.milestoneReplay ? 'milestoneReplay'
        : cleanOpening ? 'opening' : null;

  const periodLabel = periodStart && periodEnd
    ? `${periodStart.slice(0, 10)} → ${periodEnd.slice(0, 10)}`
    : content.subtitle;

  const formatAgeMonths = (m: number) => {
    const y = Math.floor(m / 12);
    const mm = m % 12;
    return mm === 0 ? `${y}岁` : `${y}岁${mm}个月`;
  };
  const ageLabel = ageMonthsStart != null && ageMonthsEnd != null
    ? (ageMonthsStart >= 24
        ? `${formatAgeMonths(ageMonthsStart)}–${formatAgeMonths(ageMonthsEnd)}`
        : `${ageMonthsStart}–${ageMonthsEnd} 月龄`)
    : null;

  const showDataPoints = (dp: NarrativeSection['dataPoints']) => dp && dp.length > 0;

  return (
    <div>
    <article
      ref={articleRef}
      className="report-printable-page"
      style={{
      maxWidth: 640, margin: '0 auto',
      padding: '56px 48px 80px',
      background: 'linear-gradient(180deg, rgba(255,255,250,0.92) 0%, rgba(255,252,246,0.94) 50%, rgba(252,249,244,0.92) 100%)',
      border: '1px solid rgba(226,232,240,0.9)',
      borderRadius: 4,
      boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 28px 72px rgba(15,23,42,0.10)',
      position: 'relative',
      fontFamily: 'var(--nimi-font-sans, Inter, "Noto Sans SC", system-ui, sans-serif)',
      color: FG1,
    }}>
      {/* paper grain */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0, borderRadius: 4, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at 20% 10%, rgba(252,231,243,0.12), transparent 60%), radial-gradient(ellipse at 80% 90%, rgba(191,219,254,0.10), transparent 60%)',
      }} />

      {/* Legacy-format banner — shown only when stored AI text still addresses the caregiver */}
      {isLegacyCaregiverAddressed ? (
        <div className="report-legacy-banner hide-on-print" style={{
          position: 'relative', zIndex: 1,
          marginBottom: 32, padding: '12px 16px',
          background: 'rgba(254,243,199,0.7)',
          border: '1px solid rgba(251,191,36,0.45)',
          borderRadius: 10,
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <div style={{ fontSize: 12.5, lineHeight: 1.7, color: '#78350f' }}>
            这份报告是旧格式生成的（内容还在对妈妈/记录者说话）。
            在下方「高级选项」重新生成同一时段，就会变成以 {name} 为主角的新版。
          </div>
        </div>
      ) : null}

      {/* dateline + round badge */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 48, position: 'relative', zIndex: 1 }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: FG3, letterSpacing: '0.12em' }}>
            LETTER № {issueNo}
            {content.format === 'narrative-ai' ? (
              <span style={{ marginLeft: 10, padding: '1px 8px', borderRadius: 999, background: 'rgba(78,204,163,0.14)', color: '#0f766e', fontWeight: 600 }}>AI 撰写</span>
            ) : null}
          </div>
          <div style={{ fontSize: 12, color: FG3, marginTop: 6, letterSpacing: '0.02em' }}>
            {periodLabel}
            {ageLabel ? ` · ${ageLabel}` : ''}
            {momentsCount ? ` · ${momentsCount} 个瞬间` : ''}
          </div>
        </div>
        <div style={{
          width: 64, height: 64, borderRadius: 999,
          background: 'linear-gradient(135deg, #a7f3d0 0%, #bfdbfe 60%, #ddd6fe 100%)',
          display: 'grid', placeItems: 'center', color: 'white',
          boxShadow: 'inset 0 0 0 3px rgba(255,255,255,0.6), 0 6px 18px rgba(15,23,42,0.08)',
          flexShrink: 0,
        }}>
          <div style={{ textAlign: 'center', lineHeight: 1 }}>
            <div style={{ fontSize: 10, opacity: 0.9 }}>{month}月</div>
            <div style={{ fontSize: name.length <= 2 ? 18 : name.length <= 4 ? 14 : name.length <= 6 ? 11 : 9, fontWeight: 700, marginTop: 2, fontFamily: SERIF, maxWidth: 56, lineHeight: 1.05, wordBreak: 'break-word' }}>
              {name}
            </div>
          </div>
        </div>
      </header>

      {/* Title */}
      <h1 style={{
        margin: '0 0 40px', fontSize: 20, fontWeight: 600, color: FG1,
        letterSpacing: '0.01em', fontFamily: SERIF, position: 'relative', zIndex: 1,
      }}>
        {content.title}
      </h1>

      {/* Hero keyword + line */}
      <section className="report-hero-block" style={{ marginBottom: 56, position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: 12, color: FG3, letterSpacing: '0.24em', fontWeight: 600, marginBottom: 16 }}>
          本 月 关 键 词
        </div>
        {heroKeyword ? (
          <h2 style={{
            margin: 0, fontFamily: SERIF,
            fontSize: 80, lineHeight: 1.05, fontWeight: 700, letterSpacing: '0.02em', color: FG1,
            wordBreak: 'break-word',
          }}>
            {heroKeyword}
            {heroSub ? (
              <span style={{
                display: 'block', fontSize: 30, fontWeight: 400, marginTop: 8,
                color: FG3, letterSpacing: '0.04em',
              }}>
                · {heroSub}
              </span>
            ) : null}
          </h2>
        ) : null}
        {heroLine ? (
          <HoverEditable text={heroLine} canEdit={canEdit} onSave={(v) => editField('opening', v)}>
            {(t) => (
              <div style={{
                marginTop: 28, fontSize: 16.5, lineHeight: 1.85, color: FG2,
                fontStyle: 'italic', fontFamily: SERIF,
                borderLeft: `2px solid ${ACCENT}`, paddingLeft: 20,
              }}>
                {t}
              </div>
            )}
          </HoverEditable>
        ) : null}
        <NoteAnchor anchor="opening" content={content} canEdit={canEdit} onChange={handleNoteChange} />
      </section>

      {/* Letter body — child-centric opening stats */}
      <section style={{
        marginBottom: 48, fontSize: 15, lineHeight: 2, color: FG1,
        letterSpacing: '0.015em', position: 'relative', zIndex: 1,
      }}>
        <p style={{ margin: '0 0 20px' }}>
          {name} 这个月
          {ageLabel ? <>在 <b>{ageLabel}</b> 的节奏里，</> : '，'}
          被记录下了 <b>{momentsCount}</b> 个瞬间，
          分布在 <b>{content.narrativeSections.length}</b> 个观察里。
        </p>
        <p style={{ margin: 0, color: FG2 }}>
          以下是关于 {name} 这个月，值得被留下来的几件事。
        </p>
      </section>

      {/* Three highlights — numbered */}
      {highlights.length > 0 ? (
        <section style={{ marginBottom: 56, position: 'relative', zIndex: 1 }}>
          {highlights.map((h, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '52px 1fr', gap: 18,
              padding: '24px 0',
              borderTop: i === 0 ? '1px solid rgba(148,163,184,0.25)' : 'none',
              borderBottom: '1px solid rgba(148,163,184,0.25)',
            }}>
              <div style={{
                fontFamily: SERIF, fontSize: 36, fontWeight: 400, color: ACCENT,
                lineHeight: 1, letterSpacing: '-0.02em',
              }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <div>
                <h3 style={{
                  margin: '0 0 10px', fontFamily: SERIF,
                  fontSize: 19, fontWeight: 600, letterSpacing: '0.01em',
                  color: FG1, lineHeight: 1.4,
                }}>
                  {h.title}
                </h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.85, color: FG2 }}>
                  {h.body}
                </p>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {/* Pulled quote — kraft box */}
      {pullQuoteRaw ? (
        <section className="report-pullquote-box report-avoid-break" style={{
          margin: '48px 0', padding: '32px 28px',
          background: 'rgba(255,251,235,0.8)',
          borderRadius: 20, border: '1px solid rgba(251,191,36,0.25)',
          position: 'relative', zIndex: 1,
        }}>
          <div style={{ color: 'rgba(180,83,9,0.55)', marginBottom: 10 }}>
            <QuoteIcon size={26} />
          </div>
          {pullQuoteField ? (
            <HoverEditable
              text={pullQuoteRaw}
              canEdit={canEdit}
              onSave={(v) => editField(pullQuoteField, v)}
            >
              {(t) => (
                <div style={{
                  fontFamily: SERIF, fontSize: 20, lineHeight: 1.7, fontWeight: 500,
                  color: FG1, letterSpacing: '0.015em',
                }}>
                  “{t}”
                </div>
              )}
            </HoverEditable>
          ) : (
            <div style={{
              fontFamily: SERIF, fontSize: 20, lineHeight: 1.7, fontWeight: 500,
              color: FG1, letterSpacing: '0.015em',
            }}>
              “{pullQuoteRaw}”
            </div>
          )}
          <div style={{ marginTop: 14, fontSize: 12, color: FG3, letterSpacing: '0.04em' }}>
            — 关于 {name} · {periodLabel}
          </div>
          <NoteAnchor anchor="closingMessage" content={content} canEdit={canEdit} onChange={handleNoteChange} />
        </section>
      ) : null}

      {/* Narrative timeline — "{name} 这个月的样子" */}
      {content.narrativeSections.length > 0 ? (
        <section style={{ marginBottom: 48, position: 'relative', zIndex: 1 }}>
          <h3 style={{
            margin: '0 0 6px', fontFamily: SERIF,
            fontSize: 22, fontWeight: 600, letterSpacing: '0.01em',
          }}>
            {name} 这个月的样子
          </h3>
          <div style={{ fontSize: 12, color: FG3, marginBottom: 20, letterSpacing: '0.04em' }}>
            {content.narrativeSections.length} 个被看见的变化
          </div>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 6, top: 10, bottom: 10, width: 1,
              background: 'linear-gradient(to bottom, transparent, rgba(148,163,184,0.35) 10%, rgba(148,163,184,0.35) 90%, transparent)',
            }} />
            {content.narrativeSections.map((sec) => {
              const k = kindOf(sec);
              return (
                <li key={sec.id} style={{
                  display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)',
                  alignItems: 'start', gap: 14, padding: '16px 0',
                }}>
                  <div style={{
                    width: 13, height: 13, borderRadius: 999, marginTop: 8,
                    background: k.color, boxShadow: `0 0 0 4px ${k.bg}`,
                  }} />
                  <div>
                    <div style={{
                      display: 'inline-block',
                      fontSize: 10, letterSpacing: '0.12em', fontWeight: 600,
                      color: k.color, marginBottom: 4, textTransform: 'uppercase',
                    }}>
                      {k.label}
                    </div>
                    <h4 style={{
                      margin: '0 0 8px', fontFamily: SERIF,
                      fontSize: 16, fontWeight: 600, color: FG1, letterSpacing: '0.005em',
                    }}>
                      {sec.title}
                    </h4>
                    <HoverEditable
                      text={sec.narrative}
                      canEdit={canEdit}
                      onSave={(v) => editSection(sec.id, v)}
                    >
                      {(t) => (
                        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.85, color: FG2 }}>{t}</p>
                      )}
                    </HoverEditable>
                    {showDataPoints(sec.dataPoints) ? (
                      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {sec.dataPoints!.map((dp, i) => (
                          <span key={i} style={{
                            padding: '3px 10px', borderRadius: 999,
                            background: k.bg, color: k.color, fontSize: 11, fontWeight: 500,
                          }}>
                            {dp.label}: {dp.value}{dp.detail ? ` · ${dp.detail}` : ''}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <NoteAnchor
                      anchor={`section:${sec.id}`}
                      content={content}
                      canEdit={canEdit}
                      onChange={handleNoteChange}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {/* Watch next — inline in letter flow */}
      {content.watchNext && content.watchNext.length > 0 ? (
        <section style={{ marginBottom: 48, position: 'relative', zIndex: 1 }}>
          <h3 style={{ margin: '0 0 6px', fontFamily: SERIF, fontSize: 22, fontWeight: 600, letterSpacing: '0.01em' }}>
            下月可以多留意
          </h3>
          <div style={{ fontSize: 12, color: FG3, marginBottom: 16, letterSpacing: '0.04em' }}>
            给下一次见面的提醒
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
            {content.watchNext.map((w, i) => (
              <li key={i} style={{
                display: 'flex', gap: 12, alignItems: 'flex-start',
                padding: '12px 14px', borderRadius: 10,
                background: 'rgba(148,163,184,0.06)',
              }}>
                <span style={{
                  marginTop: 6, width: 6, height: 6, borderRadius: 999,
                  background: ACCENT, flexShrink: 0,
                }} />
                <span style={{ fontSize: 14, lineHeight: 1.7, color: FG2 }}>{w}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Next steps */}
      {content.actionItems.length > 0 ? (
        <section style={{ marginBottom: 48, position: 'relative', zIndex: 1 }}>
          <h3 style={{
            margin: '0 0 6px', fontFamily: SERIF,
            fontSize: 22, fontWeight: 600, letterSpacing: '0.01em',
          }}>
            如果想再往前一步
          </h3>
          <div style={{ fontSize: 12, color: FG3, marginBottom: 20, letterSpacing: '0.04em' }}>
            关于 {name} 的几件事，都可以稍后决定。
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {content.actionItems.slice(0, 3).map((a) => (
              <article key={a.id} style={{
                padding: 16, borderRadius: 14,
                background: 'rgba(255,255,255,0.62)',
                border: '1px solid rgba(226,232,240,0.9)',
                display: 'flex', gap: 14, alignItems: 'flex-start',
              }}>
                <div style={{
                  flexShrink: 0, width: 32, height: 32, borderRadius: 10,
                  background: 'rgba(78,204,163,0.14)', color: '#0f766e',
                  display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 700,
                }}>→</div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: FG1, lineHeight: 1.4 }}>
                    {a.text}
                  </h4>
                  <Link to={a.linkTo ?? '/advisor'} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    marginTop: 10,
                    fontSize: 12, color: ACCENT, textDecoration: 'none', fontWeight: 600,
                  }}>
                    去 Advisor 讨论
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* Caregiver acknowledgment — small, late in flow */}
      <section style={{
        margin: '32px 0', padding: '20px 24px',
        background: 'rgba(240,253,250,0.6)',
        borderRadius: 14, border: '1px solid rgba(78,204,163,0.25)',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, color: FG2 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
          </svg>
          <span style={{ fontSize: 11, letterSpacing: '0.14em', fontWeight: 600, textTransform: 'uppercase' }}>
            也看见记录的你
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.85, color: FG1 }}>
          这封信能写出来，是因为你这个月把 {name} 的细节都放在了心上。
          坐下来记录的那些时刻，也是她月度故事的一部分。
        </p>
      </section>

      {/* Sign-off — child-centric, no caregiver address */}
      <section style={{
        marginTop: 56, paddingTop: 32,
        borderTop: '1px solid rgba(148,163,184,0.25)',
        position: 'relative', zIndex: 1,
      }}>
        <p style={{
          margin: '0 0 20px', fontSize: 14, lineHeight: 2, color: FG2,
          fontStyle: 'italic', fontFamily: SERIF,
        }}>
          这就是 {name} 本月的样子。
          <br />下个月，再见。
        </p>
        <div style={{ fontSize: 11, color: FG4, letterSpacing: '0.08em', fontFamily: MONO }}>
          — ParentOS · {periodLabel}
        </div>
      </section>

      {/* Sources footer */}
      <footer style={{
        marginTop: 32, fontSize: 10.5, lineHeight: 1.7,
        color: FG4, letterSpacing: '0.02em', position: 'relative', zIndex: 1,
      }}>
        <div>数据来源：{content.sources.slice(0, 6).join(' · ')}{content.sources.length > 6 ? ' 等' : ''}</div>
        {content.safetyNote ? (
          <div style={{ marginTop: 6, color: '#92400e' }}>{content.safetyNote}</div>
        ) : null}
      </footer>
    </article>

    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <ReportActionBar
        childName={name}
        selfRoleName={selfRoleName}
        onPrintPdf={handlePrintLetter}
        onSaveImage={handleSaveImage}
        onOpenProfessional={() => setProfessionalOpen(true)}
        onRequestFocusNoteComposer={focusNoteComposer}
      />
    </div>

    <ProfessionalSummaryModal
      open={professionalOpen && !professionalPrintPending}
      onClose={() => setProfessionalOpen(false)}
      content={content}
      onContentUpdate={onContentUpdate}
      title={content.title}
      onPrint={handlePrintProfessional}
    />
    </div>
  );
}
