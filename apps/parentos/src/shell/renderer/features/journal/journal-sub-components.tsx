import { S } from '../../app-shell/page-style.js';
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
        <span className="text-[11px]" style={{ color: S.sub }}>AI 正在分析...</span>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <span className="text-[10px]" style={{ color: S.sub }}>AI 成长关键词暂不可用</span>
        <button onClick={onRetry} className="text-[10px] underline" style={{ color: S.accent }}>重试</button>
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
      <span className="text-[10px] shrink-0" style={{ color: S.accent }}>✨</span>
      {selectedDimension !== suggestion.dimensionId && (
        <span className="text-[10px] rounded-full px-1.5 py-0.5 font-medium"
          style={{ background: S.accent + '20', color: S.accent }}>
          成长方向 · {dim.displayName}
        </span>
      )}
      {suggestedTags.map((tag) => (
        <button key={tag} onClick={() => onToggleTag(tag)}
          className="rounded-full px-2 py-0.5 text-[10px] transition-colors"
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
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center leading-none">
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
          <span className="text-[8px]">添加</span>
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
          <p className="text-[12px] font-medium" style={{ color: S.text }}>
            {voiceDraft.status === 'recording' ? '🔴 录音中...' : voiceDraft.status === 'transcribing' ? '转写中...' : '语音记录'}
          </p>
          {voiceDraft.status === 'ready' && <p className="text-[10px]" style={{ color: S.sub }}>可转写为文字或直接保存</p>}
        </div>
        <div className="flex gap-1.5">
          {voiceDraft.status === 'recording' ? (
            <button onClick={onStop} className={`${S.radiusSm} px-3 py-1.5 text-[12px] text-white`} style={{ background: '#ef4444' }}>
              停止
            </button>
          ) : (
            <button onClick={onStart} disabled={!recordingSupported}
              className={`${S.radiusSm} px-3 py-1.5 text-[12px] text-white disabled:opacity-50`} style={{ background: S.accent }}>
              开始录音
            </button>
          )}
          {voiceDraft.blob && voiceDraft.status !== 'recording' && (
            <>
              <button onClick={onTranscribe}
                disabled={voiceDraft.status === 'transcribing' || voiceRuntimeAvailable === false}
                className={`${S.radiusSm} px-3 py-1.5 text-[12px] text-white disabled:opacity-50`} style={{ background: S.accent }}>
                {voiceDraft.status === 'transcribing' ? '转写中...' : '转文字'}
              </button>
              <button onClick={onClear} className={`${S.radiusSm} px-3 py-1.5 text-[12px]`}
                style={{ background: '#f0f0ec', color: S.sub }}>删除</button>
            </>
          )}
        </div>
      </div>

      {!recordingSupported && <p className="text-[10px] text-red-500">当前环境不支持录音，请在桌面端使用并授权麦克风。</p>}
      {voiceRuntimeAvailable === false && <p className="text-[10px] text-amber-600">语音转写暂不可用，仍可保存语音记录。</p>}
      {voiceDraft.error && <p className="text-[10px] text-red-500">{voiceDraft.error}</p>}
      {voiceDraft.previewUrl && <audio controls src={voiceDraft.previewUrl} className="w-full" />}
      {voiceDraft.previewUrl && (
        <textarea value={voiceDraft.transcript} onChange={(e) => onTranscriptChange(e.target.value)}
          placeholder="转写结果可编辑..."
          className={`w-full resize-none ${S.radiusSm} p-3 text-[12px]`}
          style={{ border: `1px solid ${S.border}` }} rows={3} />
      )}
    </div>
  );
}
