import { useEffect, useRef, useState } from 'react';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { Check, Download, FileImage, GraduationCap, LoaderCircle, Pencil, Printer } from 'lucide-react';

const SERIF = "var(--font-serif, 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STSong', Georgia, serif)";
const MONO = "var(--nimi-font-mono, 'JetBrains Mono', 'SF Mono', ui-monospace, monospace)";

const FAMILY_PRESETS_STORAGE_KEY = 'parentos.reports.familyShareSelection.v1';

interface FamilyPreset { id: string; name: string; initial: string; toneClass: string }

/**
 * The six built-in relationship chips. `name` matches the strings used by
 * RECORDER_PRESETS in children-settings-page, so we can filter the current
 * user's role out by string comparison against `child.recorderProfiles[0].name`.
 */
const FAMILY_PRESETS: FamilyPreset[] = [
  { id: 'dad', name: '爸爸', initial: '爸', toneClass: 'report-family-avatar--dad' },
  { id: 'mom', name: '妈妈', initial: '妈', toneClass: 'report-family-avatar--mom' },
  { id: 'grandma-m', name: '外婆', initial: '婆', toneClass: 'report-family-avatar--grandma-m' },
  { id: 'grandpa-m', name: '外公', initial: '公', toneClass: 'report-family-avatar--grandpa-m' },
  { id: 'grandma-p', name: '奶奶', initial: '奶', toneClass: 'report-family-avatar--grandma-p' },
  { id: 'grandpa-p', name: '爷爷', initial: '爷', toneClass: 'report-family-avatar--grandpa-p' },
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
    <div className="report-toast">
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
    <Surface
      className="report-family-share-row"
      tone="card"
      material="glass-thin"
      elevation="base"
      padding="none"
    >
      <div className="report-family-copy">
        <div className="report-family-heading">把这份报告分享给</div>
        <div className="report-family-subtitle">自动隐去私密观察，仅保留孩子成长数据</div>
      </div>
      <div className="report-family-presets">
        {visiblePresets.map((p) => {
          const on = selected.has(p.id);
          return (
            <button
              key={p.id}
              onClick={() => toggle(p.id)}
              aria-pressed={on}
              className="report-family-preset-button"
            >
              <span className={`report-family-avatar ${p.toneClass}`}>{p.initial}</span>
              <span>{p.name}</span>
              {on ? (
                <Check size={11} className="report-icon-accent" strokeWidth={2.5} />
              ) : null}
            </button>
          );
        })}
        {visiblePresets.length === 0 ? (
          <span className="report-empty-inline">
            暂无可分享的家人
          </span>
        ) : null}
      </div>
      <Button
        onClick={() => onShareSelected(selectedNames)}
        disabled={selectedNames.length === 0}
        tone="primary"
        size="sm"
        className="rounded-full"
      >
        分享所选
      </Button>
    </Surface>
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
    <div ref={ref} className="report-save-menu">
      <Surface tone="overlay" elevation="floating" padding="none" className="report-save-menu-surface">
        <button onClick={() => { onClose(); onPrintPdf(); }} className="report-save-menu-button">
          <Printer size={14} />
          <div>
            <div className="report-save-menu-label">另存为 PDF</div>
            <div className="report-save-menu-help">系统对话框选择保存位置</div>
          </div>
        </button>
        <div className="report-save-menu-divider" />
        <button onClick={() => { onClose(); onSaveImage(); }} className="report-save-menu-button">
          <FileImage size={14} />
          <div>
            <div className="report-save-menu-label">另存为图片</div>
            <div className="report-save-menu-help">竖版 PNG，适合发朋友圈/家人群</div>
          </div>
        </button>
      </Surface>
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
    <Surface
      as="button"
      onClick={onClick}
      disabled={disabled}
      interactive={!disabled}
      tone="card"
      material="glass-thin"
      elevation="base"
      padding="none"
      className="report-action-card"
    >
      <div className={`report-action-card-icon ${accent ? 'report-action-card-icon--accent' : ''}`}>
        {icon}
      </div>
      <div className="report-action-card-copy">
        <div className="report-action-card-title">
          {title}
        </div>
        <div className="report-action-card-subtitle">
          {subtitle}
        </div>
      </div>
    </Surface>
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
    <Surface
      as="section"
      tone="card"
      material="glass-regular"
      elevation="raised"
      padding="none"
      className="report-action-bar hide-on-print"
    >
      <FamilyShareRow onShareSelected={handleFamilySelection} selfRoleName={selfRoleName} />

      <div className="report-action-grid">
        <div className="report-min-w-0">
          <ActionCard
            icon={
              <GraduationCap size={16} strokeWidth={1.8} />
            }
            title="给老师/医生看的精简版"
            subtitle="AI 客观版本，可逐条编辑/隐去"
            onClick={onOpenProfessional}
          />
        </div>
        <div className="report-save-card-cell">
          <ActionCard
            icon={exporting ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Download size={16} strokeWidth={1.8} />
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
        <div className="report-min-w-0">
          <ActionCard
            icon={
              <Pencil size={16} strokeWidth={1.8} />
            }
            title="追加我的备注"
            subtitle={`写在 ${childName} 本月任意一段观察旁`}
            onClick={handleNote}
          />
        </div>
      </div>

      {toast ? <Toast message={toast} onDone={() => setToast(null)} /> : null}
    </Surface>
  );
}

/* Keep some atoms exported so the Letter viewer can label its print-safe
 * hash of the data source without duplicating styles. */
export { SERIF as REPORT_SERIF, MONO as REPORT_MONO };
