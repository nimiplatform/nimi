import { Button, TextField, TextareaField } from '@nimiplatform/nimi-kit/ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { LookdevWorldStylePack, LookdevWorldStyleSession } from './types.js';

type WorldStyleSessionPanelProps = {
  worldName: string;
  worldSelected: boolean;
  blockedMessage?: string | null;
  styleSession: LookdevWorldStyleSession | null;
  styleSessionInput: string;
  worldStylePack: LookdevWorldStylePack | null;
  stylePackConfirmed: boolean;
  styleSessionCanSynthesize: boolean;
  styleSessionBusy: boolean;
  styleSessionError: string | null;
  styleSessionTargetReady: boolean;
  showAdvancedStyleEditor: boolean;
  onStyleSessionInputChange(value: string): void;
  onOpenRouteSettings(): void;
  onStyleSessionReply(): void;
  onRestartStyleSession(): void;
  onSynthesizeStylePack(): void;
  onConfirmWorldStylePack(): void;
  onToggleAdvancedStyleEditor(): void;
  onUpdateWorldStylePack(patch: Partial<LookdevWorldStylePack>): void;
};

export function WorldStyleSessionPanel(props: WorldStyleSessionPanelProps) {
  const { t } = useTranslation();
  const messageContainerRef = useRef<HTMLDivElement | null>(null);
  const {
    worldName,
    worldSelected,
    blockedMessage,
    styleSession,
    styleSessionInput,
    worldStylePack,
    stylePackConfirmed,
    styleSessionCanSynthesize,
    styleSessionBusy,
    styleSessionError,
    styleSessionTargetReady,
    showAdvancedStyleEditor,
    onStyleSessionInputChange,
    onOpenRouteSettings,
    onStyleSessionReply,
    onRestartStyleSession,
    onSynthesizeStylePack,
    onConfirmWorldStylePack,
    onToggleAdvancedStyleEditor,
    onUpdateWorldStylePack,
  } = props;
  useEffect(() => {
    const container = messageContainerRef.current;
    if (!container || !styleSession) {
      return;
    }
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [styleSession?.sessionId, styleSession?.messages.length]);

  return (
    <div className="grid gap-4 rounded-3xl border border-white/8 bg-black/14 px-5 py-5">
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">{t('createBatch.worldStyleSessionEyebrow')}</div>
        <div className="text-sm text-white/62">{t('createBatch.worldStyleSessionDescription', { worldName })}</div>
      </div>

      {!worldSelected ? (
        <div className="rounded-2xl border border-white/8 bg-black/12 px-4 py-3 text-sm text-white/66">
          {t('createBatch.worldStyleSessionPendingWorld')}
        </div>
      ) : null}

      {worldSelected && !styleSessionTargetReady ? (
        <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
          <div>{t('createBatch.worldStyleSessionTargetMissing')}</div>
          <div className="mt-3">
            <Button
              onClick={onOpenRouteSettings}
              tone="secondary"
              size="sm"
              className="rounded-2xl border-amber-200/20 bg-black/12 text-xs text-amber-50"
            >
              {t('layout.shellSettings')}
            </Button>
          </div>
        </div>
      ) : null}

      {blockedMessage ? (
        <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
          {blockedMessage}
        </div>
      ) : null}

      {styleSession && !blockedMessage ? (
        <>
          <div
            ref={messageContainerRef}
            className="max-h-[320px] space-y-3 overflow-auto rounded-3xl border border-white/8 bg-black/12 px-4 py-4 ld-scroll"
          >
            {styleSession.messages.map((message) => (
              <div
                key={message.messageId}
                className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                  message.role === 'assistant'
                    ? 'border border-white/8 bg-white/5 text-white/76'
                    : 'ml-auto border border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_16%,transparent)] text-white'
                }`}
              >
                <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-[var(--ld-gold)]">
                  {message.role === 'assistant' ? t('createBatch.worldStyleSessionAssistant') : t('createBatch.worldStyleSessionOperator')}
                </div>
                <div>{message.text}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 rounded-3xl border border-white/8 bg-black/12 px-4 py-4">
            <div className="text-sm text-white/68">{t('createBatch.worldStyleSessionInputDescription')}</div>
            {styleSession.summary ? (
              <div className="rounded-2xl border border-white/8 bg-black/14 px-4 py-4 text-sm leading-6 text-white/72">
                <div className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">{t('createBatch.worldStyleSessionSummary')}</div>
                <div>{styleSession.summary}</div>
              </div>
            ) : null}
            {styleSession.openQuestions.length > 0 ? (
              <div className="rounded-2xl border border-white/8 bg-black/14 px-4 py-4">
                <div className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">{t('createBatch.worldStyleSessionOpenQuestions')}</div>
                <div className="space-y-2 text-sm text-white/68">
                  {styleSession.openQuestions.map((question) => (
                    <div key={question}>{question}</div>
                  ))}
                </div>
              </div>
            ) : null}
            {styleSession.readinessReason ? (
              <div className={`rounded-2xl border px-4 py-3 text-sm ${styleSession.status === 'ready_to_synthesize' ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-50' : 'border-white/8 bg-black/14 text-white/68'}`}>
                {styleSession.readinessReason}
              </div>
            ) : null}
            {styleSession.lastTextTraceId ? (
              <div className="text-xs text-white/42">{t('createBatch.worldStyleSessionTrace', { traceId: styleSession.lastTextTraceId })}</div>
            ) : null}
            <label htmlFor="lookdev-style-session-input" className="text-sm text-white/74">{t('createBatch.worldStyleSessionInputLabel')}</label>
            <TextareaField
              id="lookdev-style-session-input"
              value={styleSessionInput}
              onChange={(event) => onStyleSessionInputChange(event.target.value)}
              placeholder={t('createBatch.worldStyleSessionInputPlaceholder')}
              rows={4}
              disabled={styleSessionBusy || !styleSessionTargetReady}
              aria-label={t('createBatch.worldStyleSessionInputLabel')}
              className="min-h-[112px] rounded-2xl border-white/10 bg-black/12 text-white disabled:cursor-not-allowed"
            />
            {styleSessionError ? (
              <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                {styleSessionError}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={onStyleSessionReply}
                disabled={!styleSessionInput.trim() || styleSessionBusy || !styleSessionTargetReady}
                tone="primary"
                className="rounded-2xl text-sm"
              >
                {styleSessionBusy ? t('createBatch.worldStyleSessionReplyBusy') : t('createBatch.worldStyleSessionReply')}
              </Button>
              <Button
                onClick={onSynthesizeStylePack}
                disabled={!styleSessionCanSynthesize || styleSessionBusy || !styleSessionTargetReady}
                tone="secondary"
                className="rounded-2xl border-white/10 bg-black/12 text-sm text-white/78"
              >
                {styleSessionBusy ? t('createBatch.worldStyleSessionSynthesizeBusy') : t('createBatch.worldStyleSessionSynthesize')}
              </Button>
              <Button
                onClick={onRestartStyleSession}
                disabled={styleSessionBusy}
                tone="secondary"
                className="rounded-2xl border-white/10 bg-black/12 text-sm text-white/78"
              >
                {t('createBatch.worldStyleSessionRestart')}
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {worldStylePack ? (
        <>
          <div className={`rounded-2xl border px-4 py-3 text-sm ${stylePackConfirmed ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-50' : 'border-amber-300/20 bg-amber-300/10 text-amber-50'}`}>
            <div className="font-medium">
              {stylePackConfirmed ? t('createBatch.stylePackConfirmedState') : t('createBatch.stylePackDraftState')}
            </div>
            <div className="mt-1 text-sm/6">
              {stylePackConfirmed
                ? t('createBatch.stylePackConfirmedDescription')
                : t('createBatch.stylePackDraftDescription')}
            </div>
            <div className="mt-1 text-xs text-current/80">
              {worldStylePack.seedSource === 'stored_pack'
                ? t('createBatch.stylePackSeedStored')
                : t('createBatch.stylePackSeedSession')}
            </div>
            {worldStylePack.confirmedAt ? (
              <div className="mt-2 text-xs text-current/80">
                {t('createBatch.stylePackConfirmedAt', { timestamp: new Date(worldStylePack.confirmedAt).toLocaleString() })}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/12 px-4 py-4 text-sm leading-6 text-white/72">
            <div className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">{t('createBatch.stylePackSummary')}</div>
            <div>{worldStylePack.summary}</div>
          </div>

          <div className="flex flex-wrap gap-3">
            {!stylePackConfirmed ? (
              <Button
                onClick={onConfirmWorldStylePack}
                tone="primary"
                className="rounded-2xl text-sm"
              >
                {t('createBatch.confirmStylePack')}
              </Button>
            ) : null}
            <Button
              onClick={onToggleAdvancedStyleEditor}
              tone="secondary"
              className="rounded-2xl border-white/10 bg-black/12 text-sm text-white/78"
            >
              {showAdvancedStyleEditor ? t('createBatch.hideAdvancedStyleEditor') : t('createBatch.showAdvancedStyleEditor')}
            </Button>
            <Button
              onClick={onRestartStyleSession}
              disabled={styleSessionBusy}
              tone="secondary"
              className="rounded-2xl border-white/10 bg-black/12 text-sm text-white/78"
            >
              {t('createBatch.worldStyleSessionRestart')}
            </Button>
          </div>

          {showAdvancedStyleEditor ? (
            <div className="grid gap-4 rounded-3xl border border-white/8 bg-black/12 px-4 py-4">
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">{t('createBatch.advancedStyleEditorEyebrow')}</div>
                <div className="text-sm text-white/62">{t('createBatch.advancedStyleEditorDescription')}</div>
              </div>
              <div className="grid gap-2">
                <label htmlFor="lookdev-style-pack-name" className="text-sm text-white/74">{t('createBatch.stylePackName')}</label>
                <TextField
                  id="lookdev-style-pack-name"
                  value={worldStylePack.name}
                  onChange={(event) => onUpdateWorldStylePack({ name: event.target.value })}
                  aria-label={t('createBatch.stylePackName')}
                  className="rounded-2xl border-white/10 bg-black/12 text-white"
                  inputClassName="text-sm"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <label htmlFor="lookdev-style-pack-visual-era" className="text-sm text-white/74">{t('createBatch.visualEra')}</label>
                  <TextField
                    id="lookdev-style-pack-visual-era"
                    value={worldStylePack.visualEra}
                    onChange={(event) => onUpdateWorldStylePack({ visualEra: event.target.value })}
                    aria-label={t('createBatch.visualEra')}
                    className="rounded-2xl border-white/10 bg-black/12 text-white"
                    inputClassName="text-sm"
                  />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="lookdev-style-pack-art-style" className="text-sm text-white/74">{t('createBatch.artStyle')}</label>
                  <TextField
                    id="lookdev-style-pack-art-style"
                    value={worldStylePack.artStyle}
                    onChange={(event) => onUpdateWorldStylePack({ artStyle: event.target.value })}
                    aria-label={t('createBatch.artStyle')}
                    className="rounded-2xl border-white/10 bg-black/12 text-white"
                    inputClassName="text-sm"
                  />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="lookdev-style-pack-palette-direction" className="text-sm text-white/74">{t('createBatch.paletteDirection')}</label>
                  <TextField
                    id="lookdev-style-pack-palette-direction"
                    value={worldStylePack.paletteDirection}
                    onChange={(event) => onUpdateWorldStylePack({ paletteDirection: event.target.value })}
                    aria-label={t('createBatch.paletteDirection')}
                    className="rounded-2xl border-white/10 bg-black/12 text-white"
                    inputClassName="text-sm"
                  />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="lookdev-style-pack-silhouette-direction" className="text-sm text-white/74">{t('createBatch.silhouetteDirection')}</label>
                  <TextField
                    id="lookdev-style-pack-silhouette-direction"
                    value={worldStylePack.silhouetteDirection}
                    onChange={(event) => onUpdateWorldStylePack({ silhouetteDirection: event.target.value })}
                    aria-label={t('createBatch.silhouetteDirection')}
                    className="rounded-2xl border-white/10 bg-black/12 text-white"
                    inputClassName="text-sm"
                  />
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
