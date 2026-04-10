import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CapabilityState } from '../tester-types.js';
import { toPrettyJson } from '../tester-utils.js';
import { ErrorBox, RawJsonSection, RunButton } from '../tester-diagnostics.js';

type VoiceClonePanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

export function VoiceClonePanel(props: VoiceClonePanelProps) {
  const { t } = useTranslation();
  const { state, onStateChange } = props;
  const [refAudioUri, setRefAudioUri] = React.useState('');
  const [targetModel, setTargetModel] = React.useState('');

  const handleRun = React.useCallback(() => {
    const requestParams: Record<string, unknown> = { refAudioUri, targetModel };
    onStateChange((prev) => ({
      ...prev,
      result: 'failed',
      error: t('Tester.voiceClone.error'),
      rawResponse: toPrettyJson({ error: t('Tester.voiceClone.sdkMethodUnavailable'), capability: 'runtime.media.voice.clone', requestParams }),
      diagnostics: { requestParams, resolvedRoute: null, responseMetadata: null },
    }));
  }, [onStateChange, refAudioUri, targetModel, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
        {t('Tester.voiceClone.banner')}
      </div>
      <input className="w-full rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs" value={refAudioUri} onChange={(event) => setRefAudioUri(event.target.value)} placeholder={t('Tester.voiceClone.refAudioPlaceholder')} />
      <input className="w-full rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs" value={targetModel} onChange={(event) => setTargetModel(event.target.value)} placeholder={t('Tester.voiceClone.targetModelPlaceholder')} />
      <RunButton busy={state.busy} label={t('Tester.voiceClone.run')} onClick={handleRun} />
      {state.error ? <ErrorBox message={state.error} /> : null}
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
  const [instruction, setInstruction] = React.useState('');

  const handleRun = React.useCallback(() => {
    const requestParams: Record<string, unknown> = { instruction };
    onStateChange((prev) => ({
      ...prev,
      result: 'failed',
      error: t('Tester.voiceDesign.error'),
      rawResponse: toPrettyJson({ error: t('Tester.voiceDesign.sdkMethodUnavailable'), capability: 'runtime.media.voice.design', requestParams }),
      diagnostics: { requestParams, resolvedRoute: null, responseMetadata: null },
    }));
  }, [instruction, onStateChange, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
        {t('Tester.voiceDesign.banner')}
      </div>
      <textarea className="h-20 w-full resize-y rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={t('Tester.voiceDesign.instructionPlaceholder')} />
      <RunButton busy={state.busy} label={t('Tester.voiceDesign.run')} onClick={handleRun} />
      {state.error ? <ErrorBox message={state.error} /> : null}
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
