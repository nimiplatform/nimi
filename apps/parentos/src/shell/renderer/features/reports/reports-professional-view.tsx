import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton, Surface, TextareaField, Toggle as KitToggle } from '@nimiplatform/kit/ui';
import { Pencil, X } from 'lucide-react';
import type { NarrativeReportContent, ProfessionalSummary, ProfessionalSummarySection } from './structured-report.js';

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
    <span aria-label={ariaLabel} className="inline-flex shrink-0">
      <KitToggle checked={checked} onChange={onChange} />
    </span>
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
    <Surface
      as="article"
      tone={section.enabled ? 'card' : 'panel'}
      elevation="base"
      padding="none"
      className={`report-professional-section ${section.enabled ? '' : 'report-professional-section--disabled'}`}
    >
      <header className="report-professional-section-header">
        <h4 className="report-professional-section-title">
          {section.title}
          {isEdited ? (
            <span className="report-professional-edited">
              · 已编辑
            </span>
          ) : null}
        </h4>
        <span className="report-professional-toggle-label">{section.enabled ? '包含' : '隐藏'}</span>
        <Toggle checked={section.enabled} onChange={onToggle} ariaLabel={`是否包含 ${section.title} 到分享版本`} />
      </header>

      {editing ? (
        <>
          <TextareaField
            ref={ref}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="report-radius-sm"
            textareaClassName="report-professional-textarea"
          />
          <div className="mt-2.5 flex gap-2">
            <Button size="sm" tone="primary" onClick={save}>
              保存
            </Button>
            <Button size="sm" tone="ghost" onClick={() => { setDraft(section.body); setEditing(false); }}>
              取消
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="report-professional-section-body">
            {section.body || '本期未记录。'}
          </p>
          {section.enabled ? (
            <div className="report-professional-section-actions">
              <Button size="sm" tone="secondary" onClick={start} className="min-h-0 px-3 py-1 text-xs" leadingIcon={<Pencil size={11} />}>
                编辑
              </Button>
              {isEdited ? (
                <Button size="sm" tone="ghost" onClick={onRestore} className="min-h-0 px-3 py-1 text-[11.5px]">
                  恢复 AI 原文
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </Surface>
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
      className="report-professional-backdrop"
      onClick={onClose}
    >
      <Surface
        tone="overlay"
        elevation="modal"
        padding="none"
        onClick={(e) => e.stopPropagation()}
        className="report-professional-modal"
      >
        <header className="report-professional-modal-header">
          <div>
            <div className="report-professional-eyebrow">
              SHARE · 给老师 / 医生
            </div>
            <h2 id="pro-summary-title" className="report-professional-title">
              精简版 · {title}
            </h2>
            {summary?.childSummary ? (
              <div className="report-professional-child-summary">{summary.childSummary}</div>
            ) : null}
          </div>
          <IconButton onClick={onClose} aria-label="关闭" icon={<X size={18} />} size="sm" tone="ghost" />
        </header>

        <div className="report-professional-modal-body">
          {summary ? (
            <>
              <div className="report-professional-intro">
                <span className="report-strong">精简版说明：</span>
                AI 按客观医学/教育记录语气生成，家长可逐条编辑或隐去敏感内容；未勾选的 section 不会出现在导出或复制内容里。
              </div>
              <div className="report-professional-section-list">
                {summary.sections.map((s) => (
                  <ProfessionalSectionEditor key={s.id} section={s}
                    onBodyChange={(body) => applySummary(updateSection(summary, s.id, { body }))}
                    onToggle={(enabled) => applySummary(updateSection(summary, s.id, { enabled }))}
                    onRestore={() => applySummary(restoreSectionToAi(summary, s.id))} />
                ))}
              </div>
            </>
          ) : (
            <div className="report-professional-empty">
              此报告还没有精简版内容。
              <br />
              请回到报告页「高级选项 · 生成综合报告」重新生成一次，AI 会同时产出精简版。
            </div>
          )}
        </div>

        <footer className="report-professional-modal-footer">
          {summary?.disclaimer ? (
            <div className="report-professional-disclaimer">
              {summary.disclaimer}
            </div>
          ) : <div className="report-professional-footer-spacer" />}
          <Button onClick={handleCopy} disabled={!summary} size="sm" tone="secondary">
            {copyToast ?? '复制精简版'}
          </Button>
          <Button onClick={onPrint} disabled={!summary || !onPrint} size="sm" tone="primary">
            另存为 PDF
          </Button>
        </footer>
      </Surface>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(content_node, document.body);
}
