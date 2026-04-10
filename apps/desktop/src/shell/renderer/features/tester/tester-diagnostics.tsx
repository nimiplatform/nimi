import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
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
    green: 'text-[var(--nimi-status-success)]',
    red: 'text-[var(--nimi-status-danger)]',
    blue: 'text-[var(--nimi-status-info)]',
    gray: 'text-[var(--nimi-text-muted)]',
  };
  const valueClass = props.mono
    ? `font-mono ${props.highlight ? colorMap[props.highlight] : 'text-[var(--nimi-text-primary)]'}`
    : (props.highlight ? colorMap[props.highlight] : 'text-[var(--nimi-text-primary)]');
  return (
    <div className="grid grid-cols-[140px_1fr] gap-x-2 py-0.5">
      <span className="text-[var(--nimi-text-muted)] truncate">{props.field}</span>
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
        <Surface tone="card" padding="sm">
          <div className="mb-1.5 font-semibold text-[var(--nimi-text-secondary)]">{t('Tester.diagnostics.requestParams')}</div>
          {Object.entries(params).map(([k, v]) => {
            if (v === undefined || v === null || v === '') return null;
            const displayValue = typeof v === 'object' ? toPrettyJson(v) : String(v);
            if (displayValue.length > 200 || displayValue.includes('\n')) {
              return (
                <div key={k} className="mb-1">
                  <span className="text-[var(--nimi-text-muted)]">{k}</span>
                  <pre className="mt-0.5 whitespace-pre-wrap break-all rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-canvas)] px-2 py-1 font-mono text-xs text-[var(--nimi-text-primary)]">{displayValue}</pre>
                </div>
              );
            }
            return <KVRow key={k} field={k} value={displayValue} mono />;
          })}
        </Surface>
      ) : null}

      {route ? (
        <Surface tone="card" padding="sm">
          <div className="mb-1.5 font-semibold text-[var(--nimi-text-secondary)]">{t('Tester.diagnostics.routePreview')}</div>
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
        </Surface>
      ) : null}

      {meta ? (
        <Surface tone="card" padding="sm">
          <div className="mb-1.5 font-semibold text-[var(--nimi-text-secondary)]">{t('Tester.diagnostics.responseMetadata')}</div>
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
        </Surface>
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
    <Button
      tone="primary"
      size="sm"
      className="self-start"
      disabled={props.busy}
      onClick={props.onClick}
    >
      {props.busy ? (
        <>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current opacity-70 [animation-delay:-0.2s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current opacity-70 [animation-delay:-0.1s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current opacity-70" />
          </span>
          {(props.busyLabel || t('Tester.diagnostics.running')).replace(/\.{3}$/, '')}
        </>
      ) : (
        props.label
      )}
    </Button>
  );
}

export function ErrorBox(props: { message: string }) {
  return (
    <div className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-status-danger)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] p-2 text-xs text-[var(--nimi-status-danger)]">
      {props.message}
    </div>
  );
}

export function InfoBox(props: { message: string }) {
  return (
    <div className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-status-info)] bg-[color-mix(in_srgb,var(--nimi-status-info)_8%,transparent)] p-2 text-xs text-[var(--nimi-status-info)]">
      {props.message}
    </div>
  );
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
    <Button tone="secondary" size="sm" className="self-start" onClick={handleCopy}>
      {copied ? '\u2713 ' + t('Tester.diagnostics.copied') : t('Tester.diagnostics.copyRawJson')}
    </Button>
  );
}
