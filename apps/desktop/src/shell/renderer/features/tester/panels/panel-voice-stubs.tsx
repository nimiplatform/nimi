import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import type { CapabilityState } from '../tester-types.js';
import { asString } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection, RunButton } from '../tester-diagnostics.js';
import { buildTesterSpeechFailure, runTesterVoiceClone, runTesterVoiceDesign } from '../tester-speech-actions.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

type VoiceClonePanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

export function VoiceClonePanel(props: VoiceClonePanelProps) {
  const { t } = useTranslation();
  const { state, onStateChange } = props;
  const [prompt, setPrompt] = React.useState('Hello from the desktop tester voice clone workflow.');
  const [preferredName, setPreferredName] = React.useState('tester-clone');
  const [referenceAudioUri, setReferenceAudioUri] = React.useState('');
  const [referenceAudioFile, setReferenceAudioFile] = React.useState<File | null>(null);
  const [referenceAudioMime, setReferenceAudioMime] = React.useState('');

  const handleRun = React.useCallback(async () => {
    if (!asString(prompt)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.voiceClone.promptEmpty', { defaultValue: 'Voice clone prompt is required.' }) }));
      return;
    }
    if (!referenceAudioFile && !asString(referenceAudioUri)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.voiceClone.referenceAudioRequired', { defaultValue: 'Reference audio URL or file is required.' }) }));
      return;
    }
    const binding = resolveEffectiveBinding(state.snapshot, state.binding) || undefined;
    const inferredMimeType = asString(referenceAudioMime) || asString(referenceAudioFile?.type);
    if (!inferredMimeType) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.voiceClone.referenceAudioMimeRequired', { defaultValue: 'Reference audio MIME type is required.' }) }));
      return;
    }
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const t0 = Date.now();
    const referenceAudio = referenceAudioFile
      ? { kind: 'bytes' as const, bytes: new Uint8Array(await referenceAudioFile.arrayBuffer()) }
      : { kind: 'url' as const, url: referenceAudioUri };
    const requestParams: Record<string, unknown> = {
      prompt,
      preferredName,
      referenceAudioMime: inferredMimeType,
      referenceAudio: referenceAudioFile
        ? { kind: 'bytes', bytes: `[${referenceAudioFile.size} bytes]`, fileName: referenceAudioFile.name }
        : { kind: 'url', url: referenceAudioUri },
      ...(binding ? { binding } : {}),
    };
    try {
      const result = await runTesterVoiceClone({
        binding,
        prompt,
        preferredName,
        referenceAudio,
        referenceAudioMime: inferredMimeType,
      });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: result.result,
        output: result.output,
        rawResponse: result.rawResponse,
        diagnostics: result.diagnostics,
      }));
    } catch (error) {
      const failed = buildTesterSpeechFailure(error, {
        fallbackMessage: t('Tester.voiceClone.error', { defaultValue: 'Voice clone failed.' }),
        requestParams,
        binding,
        elapsed: Date.now() - t0,
      });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: failed.result,
        error: failed.error,
        rawResponse: failed.rawResponse,
        diagnostics: failed.diagnostics,
      }));
    }
  }, [onStateChange, preferredName, prompt, referenceAudioFile, referenceAudioMime, referenceAudioUri, state.binding, state.snapshot, t]);

  const output = state.output as {
    workflowStatus?: string;
    voiceAssetId?: string;
    providerVoiceRef?: string;
    status?: string;
    preferredName?: string;
  } | null;

  return (
    <div data-testid={E2E_IDS.testerPanel('voice_workflow.tts_v2v')} className="flex flex-col gap-3">
      <div data-testid={E2E_IDS.testerInput('voice-clone-prompt')}>
        <TextareaField
          className="font-mono text-xs"
          textareaClassName="h-20"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t('Tester.voiceClone.promptPlaceholder', { defaultValue: 'Speech text for the cloned voice.' })}
        />
      </div>
      <TextField
        className="font-mono text-xs"
        value={preferredName}
        onChange={(event) => setPreferredName(event.target.value)}
        placeholder={t('Tester.voiceClone.preferredNamePlaceholder', { defaultValue: 'Preferred voice asset name' })}
      />
      <TextField
        className="font-mono text-xs"
        value={referenceAudioUri}
        onChange={(event) => setReferenceAudioUri(event.target.value)}
        placeholder={t('Tester.voiceClone.refAudioPlaceholder')}
      />
      <label className="flex flex-col gap-1 text-xs text-[var(--nimi-text-muted)]">
        <span>{t('Tester.voiceClone.audioFile', { defaultValue: 'Reference audio file' })}</span>
        <input
          type="file"
          accept="audio/*"
          data-testid={E2E_IDS.testerInput('voice-clone-file')}
          className="block rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border)] bg-[var(--nimi-surface-card)] px-2 py-1 text-xs text-[var(--nimi-text-primary)]"
          onChange={(event) => setReferenceAudioFile(event.target.files?.[0] || null)}
        />
      </label>
      <TextField
        className="font-mono text-xs"
        value={referenceAudioMime}
        onChange={(event) => setReferenceAudioMime(event.target.value)}
        placeholder={t('Tester.voiceClone.referenceAudioMimePlaceholder', { defaultValue: 'audio/wav' })}
      />
      <RunButton busy={state.busy} label={t('Tester.voiceClone.run')} onClick={() => { void handleRun(); }} />
      {state.error ? <ErrorBox message={state.error} /> : null}
      {output ? (
        <ScrollArea className="max-h-40 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)]">
          <pre className="p-2 text-xs">
            {[
              `workflowStatus: ${asString(output.workflowStatus) || 'unknown'}`,
              `voiceAssetId: ${asString(output.voiceAssetId) || 'n/a'}`,
              `providerVoiceRef: ${asString(output.providerVoiceRef) || 'n/a'}`,
              `assetStatus: ${asString(output.status) || 'n/a'}`,
              `preferredName: ${asString(output.preferredName) || 'n/a'}`,
            ].join('\n')}
          </pre>
        </ScrollArea>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}

type VoiceDesignPanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

export function VoiceDesignPanel(props: VoiceDesignPanelProps) {
  const { t } = useTranslation();
  const { state, onStateChange } = props;
  const [instructionText, setInstructionText] = React.useState('Warm, clear Mandarin speaking voice with steady pacing.');
  const [previewText, setPreviewText] = React.useState('Hello from the desktop tester voice design workflow.');
  const [language, setLanguage] = React.useState('');
  const [preferredName, setPreferredName] = React.useState('tester-design');

  const handleRun = React.useCallback(async () => {
    if (!asString(instructionText)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.voiceDesign.instructionEmpty', { defaultValue: 'Voice design instruction is required.' }) }));
      return;
    }
    const binding = resolveEffectiveBinding(state.snapshot, state.binding) || undefined;
    const requestParams: Record<string, unknown> = {
      instructionText,
      previewText: asString(previewText) || instructionText,
      language,
      preferredName,
      ...(binding ? { binding } : {}),
    };
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const t0 = Date.now();
    try {
      const result = await runTesterVoiceDesign({
        binding,
        instructionText,
        previewText: asString(previewText) || instructionText,
        language,
        preferredName,
      });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: result.result,
        output: result.output,
        rawResponse: result.rawResponse,
        diagnostics: result.diagnostics,
      }));
    } catch (error) {
      const failed = buildTesterSpeechFailure(error, {
        fallbackMessage: t('Tester.voiceDesign.error'),
        requestParams,
        binding,
        elapsed: Date.now() - t0,
      });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: failed.result,
        error: failed.error,
        rawResponse: failed.rawResponse,
        diagnostics: failed.diagnostics,
      }));
    }
  }, [instructionText, language, onStateChange, preferredName, previewText, state.binding, state.snapshot, t]);

  const output = state.output as {
    workflowStatus?: string;
    voiceAssetId?: string;
    providerVoiceRef?: string;
    status?: string;
    preferredName?: string;
  } | null;

  return (
    <div data-testid={E2E_IDS.testerPanel('voice_workflow.tts_t2v')} className="flex flex-col gap-3">
      <div data-testid={E2E_IDS.testerInput('voice-design-instruction')}>
        <TextareaField
          className="font-mono text-xs"
          textareaClassName="h-20"
          value={instructionText}
          onChange={(event) => setInstructionText(event.target.value)}
          placeholder={t('Tester.voiceDesign.instructionPlaceholder')}
        />
      </div>
      <TextareaField
        className="font-mono text-xs"
        textareaClassName="h-20"
        value={previewText}
        onChange={(event) => setPreviewText(event.target.value)}
        placeholder={t('Tester.voiceDesign.previewTextPlaceholder', { defaultValue: 'Preview text used to audition the designed voice.' })}
      />
      <div className="grid grid-cols-2 gap-2">
        <TextField
          className="font-mono text-xs"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          placeholder={t('Tester.voiceDesign.languagePlaceholder', { defaultValue: 'Language (optional)' })}
        />
        <TextField
          className="font-mono text-xs"
          value={preferredName}
          onChange={(event) => setPreferredName(event.target.value)}
          placeholder={t('Tester.voiceDesign.preferredNamePlaceholder', { defaultValue: 'Preferred voice asset name' })}
        />
      </div>
      <RunButton busy={state.busy} label={t('Tester.voiceDesign.run')} onClick={() => { void handleRun(); }} />
      {state.error ? <ErrorBox message={state.error} /> : null}
      {output ? (
        <ScrollArea className="max-h-40 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)]">
          <pre className="p-2 text-xs">
            {[
              `workflowStatus: ${asString(output.workflowStatus) || 'unknown'}`,
              `voiceAssetId: ${asString(output.voiceAssetId) || 'n/a'}`,
              `providerVoiceRef: ${asString(output.providerVoiceRef) || 'n/a'}`,
              `assetStatus: ${asString(output.status) || 'n/a'}`,
              `preferredName: ${asString(output.preferredName) || 'n/a'}`,
            ].join('\n')}
          </pre>
        </ScrollArea>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
