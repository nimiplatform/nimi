import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { S } from '../../app-shell/page-style.js';
import type { NarrativeReportContent, ProfessionalSummary, ProfessionalSummarySection } from './structured-report.js';

const SERIF = "var(--font-serif, 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STSong', Georgia, serif)";
const MONO = "var(--nimi-font-mono, 'JetBrains Mono', 'SF Mono', ui-monospace, monospace)";
const FG1 = S.text;
const FG2 = '#334155';
const FG3 = S.sub;
const FG4 = '#94a3b8';
const ACCENT = S.accent;
const RULE_SOFT = 'rgba(148,163,184,0.30)';

interface SectionDraftChange {
  body?: string;
  enabled?: boolean;
}

function updateSection(
  summary: ProfessionalSummary,
  sectionId: string,
  change: SectionDraftChange,
): ProfessionalSummary {
  return {
    ...summary,
    sections: summary.sections.map((s) => s.id === sectionId ? { ...s, ...change } : s),
  };
}

function restoreSectionToAi(
  summary: ProfessionalSummary,
  sectionId: string,
): ProfessionalSummary {
  return {
    ...summary,
    sections: summary.sections.map((s) => s.id === sectionId ? { ...s, body: s.aiOriginal } : s),
  };
}

export function serializeProfessionalSummaryToText(
  summary: ProfessionalSummary,
  title: string,
): string {
  const enabled = summary.sections.filter((s) => s.enabled);
  const lines: string[] = [title, '', summary.childSummary, ''];
  for (const s of enabled) {
    lines.push(`【${s.title}】`);
    lines.push(s.body.trim() || '本期未记录。');
    lines.push('');
  }
  lines.push('──');
  lines.push(summary.disclaimer);
  return lines.join('\n');
}

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}
function Toggle({ checked, onChange, ariaLabel }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 999,
        background: checked ? ACCENT : '#cbd5e1',
        border: 0, padding: 0, cursor: 'pointer',
        position: 'relative', flexShrink: 0,
        transition: 'background 160ms',
      }}>
      <span style={{
        position: 'absolute', top: 2, left: checked ? 20 : 2,
        width: 18, height: 18, borderRadius: 999,
        background: '#fff',
        boxShadow: '0 2px 4px rgba(15,23,42,0.15)',
        transition: 'left 160ms',
      }} />
    </button>
  );
}

interface ProfessionalSectionEditorProps {
  section: ProfessionalSummarySection;
  onBodyChange: (body: string) => void;
  onToggle: (enabled: boolean) => void;
  onRestore: () => void;
}
function ProfessionalSectionEditor({
  section, onBodyChange, onToggle, onRestore,
}: ProfessionalSectionEditorProps) {
  const isEdited = section.body !== section.aiOriginal;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.body);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(section.body); }, [section.body]);

  const start = () => {
    setDraft(section.body); setEditing(true);
    setTimeout(() => ref.current?.focus(), 0);
  };
  const save = () => {
    onBodyChange(draft);
    setEditing(false);
  };

  return (
    <article style={{
      opacity: section.enabled ? 1 : 0.5,
      padding: '18px 20px', borderRadius: 14,
      background: section.enabled ? '#ffffff' : 'rgba(248,250,252,0.8)',
      border: `1px solid ${RULE_SOFT}`,
      transition: 'opacity 160ms',
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <h4 style={{
          margin: 0, flex: 1,
          fontFamily: SERIF, fontSize: 16, fontWeight: 600, color: FG1,
        }}>
          {section.title}
          {isEdited ? (
            <span style={{ marginLeft: 8, fontSize: 11, color: '#b45309', fontWeight: 500, fontFamily: 'inherit' }}>
              · 已编辑
            </span>
          ) : null}
        </h4>
        <span style={{ fontSize: 11, color: FG3 }}>{section.enabled ? '包含' : '隐藏'}</span>
        <Toggle checked={section.enabled} onChange={onToggle} ariaLabel={`是否包含 ${section.title} 到分享版本`} />
      </header>

      {editing ? (
        <>
          <textarea ref={ref} value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{
              width: '100%', minHeight: 120, padding: '10px 12px',
              borderRadius: 10, border: `1px solid ${ACCENT}`,
              background: '#ffffff', color: FG1,
              fontFamily: 'inherit', fontSize: 14, lineHeight: 1.75,
              outline: 'none', resize: 'vertical',
            }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={save}
              style={{ padding: '6px 14px', borderRadius: 8, border: 0, background: ACCENT, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              保存
            </button>
            <button onClick={() => { setDraft(section.body); setEditing(false); }}
              style={{ padding: '6px 14px', borderRadius: 8, border: 0, background: 'transparent', color: FG3, fontSize: 12, cursor: 'pointer' }}>
              取消
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{
            margin: 0, fontSize: 14, lineHeight: 1.85, color: FG2,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {section.body || '本期未记录。'}
          </p>
          {section.enabled ? (
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <button onClick={start}
                style={{
                  padding: '5px 12px', borderRadius: 8, border: `1px solid ${RULE_SOFT}`,
                  background: '#fff', color: FG2, fontSize: 12, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
                }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
                编辑
              </button>
              {isEdited ? (
                <button onClick={onRestore}
                  style={{
                    padding: '5px 12px', borderRadius: 8, border: 0,
                    background: 'transparent', color: FG3, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  恢复 AI 原文
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}

/* ── Modal ───────────────────────────────────────────────────── */

interface ProfessionalViewProps {
  open: boolean;
  onClose: () => void;
  content: NarrativeReportContent;
  onContentUpdate?: (next: NarrativeReportContent) => void;
  title: string;
  onPrint?: () => void;
  onCopy?: (text: string) => void;
}

export function ProfessionalSummaryModal({
  open, onClose, content, onContentUpdate, title, onPrint, onCopy,
}: ProfessionalViewProps) {
  const [copyToast, setCopyToast] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const summary = content.professionalSummary;

  const applySummary = (nextSummary: ProfessionalSummary) => {
    if (!onContentUpdate) return;
    onContentUpdate({ ...content, professionalSummary: nextSummary });
  };

  const handleCopy = () => {
    if (!summary) return;
    const text = serializeProfessionalSummaryToText(summary, title);
    if (onCopy) { onCopy(text); setCopyToast('已复制'); }
    else {
      navigator.clipboard?.writeText(text).then(
        () => setCopyToast('已复制'),
        () => setCopyToast('复制失败'),
      );
    }
    setTimeout(() => setCopyToast(null), 1800);
  };

  const content_node = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pro-summary-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 24px',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 760,
          background: '#ffffff', borderRadius: 20,
          boxShadow: '0 24px 72px rgba(15,23,42,0.35)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100vh - 80px)',
        }}
      >
        <header style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          padding: '24px 28px 18px',
          borderBottom: `1px solid ${RULE_SOFT}`,
        }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: FG3, letterSpacing: '0.14em', fontWeight: 600, textTransform: 'uppercase' }}>
              SHARE · 给老师 / 医生
            </div>
            <h2 id="pro-summary-title" style={{
              margin: '6px 0 0',
              fontFamily: SERIF, fontSize: 22, fontWeight: 700, color: FG1, letterSpacing: '-0.005em',
            }}>
              精简版 · {title}
            </h2>
            {summary?.childSummary ? (
              <div style={{ marginTop: 6, fontSize: 12.5, color: FG2 }}>{summary.childSummary}</div>
            ) : null}
          </div>
          <button onClick={onClose} aria-label="关闭"
            style={{
              width: 32, height: 32, borderRadius: 8, border: 0,
              background: 'transparent', cursor: 'pointer', color: FG3,
              display: 'grid', placeItems: 'center',
            }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div style={{
          padding: '18px 28px 20px',
          flex: 1, minHeight: 0, overflowY: 'auto',
        }}>
          {summary ? (
            <>
              <div style={{
                marginBottom: 16, padding: '10px 14px',
                background: 'rgba(248,250,252,0.9)', border: `1px solid ${RULE_SOFT}`, borderRadius: 10,
                fontSize: 12.5, color: FG2, lineHeight: 1.7,
              }}>
                <span style={{ fontWeight: 600, color: FG1 }}>精简版说明：</span>
                AI 按客观医学/教育记录语气生成，家长可逐条编辑或隐去敏感内容；未勾选的 section 不会出现在导出或复制内容里。
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                {summary.sections.map((s) => (
                  <ProfessionalSectionEditor key={s.id} section={s}
                    onBodyChange={(body) => applySummary(updateSection(summary, s.id, { body }))}
                    onToggle={(enabled) => applySummary(updateSection(summary, s.id, { enabled }))}
                    onRestore={() => applySummary(restoreSectionToAi(summary, s.id))} />
                ))}
              </div>
            </>
          ) : (
            <div style={{
              padding: '32px 20px', textAlign: 'center',
              background: 'rgba(248,250,252,0.9)', borderRadius: 12,
              color: FG2, fontSize: 13.5, lineHeight: 1.8,
            }}>
              此报告还没有精简版内容。
              <br />
              请回到报告页「高级选项 · 生成综合报告」重新生成一次，AI 会同时产出精简版。
            </div>
          )}
        </div>

        <footer style={{
          padding: '14px 28px 20px',
          borderTop: `1px solid ${RULE_SOFT}`,
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        }}>
          {summary?.disclaimer ? (
            <div style={{ flex: 1, minWidth: 240, fontSize: 11, color: FG4, lineHeight: 1.7 }}>
              {summary.disclaimer}
            </div>
          ) : <div style={{ flex: 1 }} />}
          <button onClick={handleCopy} disabled={!summary}
            style={{
              padding: '8px 14px', borderRadius: 10, border: `1px solid ${RULE_SOFT}`,
              background: '#fff', color: FG1, fontSize: 12.5, fontWeight: 500, cursor: summary ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', opacity: summary ? 1 : 0.5,
            }}>
            {copyToast ?? '复制精简版'}
          </button>
          <button onClick={onPrint} disabled={!summary || !onPrint}
            style={{
              padding: '8px 14px', borderRadius: 10, border: 0,
              background: summary && onPrint ? ACCENT : '#cbd5e1',
              color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: summary && onPrint ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
            }}>
            另存为 PDF
          </button>
        </footer>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(content_node, document.body);
}
