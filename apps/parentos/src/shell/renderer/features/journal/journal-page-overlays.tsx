import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Button, DialogTitle, IconButton, OverlayShell, StatusBadge, Surface, TextField, cn } from '@nimiplatform/nimi-kit/ui';
import type { JournalEntryRow } from '../../bridge/sqlite-bridge.js';
import {
  EMOJI_CATEGORIES,
  getKeepsakeReasonLabel,
  getLocalDateKey,
  getLocalTimeLabel,
  KEEPSAKE_REASON_OPTIONS,
  parseSelectedTags,
  type EmojiCategory,
  type KeepsakeReason,
} from './journal-page-helpers.js';

export function EmojiPickerPortal({
  anchorRef, category, onCategoryChange, onSelect, onClose,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  category: EmojiCategory;
  onCategoryChange: (c: EmojiCategory) => void;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const btn = anchorRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setPos({ left: Math.max(4, r.left), top: r.bottom + 6 });
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)
        && anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorRef, onClose]);

  if (!pos) return null;

  const panelWidth = 364;
  const panelHeight = 300;
  const left = Math.min(pos.left, window.innerWidth - panelWidth - 8);
  const top = Math.max(8, Math.min(pos.top, window.innerHeight - panelHeight - 8));

  return (
    <div
      ref={panelRef}
      className="parentos-portal-frame fixed z-50"
      style={{
        '--parentos-portal-top': `${top}px`,
        '--parentos-portal-height': `${panelHeight}px`,
        '--parentos-portal-left': `${left}px`,
        '--parentos-portal-width': `${panelWidth}px`,
      } as CSSProperties}
    >
      <Surface tone="overlay" elevation="floating" padding="none" className="flex h-full flex-col overflow-hidden parentos-radius-sm">
        <div className="flex shrink-0 items-center border-b border-[var(--nimi-border-subtle)] px-1.5 pb-1 pt-1.5">
          {EMOJI_CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => onCategoryChange(cat.key)}
              title={cat.label}
              className={cn(
                'flex h-8 w-8 items-center justify-center parentos-radius-sm text-[18px] transition-colors',
                category === cat.key ? 'bg-[var(--nimi-surface-active)]' : 'hover:bg-[var(--nimi-action-ghost-hover)]',
              )}
            >
              {cat.icon}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          <div className="grid grid-cols-8 gap-0.5">
            {EMOJI_CATEGORIES.find((c) => c.key === category)?.emojis.map((emoji, index) => (
              <button
                key={`${emoji}-${index}`}
                onClick={() => onSelect(emoji)}
                className="flex h-[42px] w-[42px] items-center justify-center parentos-radius-sm text-[24px] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </Surface>
    </div>
  );
}

export function DeleteJournalEntryModal({
  entry,
  deleting,
  onCancel,
  onConfirm,
}: {
  entry: JournalEntryRow;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const previewText = entry.textContent?.trim() || '这是一条语音或图片记录。';
  const mediaCount = parseSelectedTags(entry.photoPaths).length + (entry.voicePath ? 1 : 0);

  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={onCancel}
      panelClassName="w-full max-w-[420px] parentos-radius-xl"
      contentClassName="!p-5"
    >
      <DialogTitle className="sr-only">删除随手记</DialogTitle>
      <div className="mb-4">
        <h3 aria-hidden="true" className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">删除这条随手记？</h3>
        <p className="mt-1 text-[14px] leading-relaxed text-[var(--nimi-text-muted)]">
          删除后会从列表中移除这条随手记，关联的本地语音和图片也会一起清理。
        </p>
      </div>
      <Surface tone="card" elevation="base" padding="sm" className="mb-4 parentos-radius-sm p-3">
        <p className="mb-1 text-[13px] font-medium text-[var(--nimi-text-primary)]">
          {getLocalDateKey(entry.recordedAt)} {getLocalTimeLabel(entry.recordedAt)}
        </p>
        <p className="line-clamp-3 text-[14px] leading-relaxed text-[var(--nimi-text-muted)]">{previewText}</p>
        {mediaCount > 0 ? (
          <p className="mt-2 text-[13px] text-[var(--nimi-status-warning)]">包含 {mediaCount} 个本地媒体附件</p>
        ) : null}
      </Surface>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" onClick={onCancel} disabled={deleting} tone="ghost" size="sm">
          取消
        </Button>
        <Button type="button" onClick={onConfirm} disabled={deleting} tone="danger" size="sm">
          {deleting ? '删除中...' : '确认删除'}
        </Button>
      </div>
    </OverlayShell>
  );
}

export type KeepsakePromptMode = 'enrich' | 'confirm';

export function KeepsakePromptModal({
  open,
  mode = 'enrich',
  title,
  reason,
  saving,
  onTitleChange,
  onReasonChange,
  onSkip,
  onSave,
}: {
  open: boolean;
  mode?: KeepsakePromptMode;
  title: string;
  reason: KeepsakeReason | null;
  saving: boolean;
  onTitleChange: (value: string) => void;
  onReasonChange: (value: KeepsakeReason | null) => void;
  onSkip: () => void;
  onSave: () => void;
}) {
  if (!open) return null;

  const copy = mode === 'confirm'
    ? {
        ariaLabel: '建议加入珍藏',
        heading: '要不要把这条加入珍藏？',
        bannerTitle: '看起来像一个值得珍藏的时刻',
        bannerBody: '可以顺手补充标题或原因，之后回顾会更清楚。不想收藏点"跳过"就好。',
        skipLabel: '不用',
        saveLabel: '加入珍藏',
        savingLabel: '保存中...',
      }
    : {
        ariaLabel: '补充珍藏信息',
        heading: '这条已经加入珍藏',
        bannerTitle: '补充珍藏信息',
        bannerBody: '可以顺手补充一个标题或珍藏原因，之后在回顾时会更清楚。现在跳过也没关系。',
        skipLabel: '跳过',
        saveLabel: '保存补充信息',
        savingLabel: '保存中...',
      };

  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={onSkip}
      panelClassName="flex max-h-[85vh] w-full max-w-[680px] flex-col overflow-y-auto parentos-radius-xl"
      contentClassName="!p-0 flex flex-col"
    >
      <DialogTitle className="sr-only">{copy.ariaLabel}</DialogTitle>
      <div className="flex items-center justify-between px-6 pt-6 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-[20px]">⭐</span>
          <h3 aria-hidden="true" className="text-[16px] font-bold text-[var(--nimi-text-primary)]">{copy.heading}</h3>
        </div>
        <IconButton
          type="button"
          onClick={onSkip}
          disabled={saving}
          tone="ghost"
          size="sm"
          className="h-7 min-h-0 w-7 parentos-radius-full text-[var(--nimi-text-muted)]"
          aria-label="关闭"
          title="关闭"
          icon="✕"
        />
      </div>

      <div className="px-6 pb-2 space-y-4 flex-1">
        <Surface tone="card" elevation="base" padding="sm" className="parentos-radius-sm border-[color-mix(in_srgb,var(--nimi-status-warning)_22%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,var(--nimi-surface-card))] px-4 py-3">
          <p className="text-[14px] font-medium text-[var(--nimi-status-warning)]">{copy.bannerTitle}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--nimi-text-muted)]">
            {copy.bannerBody}
          </p>
        </Surface>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1 text-[13px] text-[var(--nimi-text-muted)]">标题（可选）</p>
            <TextField
              type="text"
              value={title}
              maxLength={60}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="比如：第一次独自上台分享"
              className="w-full parentos-radius-sm text-[14px]"
            />
          </div>

          <div>
            <p className="mb-1 text-[13px] text-[var(--nimi-text-muted)]">为什么值得珍藏（可选）</p>
            <select
              value={reason ?? ''}
              onChange={(event) => onReasonChange(event.target.value ? event.target.value as KeepsakeReason : null)}
              className="min-h-[var(--nimi-sizing-field-md-height)] w-full cursor-pointer appearance-none parentos-radius-sm border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 text-[14px] text-[var(--nimi-field-text)] outline-none transition-colors focus:border-[var(--nimi-field-focus)] focus:ring-[length:var(--nimi-focus-ring-width)] focus:ring-[var(--nimi-focus-ring-color)]"
            >
              <option value="">暂不选择</option>
              {KEEPSAKE_REASON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        {reason ? (
          <div className="flex justify-start">
            <StatusBadge tone="warning" className="parentos-radius-full px-2.5 py-1 text-[12px] font-medium">
              {getKeepsakeReasonLabel(reason)}
            </StatusBadge>
          </div>
        ) : null}
      </div>

      <div className="mt-1 px-6 pt-3 pb-5">
        <div className="flex items-center justify-end gap-2">
          <Button type="button" onClick={onSkip} disabled={saving} tone="ghost" size="sm" className="parentos-radius-sm px-4 py-2 text-[14px]">
            {copy.skipLabel}
          </Button>
          <Button type="button" onClick={onSave} disabled={saving} tone="primary" size="sm" className="parentos-radius-sm px-5 py-2 text-[14px] font-medium">
            {saving ? copy.savingLabel : copy.saveLabel}
          </Button>
        </div>
      </div>
    </OverlayShell>
  );
}
