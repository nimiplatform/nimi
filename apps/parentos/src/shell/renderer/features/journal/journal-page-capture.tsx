import { createPortal } from 'react-dom';
import type { RefObject } from 'react';
import { AppSelect } from '../../app-shell/app-select.js';
import { S } from '../../app-shell/page-style.js';
import { PhotoBar, VoiceCapture } from './journal-sub-components.js';
import {
  type EmojiCategory,
  type KeepsakeReason,
  KEEPSAKE_REASON_OPTIONS,
  getKeepsakeReasonLabel,
  type PhotoDraft,
  type VoiceDraft,
} from './journal-page-helpers.js';
import type { GuidedPromptContext } from './journal-guided-prompts.js';
import type { ExperimentTemplate } from './journal-experiment-templates.js';
import type { JournalEntryRow } from '../../bridge/sqlite-bridge.js';
import type { JournalLocalDraftRecord } from './journal-page-local-draft.js';
import { formatJournalDraftTime } from './journal-page-local-draft.js';
import { EmojiPickerPortal } from './journal-page-overlays.js';

export function JournalPageCapture(props: {
  activeChildId: string | null;
  childOptions: Array<{ value: string; label: string }>;
  onChildChange: (value: string | null) => void;
  guidedContext: GuidedPromptContext | null;
  restorableDraft: JournalLocalDraftRecord | null;
  editingEntry: JournalEntryRow | null;
  editingEntryLabel: string | null;
  onDiscardLocalDraft: () => void;
  onRestoreLocalDraft: (draft: JournalLocalDraftRecord) => void;
  onResetComposer: () => void;
  onClearReminderSearchParams: () => void;
  captureMode: 'text' | 'voice';
  onCaptureModeChange: (value: 'text' | 'voice') => void;
  textContent: string;
  onTextContentChange: (value: string) => void;
  photoInputRef: RefObject<HTMLInputElement | null>;
  onAddPhotos: (files: FileList | null) => void;
  photoDrafts: PhotoDraft[];
  onRemovePhotoDraft: (index: number) => void;
  keepsakeSuggestion: string | null;
  onToggleKeepsake: () => void;
  keepsake: boolean;
  keepsakeTitle: string;
  onKeepsakeTitleChange: (value: string) => void;
  keepsakeReason: KeepsakeReason | null;
  onKeepsakeReasonChange: (value: KeepsakeReason | null) => void;
  showEmoji: boolean;
  onShowEmojiChange: (value: boolean) => void;
  emojiBtnRef: RefObject<HTMLButtonElement | null>;
  emojiCat: EmojiCategory;
  onEmojiCategoryChange: (value: EmojiCategory) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  draftStatusLabel: string | null;
  saving: boolean;
  canSaveText: boolean;
  canSaveVoice: boolean;
  editingEntryId: string | null;
  onRequestSave: () => void;
  voiceDraft: VoiceDraft;
  recordingSupported: boolean;
  voiceRuntimeAvailable: boolean | null;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onTranscribe: () => void;
  onClearVoiceDraft: () => void;
  onVoiceTranscriptChange: (value: string) => void;
  submitError: string | null;
  postSaveExperiment: ExperimentTemplate | null;
  addingTodo: boolean;
  onAddExperimentTodo: () => void;
  onDismissExperiment: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold" style={{ color: S.text }}>成长随记</h1>
        {props.childOptions.length > 1 ? (
          <AppSelect value={props.activeChildId ?? ''} onChange={(value) => props.onChildChange(value || null)} options={props.childOptions} />
        ) : null}
      </div>

      <div className="relative mb-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-4"
          style={{
            background: 'radial-gradient(ellipse at 30% 50%, rgba(129,140,248,0.12) 0%, transparent 60%), radial-gradient(ellipse at 70% 60%, rgba(244,163,196,0.10) 0%, transparent 55%)',
            filter: 'blur(40px)',
            zIndex: 0,
          }}
        />
        <section
          className="relative overflow-hidden nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] shadow-[0_8px_32px_rgba(31,38,135,0.06),0_1.5px_0_rgba(255,255,255,0.7)_inset] rounded-[24px]"
          style={{ zIndex: 1 }}
        >
          <input
            ref={props.photoInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => { props.onAddPhotos(event.target.files); event.target.value = ''; }}
          />

          {props.restorableDraft && !props.editingEntry ? (
            <div className="px-5 pt-4 pb-0">
              <div
                className={`${S.radiusSm} flex flex-wrap items-center justify-between gap-3 px-3 py-3`}
                style={{ background: 'linear-gradient(135deg, #f6f8ea 0%, #fbfcf5 100%)', border: `1px solid ${S.accent}35` }}
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[12px]"
                    style={{ background: `${S.accent}20`, color: S.accent }}
                  >
                    草
                  </div>
                  <div>
                    <p className="text-[12px] font-medium" style={{ color: S.text }}>发现一条未完成的随手记</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: S.sub }}>
                      内容已帮你暂存在本地
                      {props.restorableDraft.updatedAt ? `，上次保存于 ${formatJournalDraftTime(props.restorableDraft.updatedAt)}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={props.onDiscardLocalDraft}
                    className={`${S.radiusSm} px-3 py-1.5 text-[11px] transition-colors`}
                    style={{ background: '#f5f3ef', color: S.sub }}
                  >
                    放弃草稿
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onRestoreLocalDraft(props.restorableDraft!)}
                    className={`${S.radiusSm} px-3 py-1.5 text-[11px] font-medium text-white`}
                    style={{ background: S.accent }}
                  >
                    继续编辑
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {props.editingEntryLabel ? (
            <div className="px-5 pt-4 pb-3" style={{ borderBottom: `1px solid ${S.border}` }}>
              <div className={`${S.radiusSm} flex items-center justify-between gap-3 px-3 py-2`} style={{ background: '#fafaf8', border: `1px solid ${S.border}` }}>
                <p className="text-[12px]" style={{ color: S.text }}>正在编辑 {props.editingEntryLabel} 的记录</p>
                <button
                  type="button"
                  onClick={() => {
                    props.onResetComposer();
                    props.onClearReminderSearchParams();
                  }}
                  className="text-[11px] underline"
                  style={{ color: S.sub }}
                >
                  取消编辑
                </button>
              </div>
            </div>
          ) : null}

          {props.captureMode === 'text' ? (
            <>
              {props.guidedContext ? (
                <div className="mx-5 mt-5 mb-2 rounded-[14px] p-4" style={{ background: '#f6f8f5' }}>
                  <p className="text-[13px] font-semibold" style={{ color: S.text }}>
                    📋 {props.guidedContext.title}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed" style={{ color: S.sub }}>
                    {props.guidedContext.description}
                  </p>
                  <div className="mt-3 space-y-2">
                    {props.guidedContext.prompts.map((prompt, index) => (
                      <div key={index} className="flex gap-2 text-[12px] leading-relaxed" style={{ color: S.text }}>
                        <span className="shrink-0 text-[11px] font-medium" style={{ color: S.accent }}>{index + 1}.</span>
                        <span>{prompt}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="px-5 pt-5 pb-2">
                  <div className="flex items-start gap-2.5 rounded-[12px] px-3.5 py-2.5" style={{ background: '#f8f9fa' }}>
                    <svg className="mt-[1px] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
                      <path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" />
                    </svg>
                    <p className="text-[12px] font-medium leading-relaxed" style={{ color: '#475569' }}>
                      不用管对错，像讲故事一样，描述一下孩子刚才的行为细节吧
                    </p>
                  </div>
                </div>
              )}

              <textarea
                ref={props.textareaRef}
                value={props.textContent}
                onChange={(event) => props.onTextContentChange(event.target.value)}
                placeholder={props.guidedContext ? '参考上面的引导问题，记录你观察到的情况...' : '他刚刚做了什么？说了什么？如果遇到了困难，他是如何解决的...'}
                className="w-full resize-none px-5 py-3 text-[13px] leading-relaxed outline-none"
                style={{ background: 'transparent', minHeight: 120, border: 'none' }}
                rows={5}
              />

              {props.photoDrafts.length > 0 ? (
                <div className="px-5 pb-2">
                  <PhotoBar drafts={props.photoDrafts} onAdd={props.onAddPhotos} onRemove={props.onRemovePhotoDraft} inputRef={props.photoInputRef} />
                </div>
              ) : null}

              {props.keepsakeSuggestion ? (
                <div className="px-5 pb-2">
                  <div className={`${S.radiusSm} flex items-center justify-between gap-3 px-3 py-2.5`} style={{ background: '#fff8eb', border: '1px solid rgba(245, 158, 11, 0.28)' }}>
                    <p className="text-[11px] leading-relaxed" style={{ color: '#92400e' }}>{props.keepsakeSuggestion}</p>
                    <button
                      type="button"
                      onClick={props.onToggleKeepsake}
                      className="shrink-0 rounded-full px-3 py-1 text-[11px] font-medium text-white"
                      style={{ background: '#f59e0b' }}
                    >
                      标记珍藏
                    </button>
                  </div>
                </div>
              ) : null}

              {props.keepsake ? (
                <div className="px-5 pb-2">
                  <div className={`${S.radiusSm} space-y-3 px-3 py-3`} style={{ background: '#fff8eb', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-medium" style={{ color: '#92400e' }}>珍藏补充信息</p>
                        <p className="mt-1 text-[11px] leading-relaxed" style={{ color: S.sub }}>
                          可以跳过，之后也能回来补充。
                        </p>
                      </div>
                      {props.keepsakeReason ? (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: '#fef3c7', color: '#a16207' }}>
                          {getKeepsakeReasonLabel(props.keepsakeReason)}
                        </span>
                      ) : null}
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium" style={{ color: S.text }}>标题（可选）</span>
                      <input
                        type="text"
                        value={props.keepsakeTitle}
                        maxLength={60}
                        onChange={(event) => props.onKeepsakeTitleChange(event.target.value)}
                        placeholder="比如：第一次独立完成早餐"
                        className={`${S.radiusSm} w-full px-3 py-2 text-[12px] outline-none`}
                        style={{ border: `1px solid ${S.border}`, background: '#fff' }}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium" style={{ color: S.text }}>为什么值得珍藏（可选）</span>
                      <select
                        value={props.keepsakeReason ?? ''}
                        onChange={(event) => props.onKeepsakeReasonChange(event.target.value ? event.target.value as KeepsakeReason : null)}
                        className={`${S.radiusSm} w-full px-3 py-2 text-[12px] outline-none`}
                        style={{ border: `1px solid ${S.border}`, background: '#fff' }}
                      >
                        <option value="">暂不选择</option>
                        {KEEPSAKE_REASON_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              ) : null}

              <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: 'rgba(250,250,248,0.65)', borderTop: '1px solid rgba(0,0,0,0.04)', boxShadow: '0 -1px 3px rgba(0,0,0,0.02) inset', borderRadius: '0 0 24px 24px' }}>
                <button
                  type="button"
                  onClick={() => props.onCaptureModeChange('voice')}
                  className={`${S.radiusSm} px-3 py-1.5 text-[11px] flex items-center gap-1.5 transition-colors hover:bg-[#f0f0ec]`}
                  style={{ background: '#f5f3ef', color: S.sub }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                  语音记事
                </button>
                <button
                  type="button"
                  onClick={() => props.photoInputRef.current?.click()}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#f0f0ec]"
                  style={{ color: S.sub }}
                  title="添加图片"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
                  </svg>
                </button>
                <button
                  ref={props.emojiBtnRef}
                  type="button"
                  onClick={() => props.onShowEmojiChange(!props.showEmoji)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#f0f0ec]"
                  style={{ color: S.sub }}
                  title="表情"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
                  </svg>
                </button>
                {props.showEmoji ? createPortal(
                  <EmojiPickerPortal
                    anchorRef={props.emojiBtnRef}
                    category={props.emojiCat}
                    onCategoryChange={props.onEmojiCategoryChange}
                    onSelect={(emoji) => {
                      props.onTextContentChange(props.textContent + emoji);
                      props.onShowEmojiChange(false);
                      props.textareaRef.current?.focus();
                    }}
                    onClose={() => props.onShowEmojiChange(false)}
                  />,
                  document.body,
                ) : null}
                <button
                  type="button"
                  onClick={props.onToggleKeepsake}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#f0f0ec]"
                  style={{ color: props.keepsake ? '#f59e0b' : S.sub }}
                  title="珍藏"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill={props.keepsake ? '#f59e0b' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
                {props.editingEntryId ? (
                  <button
                    type="button"
                    onClick={() => {
                      props.onResetComposer();
                      props.onClearReminderSearchParams();
                    }}
                    className={`${S.radiusSm} px-3 py-1.5 text-[11px] transition-colors`}
                    style={{ background: '#f5f3ef', color: S.sub }}
                  >
                    取消编辑
                  </button>
                ) : null}
                {props.draftStatusLabel ? (
                  <span className="text-[10px]" style={{ color: props.draftStatusLabel === '未保存' ? '#b45309' : S.sub }}>
                    {props.draftStatusLabel}
                  </span>
                ) : null}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={props.onRequestSave}
                  disabled={props.saving || !props.canSaveText}
                  className={`${S.radiusSm} px-5 py-2 text-[12px] font-medium transition-colors`}
                  style={props.canSaveText
                    ? { background: S.accent, color: '#fff', boxShadow: '0 2px 8px rgba(78,204,163,0.25)' }
                    : { background: '#ededeb', color: '#a1a1aa', border: '1px solid rgba(0,0,0,0.04)' }}
                >
                  {props.saving ? '保存中...' : props.editingEntryId ? '保存修改' : '保存'}
                </button>
              </div>
            </>
          ) : (
            <div className="p-5">
              {props.voiceDraft.status === 'idle' ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <button
                    type="button"
                    onClick={props.onStartRecording}
                    disabled={!props.recordingSupported}
                    className="w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
                    style={{ background: S.accent, color: '#fff' }}
                  >
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" />
                    </svg>
                  </button>
                  <p className="text-[12px]" style={{ color: S.sub }}>点击开始语音记录</p>
                  <button type="button" onClick={() => { props.onCaptureModeChange('text'); props.onClearVoiceDraft(); }} className="text-[11px] underline" style={{ color: S.sub }}>
                    切换文字输入
                  </button>
                  {!props.recordingSupported ? <p className="text-[10px] text-red-500">当前环境不支持录音</p> : null}
                </div>
              ) : (
                <VoiceCapture
                  voiceDraft={props.voiceDraft}
                  recordingSupported={props.recordingSupported}
                  voiceRuntimeAvailable={props.voiceRuntimeAvailable}
                  onStart={props.onStartRecording}
                  onStop={props.onStopRecording}
                  onTranscribe={props.onTranscribe}
                  onClear={() => { props.onClearVoiceDraft(); props.onCaptureModeChange('text'); }}
                  onTranscriptChange={props.onVoiceTranscriptChange}
                />
              )}
              {props.keepsakeSuggestion ? (
                <div className="mb-3 rounded-[12px] px-3 py-2.5" style={{ background: '#fff8eb', border: '1px solid rgba(245, 158, 11, 0.28)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] leading-relaxed" style={{ color: '#92400e' }}>{props.keepsakeSuggestion}</p>
                    <button
                      type="button"
                      onClick={props.onToggleKeepsake}
                      className="shrink-0 rounded-full px-3 py-1 text-[11px] font-medium text-white"
                      style={{ background: '#f59e0b' }}
                    >
                      标记珍藏
                    </button>
                  </div>
                </div>
              ) : null}
              {props.keepsake ? (
                <div className="mb-3 rounded-[14px] px-3 py-3" style={{ background: '#fff8eb', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[12px] font-medium" style={{ color: '#92400e' }}>珍藏补充信息</p>
                      <p className="mt-1 text-[11px] leading-relaxed" style={{ color: S.sub }}>
                        标记珍藏后可以顺手补充标题或原因，也可以先跳过。
                      </p>
                    </div>
                    {props.keepsakeReason ? (
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: '#fef3c7', color: '#a16207' }}>
                        {getKeepsakeReasonLabel(props.keepsakeReason)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 space-y-3">
                    <input
                      type="text"
                      value={props.keepsakeTitle}
                      maxLength={60}
                      onChange={(event) => props.onKeepsakeTitleChange(event.target.value)}
                      placeholder="比如：第一次独自上台分享"
                      className={`${S.radiusSm} w-full px-3 py-2 text-[12px] outline-none`}
                      style={{ border: `1px solid ${S.border}`, background: '#fff' }}
                    />
                    <select
                      value={props.keepsakeReason ?? ''}
                      onChange={(event) => props.onKeepsakeReasonChange(event.target.value ? event.target.value as KeepsakeReason : null)}
                      className={`${S.radiusSm} w-full px-3 py-2 text-[12px] outline-none`}
                      style={{ border: `1px solid ${S.border}`, background: '#fff' }}
                    >
                      <option value="">暂不选择珍藏原因</option>
                      {KEEPSAKE_REASON_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : null}
              <div className="flex items-center justify-between mt-4">
                <button
                  type="button"
                  onClick={props.onToggleKeepsake}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#f0f0ec]"
                  style={{ color: props.keepsake ? '#f59e0b' : S.sub }}
                  title="珍藏"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill={props.keepsake ? '#f59e0b' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
                {props.editingEntryId ? (
                  <button
                    type="button"
                    onClick={() => {
                      props.onResetComposer();
                      props.onClearReminderSearchParams();
                    }}
                    className={`${S.radiusSm} px-3 py-1.5 text-[11px] transition-colors`}
                    style={{ background: '#f5f3ef', color: S.sub }}
                  >
                    取消编辑
                  </button>
                ) : null}
                {props.draftStatusLabel ? (
                  <span className="text-[10px]" style={{ color: props.draftStatusLabel === '未保存' ? '#b45309' : S.sub }}>
                    {props.draftStatusLabel}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={props.onRequestSave}
                  disabled={props.saving || !props.canSaveVoice}
                  className={`${S.radiusSm} px-5 py-2 text-[12px] font-medium text-white disabled:opacity-50`}
                  style={{ background: S.accent }}
                >
                  {props.saving ? '保存中...' : props.editingEntryId ? '保存修改' : '保存'}
                </button>
              </div>
            </div>
          )}

          {props.submitError ? <p className="text-[11px] px-5 pb-3 text-red-500">{props.submitError}</p> : null}
        </section>
      </div>

      {props.postSaveExperiment ? (
        <section className="mx-5 mb-4 rounded-[14px] p-4" style={{ background: '#f8faf0', border: `1px solid ${S.accent}30` }}>
          <p className="text-[12px] font-medium mb-2" style={{ color: S.text }}>
            试试这个小实验
          </p>
          <p className="text-[12px] leading-relaxed mb-3" style={{ color: S.text }}>
            {props.postSaveExperiment.title}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={props.onAddExperimentTodo}
              disabled={props.addingTodo}
              className="rounded-full px-3.5 py-1.5 text-[11px] font-medium transition-opacity disabled:opacity-50"
              style={{ background: S.accent, color: '#fff' }}
            >
              {props.addingTodo ? '添加中...' : '添加到待办'}
            </button>
            <button
              type="button"
              onClick={props.onDismissExperiment}
              className="rounded-full px-3 py-1.5 text-[11px] transition-colors hover:bg-black/[0.04]"
              style={{ color: S.sub }}
            >
              跳过
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
