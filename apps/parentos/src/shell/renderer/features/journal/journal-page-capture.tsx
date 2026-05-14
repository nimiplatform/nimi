import { createPortal } from 'react-dom';
import type { RefObject } from 'react';
import { Button, IconButton, Surface, TextareaField, cn, type SelectFieldOption } from '@nimiplatform/nimi-kit/ui';
import { AppSelect } from '../../app-shell/app-select.js';
import { PhotoBar } from './journal-sub-components.js';
import { VoiceIdleEntry, VoiceRecordingPanel, VoicePreviewPanel } from './journal-voice-card.js';
import type { VoiceRecordingSession } from './voice-observation-recorder.js';
import {
  type EmojiCategory,
  type PhotoDraft,
  type VoiceDraft,
} from './journal-page-helpers.js';
import type { GuidedPromptContext } from './journal-guided-prompts.js';
import type { ExperimentTemplate } from './journal-experiment-templates.js';
import type { JournalEntryRow } from '../../bridge/sqlite-bridge.js';
import type { JournalLocalDraftRecord } from './journal-page-local-draft.js';
import { formatJournalDraftTime } from './journal-page-local-draft.js';
import { EmojiPickerPortal } from './journal-page-overlays.js';
import { ObservationFocusPanel, type ObservationFocusData, type ObservationFocusOption } from './journal-observation-focus.js';
import { RecordedAtPicker } from './journal-recorded-at-picker.js';

export function JournalPageCapture(props: {
  activeChildId: string | null;
  childOptions: SelectFieldOption[];
  onChildChange: (value: string | null) => void;
  guidedContext: GuidedPromptContext | null;
  observationFocus: ObservationFocusData | null;
  observationFocusOptions: ObservationFocusOption[];
  onSwitchObservationFocus: (dimensionId: string) => void;
  onClearObservationFocus: () => void;
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
  onToggleKeepsake: () => void;
  keepsake: boolean;
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
  recorderSessionRef: RefObject<VoiceRecordingSession | null>;
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
  recordedAt: string | null;
  onRecordedAtChange: (value: string | null) => void;
}) {
  return (
    <>
      <div
        className={cn(
          'mb-5 grid items-center gap-4',
          props.childOptions.length > 1 ? 'grid-cols-[auto_minmax(9rem,13.5rem)]' : 'grid-cols-1',
        )}
      >
        <h1 className="shrink-0 text-xl font-bold text-[var(--nimi-text-primary)]">成长随记</h1>
        {props.childOptions.length > 1 ? (
          <AppSelect
            value={props.activeChildId ?? ''}
            onChange={(value) => props.onChildChange(value || null)}
            options={props.childOptions}
            aria-label="切换成长随记孩子"
            className="w-full"
          />
        ) : null}
      </div>

      <div className="relative mb-6">
        <div
          aria-hidden
          className="journal-capture-glow pointer-events-none absolute -inset-4"
        />
        <Surface
          as="section"
          tone="card"
          material="glass-regular"
          elevation="raised"
          padding="none"
          className="journal-capture-surface relative overflow-hidden parentos-radius-xl"
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
              <Surface
                tone="card"
                elevation="base"
                padding="sm"
                className="flex flex-wrap items-center justify-between gap-3 parentos-radius-sm border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_26%,var(--nimi-border-subtle))] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--nimi-action-primary-bg)_9%,var(--nimi-surface-card))_0%,var(--nimi-surface-card)_100%)] px-3 py-3"
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)] text-[14px] text-[var(--nimi-action-primary-bg)]"
                  >
                    草
                  </div>
                  <div>
                    <p className="text-[14px] font-medium text-[var(--nimi-text-primary)]">发现一条未完成的随手记</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--nimi-text-muted)]">
                      内容已帮你暂存在本地
                      {props.restorableDraft.updatedAt ? `，上次保存于 ${formatJournalDraftTime(props.restorableDraft.updatedAt)}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" onClick={props.onDiscardLocalDraft} tone="ghost" size="sm" className="min-h-0 parentos-radius-sm px-3 py-1.5 text-[13px]">
                    放弃草稿
                  </Button>
                  <Button type="button" onClick={() => props.onRestoreLocalDraft(props.restorableDraft!)} tone="primary" size="sm" className="min-h-0 parentos-radius-sm px-3 py-1.5 text-[13px] font-medium">
                    继续编辑
                  </Button>
                </div>
              </Surface>
            </div>
          ) : null}

          {props.editingEntryLabel ? (
            <div className="border-b border-[var(--nimi-border-subtle)] px-5 pb-3 pt-4">
              <Surface tone="card" elevation="base" padding="sm" className="flex items-center justify-between gap-3 parentos-radius-sm px-3 py-2">
                <p className="text-[14px] text-[var(--nimi-text-primary)]">正在编辑 {props.editingEntryLabel} 的记录</p>
                <button
                  type="button"
                  onClick={() => {
                    props.onResetComposer();
                    props.onClearReminderSearchParams();
                  }}
                  className="text-[13px] text-[var(--nimi-text-muted)] underline"
                >
                  取消编辑
                </button>
              </Surface>
            </div>
          ) : null}

          {props.captureMode === 'text' ? (
            <>
              {props.guidedContext ? (
                <Surface tone="panel" elevation="base" padding="md" className="mx-5 mb-2 mt-5 parentos-radius-14 border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,var(--nimi-surface-panel))] p-4">
                  <p className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">
                    📋 {props.guidedContext.title}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--nimi-text-muted)]">
                    {props.guidedContext.description}
                  </p>
                  <div className="mt-3 space-y-2">
                    {props.guidedContext.prompts.map((prompt, index) => (
                      <div key={index} className="flex gap-2 text-[14px] leading-relaxed text-[var(--nimi-text-primary)]">
                        <span className="shrink-0 text-[13px] font-medium text-[var(--nimi-action-primary-bg)]">{index + 1}.</span>
                        <span>{prompt}</span>
                      </div>
                    ))}
                  </div>
                </Surface>
              ) : props.observationFocus ? (
                <ObservationFocusPanel
                  focus={props.observationFocus}
                  options={props.observationFocusOptions}
                  onSwitchDimension={props.onSwitchObservationFocus}
                  onClose={props.onClearObservationFocus}
                />
              ) : (
                <div className="px-5 pt-5 pb-2">
                  <Surface tone="panel" elevation="base" padding="sm" className="flex items-start gap-2.5 parentos-radius-md px-3.5 py-2.5">
                    <svg className="mt-[1px] shrink-0 text-[var(--nimi-text-muted)]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
                      <path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" />
                    </svg>
                    <p className="text-[14px] font-medium leading-relaxed text-[var(--nimi-text-secondary)]">
                      不用管对错，像讲故事一样，描述一下孩子刚才的行为细节吧
                    </p>
                  </Surface>
                </div>
              )}

              <TextareaField
                ref={props.textareaRef}
                value={props.textContent}
                onChange={(event) => props.onTextContentChange(event.target.value)}
                placeholder={props.guidedContext || props.observationFocus ? '参考上面的引导问题，记录你观察到的情况...' : '他刚刚做了什么？说了什么？如果遇到了困难，他是如何解决的...'}
                tone="quiet"
                className="w-full border-0 bg-transparent px-5 py-0 text-[14px] leading-relaxed"
                textareaClassName="min-h-[120px] resize-none px-0 py-3"
                rows={5}
              />

              {props.photoDrafts.length > 0 ? (
                <div className="px-5 pb-2">
                  <PhotoBar drafts={props.photoDrafts} onAdd={props.onAddPhotos} onRemove={props.onRemovePhotoDraft} inputRef={props.photoInputRef} />
                </div>
              ) : null}

              <div className="flex items-center gap-2 parentos-radius-b-xl border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_60%,transparent)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_72%,transparent)] px-4 py-2.5 shadow-[inset_0_-1px_3px_color-mix(in_srgb,var(--nimi-text-primary)_2%,transparent)]">
                <Button
                  type="button"
                  onClick={() => props.onCaptureModeChange('voice')}
                  tone="secondary"
                  size="sm"
                  className="voice-note-btn min-h-0 parentos-radius-sm px-3 py-1.5 text-[13px] text-[var(--nimi-text-muted)]"
                  leadingIcon={
                    <span className="voice-note-btn__icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" />
                      </svg>
                    </span>
                  }
                >
                  <span className="voice-note-btn__ripple" aria-hidden="true" />
                  语音记事
                </Button>
                <IconButton
                  type="button"
                  onClick={() => props.photoInputRef.current?.click()}
                  tone="ghost"
                  size="sm"
                  className="h-8 min-h-0 w-8 parentos-radius-sm text-[var(--nimi-text-muted)]"
                  title="添加图片"
                  icon={
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
                    </svg>
                  }
                />
                <IconButton
                  ref={props.emojiBtnRef}
                  type="button"
                  onClick={() => props.onShowEmojiChange(!props.showEmoji)}
                  tone="ghost"
                  size="sm"
                  className="h-8 min-h-0 w-8 parentos-radius-sm text-[var(--nimi-text-muted)]"
                  title="表情"
                  icon={
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
                    </svg>
                  }
                />
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
                <IconButton
                  type="button"
                  onClick={props.onToggleKeepsake}
                  tone="ghost"
                  size="sm"
                  className={cn(
                    'h-8 min-h-0 w-8 parentos-radius-sm hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)]',
                    props.keepsake ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-muted)]',
                  )}
                  aria-label={props.keepsake ? '取消标记为珍藏' : '标记为珍藏'}
                  title={props.keepsake ? '取消标记为珍藏' : '标记为珍藏'}
                  icon={
                    <svg width="18" height="18" viewBox="0 0 24 24" fill={props.keepsake ? 'var(--nimi-status-warning)' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  }
                />
                {props.editingEntryId ? (
                  <Button
                    type="button"
                    onClick={() => {
                      props.onResetComposer();
                      props.onClearReminderSearchParams();
                    }}
                    tone="ghost"
                    size="sm"
                    className="min-h-0 parentos-radius-sm px-3 py-1.5 text-[13px]"
                  >
                    取消编辑
                  </Button>
                ) : null}
                {props.draftStatusLabel ? (
                  <span className={cn('text-[12px]', props.draftStatusLabel === '未保存' ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-muted)]')}>
                    {props.draftStatusLabel}
                  </span>
                ) : null}
                <div className="flex-1" />
                <RecordedAtPicker value={props.recordedAt} onChange={props.onRecordedAtChange} />
                <Button
                  type="button"
                  onClick={props.onRequestSave}
                  disabled={props.saving || !props.canSaveText}
                  tone={props.canSaveText ? 'primary' : 'secondary'}
                  size="sm"
                  className="parentos-radius-sm px-5 py-2 text-[14px] font-medium"
                >
                  {props.saving ? '保存中...' : props.editingEntryId ? '保存修改' : '保存'}
                </Button>
              </div>
            </>
          ) : (
            <div className="p-5">
              {props.voiceDraft.status === 'idle' ? (
                <VoiceIdleEntry
                  recordingSupported={props.recordingSupported}
                  onStart={props.onStartRecording}
                  onSwitchToText={() => { props.onCaptureModeChange('text'); props.onClearVoiceDraft(); }}
                />
              ) : props.voiceDraft.status === 'recording' ? (
                <VoiceRecordingPanel
                  sessionRef={props.recorderSessionRef}
                  onStop={props.onStopRecording}
                  onCancel={() => { props.onClearVoiceDraft(); props.onCaptureModeChange('text'); }}
                />
              ) : (
                <VoicePreviewPanel
                  voiceDraft={props.voiceDraft}
                  voiceRuntimeAvailable={props.voiceRuntimeAvailable}
                  onTranscribe={props.onTranscribe}
                  onClear={() => { props.onClearVoiceDraft(); props.onCaptureModeChange('text'); }}
                  onTranscriptChange={props.onVoiceTranscriptChange}
                />
              )}
              {props.voiceDraft.status === 'recording' || props.voiceDraft.status === 'idle' ? null : (
              <div className="flex items-center justify-between mt-4">
                <IconButton
                  type="button"
                  onClick={props.onToggleKeepsake}
                  tone="ghost"
                  size="sm"
                  className={cn(
                    'h-8 min-h-0 w-8 parentos-radius-sm hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)]',
                    props.keepsake ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-muted)]',
                  )}
                  aria-label={props.keepsake ? '取消标记为珍藏' : '标记为珍藏'}
                  title={props.keepsake ? '取消标记为珍藏' : '标记为珍藏'}
                  icon={
                    <svg width="18" height="18" viewBox="0 0 24 24" fill={props.keepsake ? 'var(--nimi-status-warning)' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  }
                />
                {props.editingEntryId ? (
                  <Button
                    type="button"
                    onClick={() => {
                      props.onResetComposer();
                      props.onClearReminderSearchParams();
                    }}
                    tone="ghost"
                    size="sm"
                    className="min-h-0 parentos-radius-sm px-3 py-1.5 text-[13px]"
                  >
                    取消编辑
                  </Button>
                ) : null}
                {props.draftStatusLabel ? (
                  <span className={cn('text-[12px]', props.draftStatusLabel === '未保存' ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-muted)]')}>
                    {props.draftStatusLabel}
                  </span>
                ) : null}
                <RecordedAtPicker value={props.recordedAt} onChange={props.onRecordedAtChange} />
                <Button
                  type="button"
                  onClick={props.onRequestSave}
                  disabled={props.saving || !props.canSaveVoice}
                  tone="primary"
                  size="sm"
                  className="parentos-radius-sm px-5 py-2 text-[14px] font-medium"
                >
                  {props.saving ? '保存中...' : props.editingEntryId ? '保存修改' : '保存'}
                </Button>
              </div>
              )}
            </div>
          )}

          {props.submitError ? <p className="px-5 pb-3 text-[13px] text-[var(--nimi-status-danger)]">{props.submitError}</p> : null}
        </Surface>
      </div>

      {props.postSaveExperiment ? (
        <Surface as="section" tone="card" elevation="base" padding="md" className="mx-5 mb-4 parentos-radius-14 border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_22%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] p-4">
          <p className="mb-2 text-[14px] font-medium text-[var(--nimi-text-primary)]">
            试试这个小实验
          </p>
          <p className="mb-3 text-[14px] leading-relaxed text-[var(--nimi-text-primary)]">
            {props.postSaveExperiment.title}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={props.onAddExperimentTodo}
              disabled={props.addingTodo}
              tone="primary"
              size="sm"
              className="min-h-0 parentos-radius-full px-3.5 py-1.5 text-[13px] font-medium"
            >
              {props.addingTodo ? '添加中...' : '添加到待办'}
            </Button>
            <Button
              type="button"
              onClick={props.onDismissExperiment}
              tone="ghost"
              size="sm"
              className="min-h-0 parentos-radius-full px-3 py-1.5 text-[13px]"
            >
              跳过
            </Button>
          </div>
        </Surface>
      ) : null}
    </>
  );
}
