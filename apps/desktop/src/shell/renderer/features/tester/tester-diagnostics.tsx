import React from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagnosticsInfo } from './tester-types.js';
import { toPrettyJson } from './tester-utils.js';

function KVRow(props: {
  field: string;
  value: string | number | undefined | null;
  mono?: boolean;
  highlight?: 'green' | 'red' | 'blue' | 'gray';
}) {
  if (props.value === undefined || props.value === null || props.value === '') return null;
  const colorMap = {
    green: 'text-green-700',
    red: 'text-red-700',
    blue: 'text-blue-700',
    gray: 'text-gray-500',
  };
  const valueClass = props.mono
    ? `font-mono ${props.highlight ? colorMap[props.highlight] : 'text-gray-900'}`
    : (props.highlight ? colorMap[props.highlight] : 'text-gray-900');
  return (
    <div className="grid grid-cols-[140px_1fr] gap-x-2 py-0.5">
      <span className="text-gray-400 truncate">{props.field}</span>
      <span className={`truncate ${valueClass}`}>{String(props.value)}</span>
    </div>
  );
}

export function DiagnosticsPanel(props: { diagnostics: DiagnosticsInfo }) {
  const { t } = useTranslation();
  const { diagnostics } = props;
  if (!diagnostics.requestParams && !diagnostics.resolvedRoute && !diagnostics.responseMetadata) {
    return null;
  }
  const meta = diagnostics.responseMetadata;
  const route = diagnostics.resolvedRoute;
  const params = diagnostics.requestParams;
  return (
    <div className="flex flex-col gap-2 text-xs">
      {params ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="mb-1.5 font-semibold text-gray-600">{t('Tester.diagnostics.requestParams')}</div>
          {Object.entries(params).map(([k, v]) => {
            if (v === undefined || v === null || v === '') return null;
            const displayValue = typeof v === 'object' ? toPrettyJson(v) : String(v);
            if (displayValue.length > 200 || displayValue.includes('\n')) {
              return (
                <div key={k} className="mb-1">
                  <span className="text-gray-400">{k}</span>
                  <pre className="mt-0.5 whitespace-pre-wrap break-all rounded bg-gray-50 px-2 py-1 font-mono text-xs text-gray-900">{displayValue}</pre>
                </div>
              );
            }
            return <KVRow key={k} field={k} value={displayValue} mono />;
          })}
        </div>
      ) : null}

      {route ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="mb-1.5 font-semibold text-gray-600">{t('Tester.diagnostics.routePreview')}</div>
          <KVRow field="source" value={route.source} mono highlight="blue" />
          <KVRow field="provider" value={route.provider} mono />
          <KVRow field="model" value={route.model} mono />
          <KVRow field="modelId" value={route.modelId} mono />
          <KVRow field="connectorId" value={route.connectorId} mono />
          <KVRow field="endpoint" value={route.endpoint} mono />
          <KVRow field="adapter" value={route.adapter} mono />
          <KVRow field="engine" value={route.engine} mono />
          <KVRow field="localModelId" value={route.localModelId} mono />
          <KVRow field="goRuntimeLocalModelId" value={route.goRuntimeLocalModelId} mono />
          <KVRow field="goRuntimeStatus" value={route.goRuntimeStatus} mono />
          <KVRow field="localProviderEndpoint" value={route.localProviderEndpoint} mono />
        </div>
      ) : null}

      {meta ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="mb-1.5 font-semibold text-gray-600">{t('Tester.diagnostics.responseMetadata')}</div>
          {meta.elapsed !== undefined ? <KVRow field="elapsed" value={`${meta.elapsed} ms`} highlight="blue" /> : null}
          {meta.finishReason !== undefined ? (
            <KVRow field="finishReason" value={meta.finishReason} mono highlight={meta.finishReason === 'stop' ? 'green' : meta.finishReason === 'error' ? 'red' : undefined} />
          ) : null}
          {meta.inputTokens !== undefined ? <KVRow field="inputTokens" value={meta.inputTokens} /> : null}
          {meta.outputTokens !== undefined ? <KVRow field="outputTokens" value={meta.outputTokens} /> : null}
          {meta.totalTokens !== undefined ? <KVRow field="totalTokens" value={meta.totalTokens} /> : null}
          {meta.traceId ? <KVRow field="traceId" value={meta.traceId} mono /> : null}
          {meta.modelResolved ? <KVRow field="modelResolved" value={meta.modelResolved} mono /> : null}
          {meta.jobId ? <KVRow field="jobId" value={meta.jobId} mono /> : null}
          {meta.artifactCount !== undefined ? <KVRow field="artifacts" value={meta.artifactCount} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export function RunButton(props: {
  busy: boolean;
  busyLabel?: string;
  label: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="inline-flex self-start items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      disabled={props.busy}
      onClick={props.onClick}
    >
      {props.busy ? (
        <>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/90 [animation-delay:-0.2s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/90 [animation-delay:-0.1s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/90" />
          </span>
          <span>{(props.busyLabel || t('Tester.diagnostics.running')).replace(/\.{3}$/, '')}</span>
        </>
      ) : (
        props.label
      )}
    </button>
  );
}

export function ErrorBox(props: { message: string }) {
  return <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">{props.message}</div>;
}

export function InfoBox(props: { message: string }) {
  return <div className="rounded-md bg-blue-50 p-2 text-xs text-blue-700">{props.message}</div>;
}

export function RawJsonSection(props: { content: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);
  const handleCopy = React.useCallback(() => {
    void navigator.clipboard.writeText(props.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [props.content]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded border border-gray-300 bg-white px-3 py-1 text-xs text-gray-500 hover:bg-gray-100 active:bg-gray-200"
    >
      {copied ? '\u2713 ' + t('Tester.diagnostics.copied') : t('Tester.diagnostics.copyRawJson')}
    </button>
  );
}
