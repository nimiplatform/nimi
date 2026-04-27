import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { S } from '../../app-shell/page-style.js';
import type { JournalEntryRow } from '../../bridge/sqlite-bridge.js';
import {
  EMOJI_CATEGORIES,
  getKeepsakeReasonLabel,
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
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

  useEffect(() => {
    const btn = anchorRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setPos({ left: Math.max(4, r.left), bottom: window.innerHeight - r.top + 6 });
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

  const panelWidth = 290;
  const panelHeight = 260;
  const left = Math.min(pos.left, window.innerWidth - panelWidth - 8);
  const bottom = Math.min(pos.bottom, window.innerHeight - panelHeight - 8);

  return (
    <div
      ref={panelRef}
      className={`fixed z-50 flex flex-col ${S.radiusSm} shadow-xl overflow-hidden`}
      style={{ background: S.card, border: `1px solid ${S.border}`, width: panelWidth, height: panelHeight, left, bottom }}
    >
      <div className="flex items-center px-1.5 pt-1.5 pb-1 border-b shrink-0" style={{ borderColor: S.border }}>
        {EMOJI_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => onCategoryChange(cat.key)}
            title={cat.label}
            className={`w-7 h-7 rounded flex items-center justify-center text-[16px] transition-colors ${category === cat.key ? 'bg-[#e8e8e4]' : 'hover:bg-[#f0f0ec]'}`}
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
              className="w-[34px] h-[34px] rounded flex items-center justify-center text-[18px] hover:bg-[#f0f0ec] transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
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

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--nimi-scrim-modal)] p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="删除随手记"
        className={`${S.radius} w-full max-w-[420px] p-5`}
        style={{ background: S.card, boxShadow: S.shadow }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-[16px] font-semibold" style={{ color: S.text }}>删除这条随手记？</h3>
          <p className="mt-1 text-[14px] leading-relaxed" style={{ color: S.sub }}>
            删除后会从列表中移除这条随手记，关联的本地语音和图片也会一起清理。
          </p>
        </div>
        <div className={`${S.radiusSm} mb-4 p-3`} style={{ background: '#fafaf8', border: `1px solid ${S.border}` }}>
          <p className="mb-1 text-[13px] font-medium" style={{ color: S.text }}>
            {entry.recordedAt.split('T')[0]} {entry.recordedAt.split('T')[1]?.slice(0, 5)}
          </p>
          <p className="line-clamp-3 text-[14px] leading-relaxed" style={{ color: S.sub }}>{previewText}</p>
          {mediaCount > 0 ? (
            <p className="mt-2 text-[13px]" style={{ color: '#b45309' }}>包含 {mediaCount} 个本地媒体附件</p>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className={`${S.radiusSm} px-4 py-2 text-[14px] transition-colors disabled:opacity-50`}
            style={{ background: '#f3f4f6', color: S.sub }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className={`${S.radiusSm} px-4 py-2 text-[14px] font-medium text-white transition-colors disabled:opacity-50`}
            style={{ background: '#dc2626' }}
          >
            {deleting ? '删除中...' : '确认删除'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--nimi-scrim-modal)' }}
      onClick={onSkip}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={copy.ariaLabel}
        className={`w-full max-w-[680px] max-h-[85vh] overflow-y-auto ${S.radius} flex flex-col shadow-xl`}
        style={{ background: S.card }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-[20px]">⭐</span>
            <h3 className="text-[16px] font-bold" style={{ color: S.text }}>{copy.heading}</h3>
          </div>
          <button
            type="button"
            onClick={onSkip}
            disabled={saving}
            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[#f0f0ec] disabled:opacity-50"
            style={{ color: S.sub }}
            aria-label="关闭"
            title="关闭"
          >
            ✕
          </button>
        </div>

        <div className="px-6 pb-2 space-y-4 flex-1">
          <div
            className={`${S.radiusSm} px-4 py-3`}
            style={{ background: '#fff8eb', border: '1px solid rgba(245, 158, 11, 0.18)' }}
          >
            <p className="text-[14px] font-medium" style={{ color: '#92400e' }}>{copy.bannerTitle}</p>
            <p className="mt-1 text-[13px] leading-relaxed" style={{ color: S.sub }}>
              {copy.bannerBody}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-[13px]" style={{ color: S.sub }}>标题（可选）</p>
              <input
                type="text"
                value={title}
                maxLength={60}
                onChange={(event) => onTitleChange(event.target.value)}
                placeholder="比如：第一次独自上台分享"
                className={`${S.radiusSm} w-full px-3 py-2 text-[14px] border-0 outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50`}
                style={{ background: '#fafaf8', color: S.text }}
              />
            </div>

            <div>
              <p className="mb-1 text-[13px]" style={{ color: S.sub }}>为什么值得珍藏（可选）</p>
              <select
                value={reason ?? ''}
                onChange={(event) => onReasonChange(event.target.value ? event.target.value as KeepsakeReason : null)}
                className={`${S.radiusSm} w-full px-3 py-2 text-[14px] border-0 outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50`}
                style={{ background: '#fafaf8', color: S.text }}
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
              <span
                className="rounded-full px-2.5 py-1 text-[12px] font-medium"
                style={{ background: '#fef3c7', color: '#a16207' }}
              >
                {getKeepsakeReasonLabel(reason)}
              </span>
            </div>
          ) : null}
        </div>

        <div className="mt-1 px-6 pt-3 pb-5">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onSkip}
              disabled={saving}
              className={`px-4 py-2 text-[14px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4] disabled:opacity-50`}
              style={{ background: '#f0f0ec', color: S.sub }}
            >
              {copy.skipLabel}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className={`px-5 py-2 text-[14px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110 disabled:opacity-50`}
              style={{ background: S.accent }}
            >
              {saving ? copy.savingLabel : copy.saveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
