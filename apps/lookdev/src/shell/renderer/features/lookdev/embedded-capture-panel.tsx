import { Button, TextField, TextareaField } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import type { LookdevCaptureState } from './types.js';

type EmbeddedCapturePanelProps = {
  stylePackConfirmed: boolean;
  captureSynthesisBusy: boolean;
  captureSynthesisError: string | null;
  captureStates: LookdevCaptureState[];
  activeCaptureState: LookdevCaptureState | null;
  activePortraitBriefFieldPrefix: string;
  interactiveCaptureInput: string;
  interactiveCaptureBusy: boolean;
  interactiveCaptureResetBusy: boolean;
  interactiveCaptureError: string | null;
  onSelectBriefAgent(agentId: string): void;
  onInteractiveCaptureInputChange(value: string): void;
  onRunInteractiveCaptureRefine(): void;
  onResetInteractiveCapture(): void;
  onUpdateCaptureVisualIntent(patch: Partial<LookdevCaptureState['visualIntent']>): void;
};

function LanePill(input: { mode: LookdevCaptureState['synthesisMode']; captureMode: LookdevCaptureState['captureMode'] }) {
  const { t } = useTranslation();
  const tone = input.captureMode === 'capture'
    ? 'bg-[color-mix(in_srgb,var(--ld-accent)_18%,transparent)] text-white'
    : 'bg-black/18 text-white/68';
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${tone}`}>
      {input.mode === 'interactive'
        ? t('createBatch.captureLaneInteractive', { defaultValue: 'interactive' })
        : t('createBatch.captureLaneSilent', { defaultValue: 'silent' })}
    </span>
  );
}

function SummaryList(input: { label: string; values: string[]; emptyLabel: string }) {
  return (
    <div className="grid min-w-0 gap-2 rounded-2xl border border-white/8 bg-black/14 px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">{input.label}</div>
      {input.values.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-xs text-white/72">
          {input.values.map((value) => (
            <span key={value} className="rounded-full border border-white/10 px-3 py-1">{value}</span>
          ))}
        </div>
      ) : (
        <div className="text-sm text-white/44">{input.emptyLabel}</div>
      )}
    </div>
  );
}

export function EmbeddedCapturePanel(props: EmbeddedCapturePanelProps) {
  const { t } = useTranslation();
  const {
    stylePackConfirmed,
    captureSynthesisBusy,
    captureSynthesisError,
    captureStates,
    activeCaptureState,
    activePortraitBriefFieldPrefix,
    interactiveCaptureInput,
    interactiveCaptureBusy,
    interactiveCaptureResetBusy,
    interactiveCaptureError,
    onSelectBriefAgent,
    onInteractiveCaptureInputChange,
    onRunInteractiveCaptureRefine,
    onResetInteractiveCapture,
    onUpdateCaptureVisualIntent,
  } = props;
  const interactiveCaptureActionBusy = interactiveCaptureBusy || interactiveCaptureResetBusy;

  return (
    <div className="grid gap-4 rounded-3xl border border-white/8 bg-black/14 px-5 py-5">
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">{t('createBatch.embeddedCaptureEyebrow')}</div>
        <div className="text-sm text-white/62">{t('createBatch.embeddedCaptureDescription')}</div>
      </div>
      {!stylePackConfirmed ? (
        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/40">
          {t('createBatch.embeddedCaptureBlocked')}
        </div>
      ) : (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
          <div className="min-w-0 space-y-3">
            <div className={`rounded-2xl border px-4 py-3 text-sm ${captureSynthesisBusy ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/8 bg-black/12 text-white/66'}`}>
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ld-gold)]">
                {t('createBatch.captureStateStatus', { defaultValue: 'Capture state' })}
              </div>
              <div className="mt-1">
                {captureSynthesisBusy
                  ? t('createBatch.captureStateBusy', { defaultValue: 'Synthesizing silent capture states for the current cast.' })
                  : t('createBatch.captureStateReady', { defaultValue: 'Every selected agent keeps an app-local capture state before batch freeze.' })}
              </div>
            </div>
            {captureSynthesisError ? (
              <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                {captureSynthesisError}
              </div>
            ) : null}
            <div className="max-h-[420px] min-w-0 space-y-2 overflow-auto pr-1 ld-scroll">
              {captureStates.map((state) => {
                const selected = state.agentId === activeCaptureState?.agentId;
                return (
                  <Button
                    key={state.agentId}
                    onClick={() => onSelectBriefAgent(state.agentId)}
                    tone="secondary"
                    className={`grid w-full gap-2 rounded-2xl px-4 py-3 text-left ${selected ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/8 bg-black/12 text-white/72'}`}
                    fullWidth
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-white">{state.displayName}</div>
                        <div className="mt-1 truncate text-xs text-white/48">{state.currentBrief}</div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <LanePill mode={state.synthesisMode} captureMode={state.captureMode} />
                        <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--ld-gold)]">
                          {selected
                            ? t('createBatch.embeddedCaptureEditing')
                            : t('createBatch.embeddedCaptureReview')}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-white/54">{state.workingMemory.effectiveIntentSummary}</div>
                  </Button>
                );
              })}
              {captureStates.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/40">
                  {t('createBatch.embeddedCaptureEmpty')}
                </div>
              ) : null}
            </div>
          </div>

          {activeCaptureState ? (
            <div className="grid min-w-0 gap-4 overflow-hidden">
              <div className="rounded-3xl border border-white/8 bg-black/12 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">
                      {t('createBatch.captureStateCurrentBrief', { defaultValue: 'Current brief' })}
                    </div>
                    <div className="text-sm leading-6 text-white/80">{activeCaptureState.currentBrief}</div>
                    <div className="text-xs text-white/48">{activeCaptureState.sourceSummary}</div>
                  </div>
                  <LanePill mode={activeCaptureState.synthesisMode} captureMode={activeCaptureState.captureMode} />
                </div>
              </div>

              <div className="grid gap-4 2xl:grid-cols-2">
                <SummaryList
                  label={t('createBatch.captureFeelingAnchor', { defaultValue: 'Feeling anchor' })}
                  values={[activeCaptureState.feelingAnchor.coreVibe, ...activeCaptureState.feelingAnchor.tonePhrases].filter(Boolean)}
                  emptyLabel={t('createBatch.captureFeelingAnchorEmpty', { defaultValue: 'No stable feeling anchor yet.' })}
                />
                <SummaryList
                  label={t('createBatch.captureAvoidVibe', { defaultValue: 'Avoid vibe' })}
                  values={activeCaptureState.feelingAnchor.avoidVibe}
                  emptyLabel={t('createBatch.captureAvoidVibeEmpty', { defaultValue: 'No avoid-vibe cues yet.' })}
                />
                <SummaryList
                  label={t('createBatch.capturePreserveFocus', { defaultValue: 'Preserve focus' })}
                  values={activeCaptureState.workingMemory.preserveFocus}
                  emptyLabel={t('createBatch.capturePreserveFocusEmpty', { defaultValue: 'No preserve-focus items yet.' })}
                />
                <SummaryList
                  label={t('createBatch.captureAdjustFocus', { defaultValue: 'Adjust focus' })}
                  values={activeCaptureState.workingMemory.adjustFocus}
                  emptyLabel={t('createBatch.captureAdjustFocusEmpty', { defaultValue: 'No active adjustment focus yet.' })}
                />
              </div>

              <div className="grid gap-3 rounded-3xl border border-white/8 bg-black/12 px-4 py-4">
                <div className="text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">
                  {t('createBatch.captureVisualIntent', { defaultValue: 'Visual intent' })}
                </div>
                <TextField
                  id={`${activePortraitBriefFieldPrefix}-visual-role`}
                  value={activeCaptureState.visualIntent.visualRole}
                  onChange={(event) => onUpdateCaptureVisualIntent({ visualRole: event.target.value })}
                  aria-label={t('createBatch.visualRole')}
                />
                <TextField
                  id={`${activePortraitBriefFieldPrefix}-silhouette`}
                  value={activeCaptureState.visualIntent.silhouette}
                  onChange={(event) => onUpdateCaptureVisualIntent({ silhouette: event.target.value })}
                  aria-label={t('createBatch.silhouette')}
                />
                <TextField
                  id={`${activePortraitBriefFieldPrefix}-outfit`}
                  value={activeCaptureState.visualIntent.outfit}
                  onChange={(event) => onUpdateCaptureVisualIntent({ outfit: event.target.value })}
                  aria-label={t('createBatch.outfit')}
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <TextField
                    id={`${activePortraitBriefFieldPrefix}-hairstyle`}
                    value={activeCaptureState.visualIntent.hairstyle}
                    onChange={(event) => onUpdateCaptureVisualIntent({ hairstyle: event.target.value })}
                    aria-label={t('createBatch.hairstyle')}
                  />
                  <TextField
                    id={`${activePortraitBriefFieldPrefix}-palette`}
                    value={activeCaptureState.visualIntent.palettePrimary}
                    onChange={(event) => onUpdateCaptureVisualIntent({ palettePrimary: event.target.value })}
                    aria-label={t('createBatch.palette')}
                  />
                </div>
                <TextField
                  id={`${activePortraitBriefFieldPrefix}-must-keep-traits`}
                  value={activeCaptureState.visualIntent.mustKeepTraits.join(', ')}
                  onChange={(event) => onUpdateCaptureVisualIntent({
                    mustKeepTraits: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                  })}
                  aria-label={t('createBatch.mustKeepTraits')}
                />
                <TextField
                  id={`${activePortraitBriefFieldPrefix}-forbidden-traits`}
                  value={activeCaptureState.visualIntent.forbiddenTraits.join(', ')}
                  onChange={(event) => onUpdateCaptureVisualIntent({
                    forbiddenTraits: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                  })}
                  aria-label={t('createBatch.forbiddenTraits')}
                />
              </div>

              {activeCaptureState.captureMode === 'capture' ? (
                <div className="grid gap-3 rounded-3xl border border-white/8 bg-black/12 px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">
                    {t('createBatch.captureRefineLane', { defaultValue: 'Interactive capture lane' })}
                  </div>
                  <div className="max-h-[180px] space-y-2 overflow-auto rounded-2xl border border-white/8 bg-black/14 px-4 py-4 ld-scroll">
                    {activeCaptureState.messages.map((message) => (
                      <div key={message.messageId} className={`rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'assistant' ? 'border border-white/8 bg-white/5 text-white/76' : 'ml-auto max-w-[90%] border border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_16%,transparent)] text-white'}`}>
                        <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-[var(--ld-gold)]">
                          {message.role === 'assistant'
                            ? t('createBatch.worldStyleSessionAssistant')
                            : t('createBatch.worldStyleSessionOperator')}
                        </div>
                        <div>{message.text}</div>
                      </div>
                    ))}
                  </div>
                  <TextareaField
                    value={interactiveCaptureInput}
                    onChange={(event) => onInteractiveCaptureInputChange(event.target.value)}
                    placeholder={t('createBatch.captureRefinePlaceholder', { defaultValue: 'Describe what to preserve, what to push, and where this role should move next.' })}
                    disabled={interactiveCaptureActionBusy}
                    textareaClassName="min-h-[108px] text-sm text-white"
                  />
                  {interactiveCaptureError ? (
                    <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                      {interactiveCaptureError}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-3">
                    <Button
                      tone="primary"
                      onClick={onRunInteractiveCaptureRefine}
                      disabled={!interactiveCaptureInput.trim() || interactiveCaptureActionBusy}
                    >
                      {interactiveCaptureBusy
                        ? t('createBatch.captureRefineBusy', { defaultValue: 'Refining...' })
                        : t('createBatch.captureRefineRun', { defaultValue: 'Refine capture' })}
                    </Button>
                    <Button
                      tone="secondary"
                      onClick={onResetInteractiveCapture}
                      disabled={interactiveCaptureActionBusy}
                    >
                      {interactiveCaptureResetBusy
                        ? t('createBatch.captureResetBusy', { defaultValue: 'Resetting...' })
                        : t('createBatch.captureResetRun', { defaultValue: 'Reset capture' })}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/8 bg-black/12 px-4 py-4 text-sm text-white/62">
                  {t('createBatch.captureSilentLaneDescription', {
                    defaultValue: 'This agent stays on the silent capture lane. Lookdev still synthesizes a role-aware capture state, but it does not open a detailed operator conversation by default.',
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
