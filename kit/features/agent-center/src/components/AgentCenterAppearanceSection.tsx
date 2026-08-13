import { Box, CheckCircle2, FolderOpen, Image as ImageIcon, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { translateAgentCenter } from '../i18n.js';
import type {
  AgentCenterI18n,
  AgentCenterSession,
  AgentCenterSnapshot,
} from '../types.js';
import {
  AgentButton,
  Card,
  Notice,
  SectionHeader,
  SectionShell,
} from './AgentCenterPrimitives.js';
import { AgentCenterProductActionNotice } from './AgentCenterProductActionNotice.js';

export interface AgentCenterAppearanceSectionProps {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly i18n?: AgentCenterI18n;
}

type PendingKind = 'live2d' | 'vrm' | null;
type OperationState =
  | { readonly state: 'idle'; readonly message: '' }
  | { readonly state: 'saving' | 'saved' | 'render-failed' | 'restoring' | 'restored'; readonly message: string }
  | { readonly state: 'validation-failed'; readonly message: string; readonly reasonCode: string };

const EN = {
  title: 'Appearance',
  description: 'Replace the committed Avatar appearance. The live view always reflects committed Runtime truth.',
  current: 'Current committed appearance',
  empty: 'No Avatar appearance is configured.',
  liveView: 'Committed effect',
  replaceLive2d: 'Choose Live2D package',
  replaceVrm: 'Choose VRM file',
  warningTitle: 'Replace current appearance?',
  warning: 'After choosing a new Avatar file, it will immediately replace the current appearance. A failure will not change the current appearance.',
  confirm: 'Choose file and replace',
  cancel: 'Cancel',
  saving: 'Saving appearance…',
  saved: 'Appearance saved.',
  savedRenderFailed: 'Saved, but currently unable to render.',
  validationFailed: 'The file was rejected; the current appearance was not changed.',
  restore: 'Restore previous appearance',
  restoring: 'Restoring previous appearance…',
  restored: 'Previous appearance restored as a new commit.',
  noRenderer: 'No embedded preview is running. Launch Avatar to view the committed appearance.',
  rendererUnavailable: 'The embedded Avatar preview is currently unavailable. The committed profile is unchanged.',
} as const;

function message(error: unknown): { message: string; reasonCode: string } {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return {
      message: typeof record.message === 'string' && record.message.trim() ? record.message : String(error),
      reasonCode: typeof record.reasonCode === 'string' && record.reasonCode.trim()
        ? record.reasonCode
        : typeof record.category === 'string' && record.category.trim()
          ? record.category
          : 'appearance-save-failed',
    };
  }
  return { message: error instanceof Error ? error.message : String(error), reasonCode: 'appearance-save-failed' };
}

export function AgentCenterAppearanceSection({ session, snapshot, i18n }: AgentCenterAppearanceSectionProps) {
  const appearance = snapshot.state.appearance;
  const availability = snapshot.availability.replaceAppearance;
  const [pendingKind, setPendingKind] = useState<PendingKind>(null);
  const [operation, setOperation] = useState<OperationState>({ state: 'idle', message: '' });
  const copy = useMemo(() => Object.fromEntries(Object.entries(EN).map(([key, fallback]) => [
    key,
    translateAgentCenter(i18n, `AgentCenter.appearance.autoSave.${key}`, fallback),
  ])) as Record<keyof typeof EN, string>, [i18n]);
  const voiceCopy = useMemo(() => ({
    defaultVoiceTitle: translateAgentCenter(i18n, 'AgentCenter.appearance.defaultVoiceTitle', 'Default voice'),
    defaultVoiceDescription: translateAgentCenter(
      i18n,
      'AgentCenter.appearance.defaultVoiceDescription',
      'Choose the Runtime-owned default voice for this Agent.',
    ),
    defaultVoiceUnset: translateAgentCenter(i18n, 'AgentCenter.appearance.defaultVoiceUnset', 'Not configured'),
    avatarAutoplayLabel: translateAgentCenter(i18n, 'AgentCenter.appearance.avatarAutoplayLabel', 'Avatar autoplay'),
    avatarAutoplayDescription: translateAgentCenter(
      i18n,
      'AgentCenter.appearance.avatarAutoplayDescription',
      'Automatically play committed voice output through the Avatar.',
    ),
    enableLabel: translateAgentCenter(i18n, 'AgentCenter.appearance.enableLabel', 'Enable'),
    disableLabel: translateAgentCenter(i18n, 'AgentCenter.appearance.disableLabel', 'Disable'),
    catalogLabel: translateAgentCenter(i18n, 'AgentCenter.appearance.voiceCatalogLabel', 'Runtime voice catalog'),
    catalogDescription: translateAgentCenter(
      i18n,
      'AgentCenter.appearance.voiceCatalogDescription',
      'Machine TTS configuration selects the engine. This setting selects this Agent’s default voice.',
    ),
    catalogUnavailable: translateAgentCenter(i18n, 'AgentCenter.appearance.voiceCatalogUnavailable', 'Runtime voice catalog is unavailable.'),
    catalogEmpty: translateAgentCenter(i18n, 'AgentCenter.appearance.voiceCatalogEmpty', 'No voice is available for the selected machine TTS configuration.'),
    retryLabel: translateAgentCenter(i18n, 'AgentCenter.appearance.retryLabel', 'Retry'),
  }), [i18n]);
  const actionAvailable = availability.state === 'available';
  const canReplace = actionAvailable && Boolean(session.appearance.replaceAvatar);
  const canRestore = snapshot.availability.restorePreviousAppearance.state === 'available'
    && Boolean(appearance.previousSelection);
  const hasDefaultVoice = Boolean(appearance.defaultVoiceReference?.trim());
  const voiceCatalog = appearance.voiceCatalog;
  const voiceOptions = voiceCatalog?.state === 'ready' ? voiceCatalog.options : [];
  const canSetDefaultVoice = actionAvailable
    && Boolean(session.appearance.setDefaultVoice)
    && voiceOptions.length > 0;
  const canToggleAutoplay = actionAvailable
    && Boolean(session.appearance.setAvatarAutoplay)
    && (appearance.avatarAutoplay || hasDefaultVoice);

  const choose = (kind: 'live2d' | 'vrm') => setPendingKind(kind);
  const replace = async () => {
    const kind = pendingKind;
    setPendingKind(null);
    if (!kind || !session.appearance.replaceAvatar) return;
    setOperation({ state: 'saving', message: copy.saving });
    try {
      await session.appearance.replaceAvatar(kind);
      const committed = session.getSnapshot().state.appearance;
      setOperation(committed.renderState === 'failed'
        || (committed.renderState === 'unavailable'
          && committed.renderUnavailableReasonCode !== 'preview-not-running')
        ? { state: 'render-failed', message: copy.savedRenderFailed }
        : { state: 'saved', message: copy.saved });
    } catch (error) {
      const failure = message(error);
      setOperation({
        state: 'validation-failed',
        reasonCode: failure.reasonCode,
        message: `${copy.validationFailed} ${failure.message}`,
      });
    }
  };
  const restore = async () => {
    setOperation({ state: 'restoring', message: copy.restoring });
    try {
      await session.restorePreviousAppearance();
      setOperation({ state: 'restored', message: copy.restored });
    } catch (error) {
      const failure = message(error);
      setOperation({ state: 'validation-failed', reasonCode: failure.reasonCode, message: failure.message });
    }
  };
  const toggleAutoplay = async () => {
    if (!session.appearance.setAvatarAutoplay) return;
    setOperation({ state: 'saving', message: copy.saving });
    try {
      await session.appearance.setAvatarAutoplay(!appearance.avatarAutoplay);
      setOperation({ state: 'saved', message: copy.saved });
    } catch (error) {
      const failure = message(error);
      setOperation({ state: 'validation-failed', reasonCode: failure.reasonCode, message: failure.message });
    }
  };
  const setDefaultVoice = async (reference: string) => {
    if (!session.appearance.setDefaultVoice) return;
    setOperation({ state: 'saving', message: copy.saving });
    try {
      await session.appearance.setDefaultVoice(reference);
      setOperation({ state: 'saved', message: copy.saved });
    } catch (error) {
      const failure = message(error);
      setOperation({ state: 'validation-failed', reasonCode: failure.reasonCode, message: failure.message });
    }
  };
  const previewNotRunning = appearance.renderState === 'unavailable'
    && appearance.renderUnavailableReasonCode === 'preview-not-running';
  const renderFailed = appearance.renderState === 'failed'
    || (appearance.renderState === 'unavailable' && !previewNotRunning);

  return (
    <SectionShell labelledBy="agent-center-appearance-title">
      <SectionHeader description={copy.description} id="agent-center-appearance-title" title={copy.title} />
      {!actionAvailable ? (
        <AgentCenterProductActionNotice
          action="replaceAppearance"
          availability={availability}
          i18n={i18n}
          session={session}
        />
      ) : null}
      <div className="grid gap-3" data-agent-center-appearance-surface="committed-effect">
        <Card className="border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <h3 className="m-0 text-[15px] font-semibold text-slate-950">{copy.current}</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(150px,0.78fr)_minmax(0,1fr)]">
            <div
              className="relative grid min-h-[184px] place-items-center overflow-hidden rounded-[14px] border border-emerald-100 bg-emerald-50/35"
              data-agent-center-appearance-live-view={appearance.renderState || 'empty'}
            >
              {appearance.renderState === 'ready' && appearance.renderImageRef ? (
                <img alt={copy.liveView} className="max-h-[176px] max-w-full object-contain" src={appearance.renderImageRef} />
              ) : (
                <div className="grid max-w-[180px] gap-2 text-center text-[11px] leading-4 text-slate-500">
                  <ImageIcon aria-hidden="true" className="mx-auto h-10 w-10 text-emerald-300" />
                  <span>{appearance.avatarAssetRef
                    ? (previewNotRunning ? copy.noRenderer : renderFailed ? copy.rendererUnavailable : copy.noRenderer)
                    : copy.empty}</span>
                </div>
              )}
              <span className="absolute bottom-3 rounded-full bg-white/85 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                {copy.liveView}
              </span>
            </div>
            <div className="flex min-w-0 flex-col justify-center gap-3">
              {appearance.avatarAssetRef ? (
                <div className="grid gap-1">
                  <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> {appearance.backendKind?.toUpperCase()}
                  </span>
                  <span className="truncate font-mono text-[11px] text-slate-500" title={appearance.avatarAssetRef}>{appearance.avatarAssetRef}</span>
                  <span className="text-[11px] text-slate-400">revision {appearance.presentationRevision || '—'}</span>
                </div>
              ) : <p className="m-0 text-[12px] text-slate-500">{copy.empty}</p>}
              <AgentButton disabled={!canReplace || operation.state === 'saving'} onClick={() => choose('live2d')}>
                <FolderOpen className="h-4 w-4" /> {copy.replaceLive2d}
              </AgentButton>
              <AgentButton disabled={!canReplace || operation.state === 'saving'} onClick={() => choose('vrm')}>
                <Box className="h-4 w-4" /> {copy.replaceVrm}
              </AgentButton>
              {(operation.state === 'render-failed' || (appearance.avatarAssetRef && renderFailed))
                && canRestore ? (
                <AgentButton onClick={() => void restore()}>
                  <RotateCcw className="h-4 w-4" /> {copy.restore}
                </AgentButton>
              ) : null}
            </div>
          </div>
        </Card>

        <Card
          className="grid gap-4 border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
        >
          <div
            className="grid gap-1"
            data-agent-center-default-voice={hasDefaultVoice ? 'bound' : 'unset'}
          >
            <h3 className="m-0 text-[15px] font-semibold text-slate-950">{voiceCopy.defaultVoiceTitle}</h3>
            <p className="m-0 text-[11px] leading-5 text-slate-500">{voiceCopy.defaultVoiceDescription}</p>
            <label className="mt-2 grid gap-1 text-[12px] font-semibold text-slate-700">
              <span>{voiceCopy.catalogLabel}</span>
              <select
                aria-label={voiceCopy.catalogLabel}
                className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                data-agent-center-default-voice-reference={appearance.defaultVoiceReference || ''}
                disabled={!canSetDefaultVoice || operation.state === 'saving'}
                onChange={(event) => void setDefaultVoice(event.currentTarget.value)}
                value={appearance.defaultVoiceReference || ''}
              >
                {!hasDefaultVoice ? <option value="">{voiceCopy.defaultVoiceUnset}</option> : null}
                {voiceOptions.map((voice) => (
                  <option key={voice.reference} value={voice.reference}>
                    {voice.name} · {voice.kind === 'preset_voice_id' ? 'Preset' : 'Voice asset'}
                  </option>
                ))}
              </select>
            </label>
            <p className="m-0 text-[11px] leading-5 text-slate-500">{voiceCopy.catalogDescription}</p>
            {voiceCatalog?.state === 'ready' && voiceOptions.length === 0 ? (
              <Notice tone="warn">{voiceCopy.catalogEmpty}</Notice>
            ) : null}
            {voiceCatalog?.state === 'unavailable' ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-amber-700">{voiceCopy.catalogUnavailable}</span>
                <AgentButton onClick={() => void session.refresh()}>{voiceCopy.retryLabel}</AgentButton>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <span className="text-[13px] font-semibold text-slate-800">{voiceCopy.avatarAutoplayLabel}</span>
              <span className="text-[11px] leading-5 text-slate-500">{voiceCopy.avatarAutoplayDescription}</span>
            </div>
            <AgentButton
              dataAttrs={{
                'data-agent-center-avatar-autoplay': appearance.avatarAutoplay ? 'enabled' : 'disabled',
              }}
              disabled={!canToggleAutoplay || operation.state === 'saving'}
              onClick={() => void toggleAutoplay()}
            >
              {appearance.avatarAutoplay ? voiceCopy.disableLabel : voiceCopy.enableLabel}
            </AgentButton>
          </div>
        </Card>

        {appearance.avatarAssetRef && renderFailed ? (
          <Notice tone="warn"><strong>{copy.savedRenderFailed}</strong> {copy.rendererUnavailable}</Notice>
        ) : null}
        {operation.message ? (
          <Notice ariaLive="polite" tone={operation.state === 'validation-failed' || operation.state === 'render-failed' ? 'warn' : 'info'}>
            <span data-agent-center-appearance-operation={operation.state}>{operation.message}</span>
            {operation.state === 'validation-failed' ? <span data-agent-center-validation-reason={operation.reasonCode} /> : null}
          </Notice>
        ) : null}
      </div>

      {pendingKind ? (
        <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-5" role="dialog">
          <Card className="w-full max-w-md border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="m-0 text-[16px] font-semibold text-slate-950">{copy.warningTitle}</h3>
            <p className="mt-3 text-[13px] leading-6 text-slate-600">{copy.warning}</p>
            <div className="mt-5 flex justify-end gap-2">
              <AgentButton onClick={() => setPendingKind(null)}>{copy.cancel}</AgentButton>
              <AgentButton onClick={() => void replace()} variant="accent">{copy.confirm}</AgentButton>
            </div>
          </Card>
        </div>
      ) : null}
    </SectionShell>
  );
}
