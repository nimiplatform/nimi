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
  noRenderer: 'The committed appearance has no current render output.',
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
  const actionAvailable = availability.state === 'available';
  const canReplace = actionAvailable && Boolean(session.appearance.replaceAvatar);
  const canRestore = snapshot.availability.restorePreviousAppearance.state === 'available'
    && Boolean(appearance.previousSelection);

  const choose = (kind: 'live2d' | 'vrm') => setPendingKind(kind);
  const replace = async () => {
    const kind = pendingKind;
    setPendingKind(null);
    if (!kind || !session.appearance.replaceAvatar) return;
    setOperation({ state: 'saving', message: copy.saving });
    try {
      await session.appearance.replaceAvatar(kind);
      const committed = session.getSnapshot().state.appearance;
      setOperation(committed.renderState === 'failed' || committed.renderState === 'unavailable'
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

  if (!actionAvailable) {
    return (
      <SectionShell labelledBy="agent-center-appearance-title">
        <SectionHeader description={copy.description} id="agent-center-appearance-title" title={copy.title} />
        <AgentCenterProductActionNotice
          action="replaceAppearance"
          availability={availability}
          i18n={i18n}
          session={session}
        />
      </SectionShell>
    );
  }

  return (
    <SectionShell labelledBy="agent-center-appearance-title">
      <SectionHeader description={copy.description} id="agent-center-appearance-title" title={copy.title} />
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
                  <span>{appearance.avatarAssetRef ? (appearance.renderFailureReason || copy.noRenderer) : copy.empty}</span>
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
              {(operation.state === 'render-failed' || (appearance.avatarAssetRef && appearance.renderState === 'failed')) && canRestore ? (
                <AgentButton onClick={() => void restore()}>
                  <RotateCcw className="h-4 w-4" /> {copy.restore}
                </AgentButton>
              ) : null}
            </div>
          </div>
        </Card>

        {appearance.avatarAssetRef && (appearance.renderState === 'failed' || appearance.renderState === 'unavailable') ? (
          <Notice tone="warn"><strong>{copy.savedRenderFailed}</strong> {appearance.renderFailureReason}</Notice>
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
