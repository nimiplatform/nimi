import { useEffect, useRef, useState } from 'react';
import { S } from '../../app-shell/page-style.js';

const SERIF = "var(--font-serif, 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STSong', Georgia, serif)";
const MONO = "var(--nimi-font-mono, 'JetBrains Mono', 'SF Mono', ui-monospace, monospace)";
const FG1 = S.text;
const FG2 = '#334155';
const FG3 = S.sub;
const FG4 = '#94a3b8';
const ACCENT = S.accent;
const RULE_SOFT = 'rgba(148,163,184,0.30)';

const FAMILY_PRESETS_STORAGE_KEY = 'parentos.reports.familyShareSelection.v1';

interface FamilyPreset { id: string; name: string; initial: string; color: string }

/**
 * The six built-in relationship chips. `name` matches the strings used by
 * RECORDER_PRESETS in children-settings-page, so we can filter the current
 * user's role out by string comparison against `child.recorderProfiles[0].name`.
 */
const FAMILY_PRESETS: FamilyPreset[] = [
  { id: 'dad',      name: '爸爸', initial: '爸', color: '#bfdbfe' },
  { id: 'mom',      name: '妈妈', initial: '妈', color: '#fbcfe8' },
  { id: 'grandma-m',name: '外婆', initial: '婆', color: '#fce7f3' },
  { id: 'grandpa-m',name: '外公', initial: '公', color: '#ddd6fe' },
  { id: 'grandma-p',name: '奶奶', initial: '奶', color: '#fef3c7' },
  { id: 'grandpa-p',name: '爷爷', initial: '爷', color: '#d9f99d' },
];

function loadFamilySelection(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(FAMILY_PRESETS_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch { return new Set(); }
}

function saveFamilySelection(sel: Set<string>): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(FAMILY_PRESETS_STORAGE_KEY, JSON.stringify([...sel])); } catch { /* */ }
}

/* ── Toast ───────────────────────────────────────────────────── */

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div style={{
      position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
      zIndex: 3000,
      padding: '10px 18px', borderRadius: 12,
      background: 'rgba(15,23,42,0.88)', color: '#fff',
      fontSize: 13, letterSpacing: '0.02em',
      boxShadow: '0 12px 32px rgba(15,23,42,0.35)',
      maxWidth: 320, textAlign: 'center',
    }}>
      {message}
    </div>
  );
}

/* ── Family share row (placeholder) ──────────────────────────── */

interface FamilyShareRowProps {
  onShareSelected: (names: string[]) => void;
  /**
   * The current user's role name — drawn from the child's recorder profile
   * set in children-settings (e.g. "妈妈", "爸爸"). The matching chip is
   * hidden so we never offer sharing to oneself.
   */
  selfRoleName?: string;
}

export function FamilyShareRow({ onShareSelected, selfRoleName }: FamilyShareRowProps) {
  const [selected, setSelected] = useState<Set<string>>(() => loadFamilySelection());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveFamilySelection(next);
      return next;
    });
  };

  // Current user's role comes from the child profile's recorder (set in
  // children-settings). We hide that chip so the user isn't offered the
  // option of "sharing with themselves".
  const trimmedSelf = (selfRoleName ?? '').trim();
  const visiblePresets = FAMILY_PRESETS.filter((p) => p.name !== trimmedSelf);

  const selectedNames = FAMILY_PRESETS
    .filter((p) => p.name !== trimmedSelf && selected.has(p.id))
    .map((p) => p.name);

  return (
    <div className="report-family-share-row" style={{
      padding: '16px 20px',
      background: 'rgba(255,255,255,0.7)',
      border: `1px solid ${RULE_SOFT}`,
      borderRadius: 14,
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: FG1 }}>把这份报告分享给</div>
        <div style={{ fontSize: 11, color: FG4 }}>自动隐去私密观察，仅保留孩子成长数据</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 }}>
        {visiblePresets.map((p) => {
          const on = selected.has(p.id);
          return (
            <button key={p.id} onClick={() => toggle(p.id)}
              aria-pressed={on}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '4px 12px 4px 4px', borderRadius: 999,
                background: on ? 'rgba(78,204,163,0.14)' : 'rgba(255,255,255,0.9)',
                border: `1px solid ${on ? 'rgba(78,204,163,0.55)' : RULE_SOFT}`,
                color: FG1, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                transition: 'all 160ms', fontFamily: 'inherit',
              }}>
              <span style={{
                width: 24, height: 24, borderRadius: 999, background: p.color,
                display: 'grid', placeItems: 'center',
                fontSize: 11, fontWeight: 600, color: '#0f172a', flexShrink: 0,
              }}>{p.initial}</span>
              <span>{p.name}</span>
              {on ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : null}
            </button>
          );
        })}
        {visiblePresets.length === 0 ? (
          <span style={{ fontSize: 12, color: FG3 }}>
            暂无可分享的家人
          </span>
        ) : null}
      </div>
      <button
        onClick={() => onShareSelected(selectedNames)}
        disabled={selectedNames.length === 0}
        style={{
          padding: '8px 16px', borderRadius: 999, border: 0,
          background: selectedNames.length > 0 ? ACCENT : '#cbd5e1',
          color: '#fff', fontSize: 12.5, fontWeight: 600,
          cursor: selectedNames.length > 0 ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit',
        }}>
        分享所选
      </button>
    </div>
  );
}

/* ── Save menu (PDF / Image) ─────────────────────────────────── */

interface SaveMenuProps {
  open: boolean;
  onClose: () => void;
  onPrintPdf: () => void;
  onSaveImage: () => void;
}
function SaveMenu({ open, onClose, onPrintPdf, onSaveImage }: SaveMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => {
      window.addEventListener('mousedown', onClick);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div ref={ref} style={{
      position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
      minWidth: 220,
      background: '#fff', borderRadius: 12,
      border: `1px solid ${RULE_SOFT}`,
      boxShadow: '0 12px 32px rgba(15,23,42,0.16)',
      overflow: 'hidden', zIndex: 20,
    }}>
      <button onClick={() => { onClose(); onPrintPdf(); }}
        style={{
          width: '100%', padding: '11px 14px', textAlign: 'left',
          background: 'transparent', border: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10,
          fontFamily: 'inherit', fontSize: 13, color: FG1,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(148,163,184,0.08)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" />
        </svg>
        <div>
          <div style={{ fontWeight: 600 }}>另存为 PDF</div>
          <div style={{ fontSize: 11, color: FG3, marginTop: 2 }}>系统对话框选择保存位置</div>
        </div>
      </button>
      <div style={{ height: 1, background: RULE_SOFT }} />
      <button onClick={() => { onClose(); onSaveImage(); }}
        style={{
          width: '100%', padding: '11px 14px', textAlign: 'left',
          background: 'transparent', border: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10,
          fontFamily: 'inherit', fontSize: 13, color: FG1,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(148,163,184,0.08)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
        <div>
          <div style={{ fontWeight: 600 }}>另存为图片</div>
          <div style={{ fontSize: 11, color: FG3, marginTop: 2 }}>竖版 PNG，适合发朋友圈/家人群</div>
        </div>
      </button>
    </div>
  );
}

/* ── Action cards ────────────────────────────────────────────── */

interface ActionCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}

function ActionCard({ icon, title, subtitle, onClick, disabled, accent }: ActionCardProps) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        width: '100%', minWidth: 0,
        padding: '14px 16px', borderRadius: 14,
        background: 'rgba(255,255,255,0.7)',
        border: `1px solid ${RULE_SOFT}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        textAlign: 'left', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', gap: 12,
        transition: 'all 160ms',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.borderColor = 'rgba(148,163,184,0.5)'; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.borderColor = RULE_SOFT; }}>
      <div style={{
        flexShrink: 0, width: 38, height: 38, borderRadius: 10,
        background: accent ? 'rgba(78,204,163,0.14)' : 'rgba(148,163,184,0.12)',
        color: accent ? '#0f766e' : FG2,
        display: 'grid', placeItems: 'center',
      }}>
        {icon}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 13.5, fontWeight: 600, color: FG1,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {title}
        </div>
        <div style={{
          fontSize: 11.5, color: FG3, marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {subtitle}
        </div>
      </div>
    </button>
  );
}

/* ── Main bar ────────────────────────────────────────────────── */

interface ReportActionBarProps {
  childName: string;
  /** The current user's role from child.recorderProfiles[0].name (e.g. "妈妈"). */
  selfRoleName?: string;
  onPrintPdf: () => void;
  onSaveImage: () => Promise<void> | void;
  onOpenProfessional: () => void;
  onRequestFocusNoteComposer?: () => void;
  onFamilyShareToast?: (message: string) => void;
}

export function ReportActionBar({
  childName, selfRoleName, onPrintPdf, onSaveImage, onOpenProfessional,
  onRequestFocusNoteComposer, onFamilyShareToast,
}: ReportActionBarProps) {
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const showToast = (msg: string) => {
    if (onFamilyShareToast) onFamilyShareToast(msg);
    else setToast(msg);
  };

  const handleFamilySelection = (names: string[]) => {
    if (names.length === 0) {
      showToast('先勾选一位家人');
      return;
    }
    showToast(`已为「${names.join('、')}」准备精简版（分享通道即将接入）`);
  };

  const handleImage = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await onSaveImage();
    } catch {
      showToast('图片生成失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  const handleNote = () => {
    if (onRequestFocusNoteComposer) onRequestFocusNoteComposer();
    else showToast('在任意一段观察下方都能点「追加我的备注」');
  };

  return (
    <section className="report-action-bar hide-on-print" style={{
      marginTop: 48, padding: '22px 24px',
      background: 'rgba(255,255,255,0.55)',
      border: `1px solid ${RULE_SOFT}`,
      borderRadius: 18,
      boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)',
      backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
    }}>
      <FamilyShareRow onShareSelected={handleFamilySelection} selfRoleName={selfRoleName} />

      <div style={{
        marginTop: 14,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 12,
      }}>
        <div style={{ minWidth: 0 }}>
          <ActionCard
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                <path d="M6 12v5c3 3 9 3 12 0v-5" />
              </svg>
            }
            title="给老师/医生看的精简版"
            subtitle="AI 客观版本，可逐条编辑/隐去"
            onClick={onOpenProfessional}
          />
        </div>
        <div style={{ position: 'relative', minWidth: 0 }}>
          <ActionCard
            icon={exporting ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 12a9 9 0 11-6.22-8.56" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
            )}
            title={exporting ? '正在生成图片…' : '保存为 PDF / 图片'}
            subtitle="竖版 · 竖向长卷适合发家人群"
            onClick={() => setSaveMenuOpen((o) => !o)}
            disabled={exporting}
          />
          <SaveMenu
            open={saveMenuOpen}
            onClose={() => setSaveMenuOpen(false)}
            onPrintPdf={onPrintPdf}
            onSaveImage={() => void handleImage()}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <ActionCard
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            }
            title="追加我的备注"
            subtitle={`写在 ${childName} 本月任意一段观察旁`}
            onClick={handleNote}
          />
        </div>
      </div>

      {toast ? <Toast message={toast} onDone={() => setToast(null)} /> : null}
    </section>
  );
}

/* Keep some atoms exported so the Letter viewer can label its print-safe
 * hash of the data source without duplicating styles. */
export { SERIF as REPORT_SERIF, MONO as REPORT_MONO };
