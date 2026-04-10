import React from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import type { CapabilityState } from '../tester-types.js';
import type { VideoParamsState } from '@nimiplatform/nimi-kit/features/model-config';
import { asString, stripArtifacts, toPrettyJson } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { getRuntimeClient, resolveCallParams, bindingToRouteInfo } from '../tester-runtime.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection, RunButton } from '../tester-diagnostics.js';

type VideoGeneratePanelProps = {
  state: CapabilityState;
  binding?: CapabilityState['binding'];
  params: VideoParamsState;
  onParamsChange: (next: VideoParamsState) => void;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

export function VideoGeneratePanel(props: VideoGeneratePanelProps) {
  const { t } = useTranslation();
  const { onParamsChange, params, state, onStateChange } = props;
  const [prompt, setPrompt] = React.useState('A serene mountain landscape with flowing clouds.');
  const [refImageUri, setRefImageUri] = React.useState('');
  const isI2v = params.mode !== 't2v';

  const resolvedMode = params.mode as 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference';
  const handleRun = React.useCallback(async () => {
    if (!asString(prompt)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.videoGenerate.promptEmpty') }));
      return;
    }
    if (isI2v && !asString(refImageUri)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.videoGenerate.referenceRequired') }));
      return;
    }
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const t0 = Date.now();
    const binding = resolveEffectiveBinding(state.snapshot, props.binding ?? state.binding) || undefined;
    const contentItems: Array<{ type: 'text'; role: 'prompt'; text: string } | { type: 'image_url'; role: 'reference_image' | 'first_frame'; imageUrl: string }> = [
      { type: 'text', role: 'prompt', text: prompt },
    ];
    if (isI2v && asString(refImageUri)) {
      const role = params.mode === 'i2v-first-frame' ? 'first_frame' : 'reference_image';
      contentItems.push({ type: 'image_url', role, imageUrl: refImageUri });
    }
    const options = {
      ratio: params.ratio,
      durationSec: Number(params.durationSec) || 5,
      generateAudio: params.generateAudio,
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(params.fps ? { fps: Number(params.fps) || undefined } : {}),
      ...(params.seed ? { seed: Number(params.seed) || undefined } : {}),
      ...(params.timeoutMs ? { timeoutMs: Number(params.timeoutMs) || undefined } : {}),
      ...(params.cameraFixed ? { cameraFixed: true } : {}),
    };
    const requestParams: Record<string, unknown> = {
      mode: resolvedMode,
      prompt,
      options,
      ...(refImageUri ? { refImageUri } : {}),
      content: contentItems,
      ...(binding ? { binding } : {}),
    };
    try {
      const callParams = await resolveCallParams(binding);
      const routeInfo = bindingToRouteInfo(binding);
      const result = await getRuntimeClient().media.video.generate({
        model: callParams.model,
        route: callParams.route,
        connectorId: callParams.connectorId,
        mode: resolvedMode,
        content: contentItems,
        prompt,
        options,
        metadata: callParams.metadata,
      });
      const elapsed = Date.now() - t0;
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'passed',
        output: result,
        rawResponse: toPrettyJson({ request: requestParams, response: stripArtifacts(result) }),
        diagnostics: {
          requestParams,
          resolvedRoute: routeInfo,
          responseMetadata: {
            jobId: (result.job as unknown as Record<string, unknown>)?.jobId as string | undefined,
            artifactCount: result.artifacts?.length,
            traceId: result.trace?.traceId,
            modelResolved: result.trace?.modelResolved,
            elapsed,
          },
        },
      }));
    } catch (error) {
      const elapsed = Date.now() - t0;
      const baseMessage = error instanceof Error ? error.message : String(error || t('Tester.videoGenerate.failed'));
      const details = (error as Record<string, unknown>)?.details as Record<string, unknown> | undefined;
      const providerMessage = details?.provider_message as string | undefined;
      const message = providerMessage ? `${baseMessage} [provider: ${providerMessage}]` : baseMessage;
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'failed',
        error: message,
        rawResponse: toPrettyJson({ request: requestParams, error: message, details }),
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: { elapsed } },
      }));
    }
  }, [isI2v, onStateChange, params, prompt, props.binding, refImageUri, resolvedMode, state.binding, state.snapshot, t]);

  const modeOptions = [
    { value: 't2v', label: t('Tester.videoGenerate.t2v') },
    { value: 'i2v-first-frame', label: t('Tester.videoGenerate.i2vFirstFrame') },
    { value: 'i2v-reference', label: t('Tester.videoGenerate.i2vReference') },
  ];

  const ratioOptions = [
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
    { value: '1:1', label: '1:1' },
    { value: '4:3', label: '4:3' },
    { value: '3:4', label: '3:4' },
    { value: '21:9', label: '21:9' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--nimi-text-muted)]">{t('Tester.videoGenerate.mode')}</span>
        <SelectField options={modeOptions} value={params.mode} onValueChange={(value) => onParamsChange({ ...params, mode: value })} />
      </div>
      <TextareaField className="font-mono text-xs" textareaClassName="h-20" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t('Tester.videoGenerate.promptPlaceholder')} />
      {isI2v ? (
        <TextField className="font-mono text-xs" value={refImageUri} onChange={(event) => setRefImageUri(event.target.value)} placeholder={t('Tester.videoGenerate.refImagePlaceholder')} />
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--nimi-text-muted)]">{t('Tester.videoGenerate.ratio')}</span>
          <SelectField options={ratioOptions} value={params.ratio} onValueChange={(value) => onParamsChange({ ...params, ratio: value })} />
        </div>
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--nimi-text-muted)]">{t('Tester.videoGenerate.duration')}</span>
          <TextField type="number" min={1} max={11} value={params.durationSec} onChange={(event) => onParamsChange({ ...params, durationSec: event.target.value || '5' })} />
        </div>
        <label className="flex items-center gap-1.5 text-xs pt-4">
          <input type="checkbox" checked={params.generateAudio} onChange={(event) => onParamsChange({ ...params, generateAudio: event.target.checked })} />
          <span className="text-[var(--nimi-text-muted)]">{t('Tester.videoGenerate.audio')}</span>
        </label>
      </div>
      <RunButton busy={state.busy} label={t('Tester.videoGenerate.run')} onClick={() => { void handleRun(); }} />
      {state.error ? <ErrorBox message={state.error} /> : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
