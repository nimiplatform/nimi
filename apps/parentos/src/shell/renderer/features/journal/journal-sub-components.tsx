import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { S } from '../../app-shell/page-style.js';
import type { JournalTagInsertRow } from '../../bridge/sqlite-bridge.js';
import { ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import type { ObservationDimension } from '../../knowledge-base/index.js';
import { suggestJournalTags } from './ai-journal-tagging.js';
import type { JournalTagSuggestion } from './ai-journal-tagging.js';
import type { PhotoDraft, TagSuggestionStatus, VoiceDraft } from './journal-page-helpers.js';

/* ── AutoTagBar ── */

export interface AutoTagBarProps {
  status: TagSuggestionStatus;
  suggestion: JournalTagSuggestion | null;
  selectedTags: string[];
  selectedDimension: string | null;
  dimensions: Array<{ dimensionId: string; displayName: string; quickTags: string[] }>;
  onToggleTag: (tag: string) => void;
  onRetry: () => void;
}

export function AutoTagBar({ status, suggestion, selectedTags, selectedDimension, dimensions, onToggleTag, onRetry }: AutoTagBarProps) {
  if (status === 'idle') return null;

  if (status === 'suggesting') {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <div className="w-3 h-3 rounded-full animate-pulse" style={{ background: S.accent }} />
        <span className="text-[13px]" style={{ color: S.sub }}>AI 正在分析...</span>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <span className="text-[12px]" style={{ color: S.sub }}>AI 成长关键词暂不可用</span>
        <button onClick={onRetry} className="text-[12px] underline" style={{ color: S.accent }}>重试</button>
      </div>
    );
  }

  // status === 'ready'
  if (!suggestion?.dimensionId) return null;

  const dim = dimensions.find((d) => d.dimensionId === suggestion.dimensionId);
  const suggestedTags = suggestion.tags;

  if (!dim || suggestedTags.length === 0) return null;

  return (
    <div className={`flex items-center gap-2 flex-wrap py-1.5 px-2 ${S.radiusSm}`}
      style={{ background: '#f4f7ea', border: `1px solid ${S.accent}30` }}>
      <span className="text-[12px] shrink-0" style={{ color: S.accent }}>✨</span>
      {selectedDimension !== suggestion.dimensionId && (
        <span className="text-[12px] rounded-full px-1.5 py-0.5 font-medium"
          style={{ background: S.accent + '20', color: S.accent }}>
          成长方向 · {dim.displayName}
        </span>
      )}
      {suggestedTags.map((tag) => (
        <button key={tag} onClick={() => onToggleTag(tag)}
          className="rounded-full px-2 py-0.5 text-[12px] transition-colors"
          style={selectedTags.includes(tag)
            ? { background: S.accent, color: '#fff' }
            : { background: '#fff', color: S.accent, border: `1px solid ${S.accent}40` }}>
          {tag}
        </button>
      ))}
    </div>
  );
}

/* ── PhotoBar ── */

export interface PhotoBarProps {
  drafts: PhotoDraft[];
  onAdd: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function PhotoBar({ drafts, onRemove, inputRef }: PhotoBarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Photo previews */}
      {drafts.map((d, i) => (
        <div key={i} className="relative w-14 h-14 shrink-0">
          <img src={d.previewUrl} alt="" className={`w-14 h-14 ${S.radiusSm} object-cover`} />
          <button onClick={() => onRemove(i)}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[12px] flex items-center justify-center leading-none">
            ✕
          </button>
        </div>
      ))}

      {/* Add photo button */}
      {drafts.length < 9 && (
        <button onClick={() => inputRef.current?.click()}
          className={`w-14 h-14 ${S.radiusSm} flex flex-col items-center justify-center gap-0.5 transition-colors hover:bg-[#eceeed]`}
          style={{ border: `1px dashed ${S.border}`, color: S.sub }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
          <span className="text-[12px]">添加</span>
        </button>
      )}
    </div>
  );
}

/* ── VoiceCapture ── */

export interface VoiceCaptureProps {
  voiceDraft: VoiceDraft;
  recordingSupported: boolean;
  voiceRuntimeAvailable: boolean | null;
  onStart: () => void;
  onStop: () => void;
  onTranscribe: () => void;
  onClear: () => void;
  onTranscriptChange: (t: string) => void;
}

export function VoiceCapture({ voiceDraft, recordingSupported, voiceRuntimeAvailable, onStart, onStop, onTranscribe, onClear, onTranscriptChange }: VoiceCaptureProps) {
  return (
    <div className={`space-y-3 ${S.radiusSm} p-4`} style={{ border: `1px dashed ${S.border}` }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[14px] font-medium" style={{ color: S.text }}>
            {voiceDraft.status === 'recording' ? '🔴 录音中...' : voiceDraft.status === 'transcribing' ? '转写中...' : '语音记录'}
          </p>
          {voiceDraft.status === 'ready' && <p className="text-[12px]" style={{ color: S.sub }}>可转写为文字或直接保存</p>}
        </div>
        <div className="flex gap-1.5">
          {voiceDraft.status === 'recording' ? (
            <button onClick={onStop} className={`${S.radiusSm} px-3 py-1.5 text-[14px] text-white`} style={{ background: '#ef4444' }}>
              停止
            </button>
          ) : (
            <button onClick={onStart} disabled={!recordingSupported}
              className={`${S.radiusSm} px-3 py-1.5 text-[14px] text-white disabled:opacity-50`} style={{ background: S.accent }}>
              开始录音
            </button>
          )}
          {voiceDraft.blob && voiceDraft.status !== 'recording' && (
            <>
              <button onClick={onTranscribe}
                disabled={voiceDraft.status === 'transcribing' || voiceRuntimeAvailable === false}
                className={`${S.radiusSm} px-3 py-1.5 text-[14px] text-white disabled:opacity-50`} style={{ background: S.accent }}>
                {voiceDraft.status === 'transcribing' ? '转写中...' : '转文字'}
              </button>
              <button onClick={onClear} className={`${S.radiusSm} px-3 py-1.5 text-[14px]`}
                style={{ background: '#f0f0ec', color: S.sub }}>删除</button>
            </>
          )}
        </div>
      </div>

      {!recordingSupported && <p className="text-[12px] text-red-500">当前环境不支持录音，请在桌面端使用并授权麦克风。</p>}
      {voiceRuntimeAvailable === false && <p className="text-[12px] text-amber-600">语音转写暂不可用，仍可保存语音记录。</p>}
      {voiceDraft.error && <p className="text-[12px] text-red-500">{voiceDraft.error}</p>}
      {voiceDraft.previewUrl && <audio controls src={voiceDraft.previewUrl} className="w-full" />}
      {voiceDraft.previewUrl && (
        <textarea value={voiceDraft.transcript} onChange={(e) => onTranscriptChange(e.target.value)}
          placeholder="转写结果可编辑..."
          className={`w-full resize-none ${S.radiusSm} p-3 text-[14px]`}
          style={{ border: `1px solid ${S.border}` }} rows={3} />
      )}
    </div>
  );
}

/* ── SaveConfirmationModal ── */

export interface SaveConfirmationModalProps {
  textPreview: string;
  selectedDimension: string | null;
  selectedTags: string[];
  dimensions: readonly ObservationDimension[];
  draftTextForTagging: string;
  onConfirm: (aiTags: JournalTagInsertRow[]) => void;
  onCancel: () => void;
}

export function SaveConfirmationModal({
  textPreview, selectedDimension, selectedTags, dimensions,
  draftTextForTagging, onConfirm, onCancel,
}: SaveConfirmationModalProps) {
  const [aiStatus, setAiStatus] = useState<TagSuggestionStatus>('idle');
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<JournalTagSuggestion | null>(null);
  const [selectedAiTags, setSelectedAiTags] = useState<Set<string>>(new Set());
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    if (draftTextForTagging.trim().length < 10) return;

    const candidateDimensions = selectedDimension
      ? dimensions.filter((d) => d.dimensionId === selectedDimension)
      : dimensions;
    if (candidateDimensions.length === 0) return;

    setAiStatus('suggesting');
    suggestJournalTags({ draftText: draftTextForTagging, candidateDimensions })
      .then((suggestion) => {
        if (suggestion.dimensionId) {
          const dim = candidateDimensions.find((d) => d.dimensionId === suggestion.dimensionId);
          const validTags = suggestion.tags.filter((tag) => dim?.quickTags.includes(tag) ?? false);
          setAiSuggestion({ dimensionId: suggestion.dimensionId, tags: validTags });
          setSelectedAiTags(new Set(validTags));
        } else {
          setAiSuggestion({ dimensionId: null, tags: [] });
        }
        setAiStatus('ready');
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        catchLog('journal', 'ai-tag-analysis-failed', 'warn')(err);
        setAiError(msg);
        setAiSuggestion(null);
        setAiStatus('failed');
      });
  }, [draftTextForTagging, selectedDimension, dimensions]);

  const handleToggleAiTag = (tag: string) => {
    setSelectedAiTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  const handleRetry = () => {
    ranRef.current = false;
    setAiStatus('idle');
    setAiError(null);
    setAiSuggestion(null);
    setSelectedAiTags(new Set());
    // Re-trigger via effect dependency — force by toggling ref
    setTimeout(() => { ranRef.current = false; }, 0);
    // Inline retry instead
    const candidateDimensions = selectedDimension
      ? dimensions.filter((d) => d.dimensionId === selectedDimension)
      : dimensions;
    if (candidateDimensions.length === 0) return;
    setAiStatus('suggesting');
    suggestJournalTags({ draftText: draftTextForTagging, candidateDimensions })
      .then((suggestion) => {
        if (suggestion.dimensionId) {
          const dim = candidateDimensions.find((d) => d.dimensionId === suggestion.dimensionId);
          const validTags = suggestion.tags.filter((tag) => dim?.quickTags.includes(tag) ?? false);
          setAiSuggestion({ dimensionId: suggestion.dimensionId, tags: validTags });
          setSelectedAiTags(new Set(validTags));
        } else {
          setAiSuggestion({ dimensionId: null, tags: [] });
        }
        setAiStatus('ready');
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        catchLog('journal', 'ai-tag-analysis-retry-failed', 'warn')(err);
        setAiError(msg);
        setAiSuggestion(null);
        setAiStatus('failed');
      });
  };

  const handleConfirm = () => {
    const aiTags: JournalTagInsertRow[] = [];
    if (aiSuggestion?.dimensionId) {
      for (const tag of selectedAiTags) {
        if (aiSuggestion.tags.includes(tag)) {
          aiTags.push({ tagId: ulid(), domain: 'observation', tag, source: 'ai', confidence: null });
        }
      }
    }
    onConfirm(aiTags);
  };

  const manualDim = selectedDimension ? dimensions.find((d) => d.dimensionId === selectedDimension) : null;
  const aiDim = aiSuggestion?.dimensionId ? dimensions.find((d) => d.dimensionId === aiSuggestion.dimensionId) : null;
  const aiReady = aiStatus === 'ready' && aiSuggestion?.dimensionId && aiDim && aiSuggestion.tags.length > 0;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.28)] p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="保存随手记"
        className={`${S.radius} w-full max-w-[480px] p-5`}
        style={{ background: S.card, boxShadow: S.shadow }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <h3 className="mb-4 text-[16px] font-semibold" style={{ color: S.text }}>保存随手记</h3>

        {/* Text preview */}
        <div className={`${S.radiusSm} mb-4 max-h-[160px] overflow-y-auto p-3`}
          style={{ background: '#fafaf8', border: `1px solid ${S.border}` }}>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed" style={{ color: S.sub }}>
            {textPreview || '（无文字内容）'}
          </p>
        </div>

        {/* Manual dimension + tags (display-only) */}
        {(manualDim || selectedTags.length > 0) && (
          <div className="mb-4">
            <p className="mb-1.5 text-[13px] font-medium" style={{ color: S.sub }}>已选分类</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {manualDim && (
                <span className="rounded-full px-2 py-0.5 text-[12px] font-medium"
                  style={{ background: S.accent + '20', color: S.accent }}>
                  {manualDim.displayName}
                </span>
              )}
              {selectedTags.map((tag) => (
                <span key={tag} className="rounded-full px-2 py-0.5 text-[12px]"
                  style={{ background: '#f0f0ec', color: S.text }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* AI tag analysis section */}
        <div className="mb-5">
          <p className="mb-1.5 text-[13px] font-medium" style={{ color: S.sub }}>AI 成长关键词</p>

          {aiStatus === 'suggesting' && (
            <div className="flex items-center gap-2 py-2">
              <div className="h-3 w-3 animate-pulse rounded-full" style={{ background: S.accent }} />
              <span className="text-[13px]" style={{ color: S.sub }}>AI 正在分析成长关键词...</span>
            </div>
          )}

          {aiStatus === 'failed' && (
            <div className="py-2">
              <div className="flex items-center gap-2">
                <span className="text-[12px]" style={{ color: S.sub }}>AI 分析暂不可用</span>
                <button onClick={handleRetry} className="text-[12px] underline" style={{ color: S.accent }}>重试</button>
              </div>
              {aiError && (
                <p className="mt-1 text-[12px] break-all" style={{ color: '#b45309' }}>{aiError}</p>
              )}
            </div>
          )}

          {aiStatus === 'ready' && !aiReady && (
            <p className="py-2 text-[12px]" style={{ color: S.sub }}>AI 未识别到成长关键词</p>
          )}

          {aiReady && (
            <div className={`flex flex-wrap items-center gap-2 px-2 py-2 ${S.radiusSm}`}
              style={{ background: '#f4f7ea', border: `1px solid ${S.accent}30` }}>
              <span className="shrink-0 text-[12px]" style={{ color: S.accent }}>✨</span>
              {aiDim && selectedDimension !== aiSuggestion!.dimensionId && (
                <span className="rounded-full px-1.5 py-0.5 text-[12px] font-medium"
                  style={{ background: S.accent + '20', color: S.accent }}>
                  成长方向 · {aiDim.displayName}
                </span>
              )}
              {aiSuggestion!.tags.map((tag) => (
                <button key={tag} onClick={() => handleToggleAiTag(tag)}
                  className="rounded-full px-2 py-0.5 text-[12px] transition-colors"
                  style={selectedAiTags.has(tag)
                    ? { background: S.accent, color: '#fff' }
                    : { background: '#fff', color: S.accent, border: `1px solid ${S.accent}40` }}>
                  {tag}
                </button>
              ))}
            </div>
          )}

          {aiStatus === 'idle' && draftTextForTagging.trim().length < 10 && (
            <p className="py-2 text-[12px]" style={{ color: S.sub }}>文字内容较短，跳过 AI 分析</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel}
            className={`${S.radiusSm} px-4 py-2 text-[14px] transition-colors`}
            style={{ background: '#f3f4f6', color: S.sub }}>
            取消
          </button>
          <button type="button" onClick={handleConfirm}
            className={`${S.radiusSm} px-4 py-2 text-[14px] font-medium text-white transition-colors`}
            style={{ background: S.accent }}>
            {aiStatus === 'suggesting' ? '保存（跳过 AI 分析）' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
