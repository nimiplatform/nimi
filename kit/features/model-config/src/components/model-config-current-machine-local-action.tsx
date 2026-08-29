import { useEffect, useMemo, useRef, useState } from 'react';
import type { NimiPortableAppAIConfig, NimiPortableAppAIConfigIntent } from '@nimiplatform/kit/core/sdk-contract';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import {
  resolveModelConfigCurrentMachineLocalActionCopy,
} from '../current-machine-local-action-copy.js';
import {
  runModelConfigCurrentMachineLocalAction,
  type ModelConfigCurrentMachineLocalActionResult,
} from '../current-machine-local-action.js';
import type {
  ModelConfigCurrentMachineLocalActionCopy,
  ModelConfigFormattedError,
  ModelConfigListOptions,
  ModelConfigOverwrite,
} from '../types.js';

type ActionStatus =
  | { readonly state: 'idle' | 'loading' | 'saving' | 'no-selection' | 'committed' }
  | { readonly state: 'conflict'; readonly result: Extract<ModelConfigCurrentMachineLocalActionResult, { readonly outcome: 'conflict' }> }
  | { readonly state: 'failed'; readonly error: ModelConfigFormattedError };

export type ModelConfigCurrentMachineLocalActionProps = Readonly<{
  readonly capabilityContracts: readonly string[];
  readonly ownerKey: string;
  readonly capabilities: readonly NimiPortableAppAIConfigIntent[] | null | undefined;
  readonly revision?: string;
  readonly listOptions?: ModelConfigListOptions;
  readonly onOverwrite?: ModelConfigOverwrite;
  readonly disabled?: boolean;
  readonly language?: string | null;
}>;

function defaultFormatError(error: unknown, fallback: string): ModelConfigFormattedError {
  return {
    message: fallback,
    technicalDetail: error instanceof Error ? error.message : String(error),
  };
}

function configSummary(
  config: NimiPortableAppAIConfig | null,
  copy: ModelConfigCurrentMachineLocalActionCopy,
): string {
  if (!config || config.capabilities.length === 0) return copy.currentConfigEmptyLabel;
  return config.capabilities.map((intent) => (
    `${intent.capabilityContract}: ${intent.route.oneofKind === 'local'
      ? copy.currentConfigLocalLabel
      : intent.route.oneofKind === 'cloud'
        ? copy.currentConfigCloudLabel
        : copy.currentConfigUnsetLabel}`
  )).join(', ');
}

function interpolate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/gu, (match, key: string) => values[key] ?? match);
}

// Candidate composition remains unmounted until the single active WP6 hard cut.
// @nimi-authority: rule.nimi.platform.ui-design-system.p-model-config-002
export function ModelConfigCurrentMachineLocalAction(
  props: ModelConfigCurrentMachineLocalActionProps,
) {
  const copy = useMemo(
    () => resolveModelConfigCurrentMachineLocalActionCopy(props.language),
    [props.language],
  );
  const [status, setStatus] = useState<ActionStatus>({ state: 'idle' });
  const explicitContracts = useMemo(() => [
    ...new Set(props.capabilityContracts.map((entry) => entry.trim()).filter(Boolean)),
  ], [props.capabilityContracts]);
  const eligible = explicitContracts.length > 0
    && props.capabilities !== undefined
    && typeof props.revision === 'string'
    && props.revision.length > 0
    && typeof props.listOptions === 'function'
    && typeof props.onOverwrite === 'function';
  const busy = status.state === 'loading' || status.state === 'saving';
  const contextRef = useRef({
    ownerKey: props.ownerKey,
    contracts: explicitContracts,
    capabilities: props.capabilities,
    revision: props.revision,
    listOptions: props.listOptions,
    onOverwrite: props.onOverwrite,
    epoch: 0,
  });
  if (contextRef.current.ownerKey !== props.ownerKey
    || contextRef.current.contracts !== explicitContracts
    || contextRef.current.capabilities !== props.capabilities
    || contextRef.current.revision !== props.revision
    || contextRef.current.listOptions !== props.listOptions
    || contextRef.current.onOverwrite !== props.onOverwrite) {
    contextRef.current = {
      ownerKey: props.ownerKey,
      contracts: explicitContracts,
      capabilities: props.capabilities,
      revision: props.revision,
      listOptions: props.listOptions,
      onOverwrite: props.onOverwrite,
      epoch: contextRef.current.epoch + 1,
    };
  }
  const contextEpoch = contextRef.current.epoch;

  useEffect(() => {
    setStatus({ state: 'idle' });
  }, [contextEpoch]);

  const execute = async () => {
    if (!eligible || busy) return;
    const actionEpoch = contextRef.current.epoch;
    const isCurrent = () => contextRef.current.epoch === actionEpoch;
    setStatus({ state: 'loading' });
    try {
      const result = await runModelConfigCurrentMachineLocalAction({
        capabilityContracts: explicitContracts,
        capabilities: props.capabilities || [],
        revision: props.revision!,
        listOptions: props.listOptions!,
        onOverwrite: async (input) => {
          if (!isCurrent()) {
            throw new Error('Model configuration owner changed before mutation.');
          }
          setStatus({ state: 'saving' });
          return props.onOverwrite!(input);
        },
        isCurrent,
      });
      if (!isCurrent()) return;
      if (result.outcome === 'conflict') {
        setStatus({ state: 'conflict', result });
      } else if (result.outcome === 'no-selection') {
        setStatus({ state: 'no-selection' });
      } else {
        setStatus({ state: 'committed' });
      }
    } catch (error) {
      if (!isCurrent()) return;
      setStatus({
        state: 'failed',
        error: defaultFormatError(error, copy.failedLabel),
      });
    }
  };

  return (
    <div className="space-y-2" data-nimi-model-config-current-machine-local-action={eligible ? 'available' : 'unavailable'}>
      <Button
        tone="secondary"
        disabled={!eligible || Boolean(props.disabled) || busy}
        loading={busy}
        onClick={() => { void execute(); }}
        data-testid="model-config-current-machine-local-action"
      >
        {status.state === 'loading'
          ? copy.loadingLabel
          : status.state === 'saving'
            ? copy.savingLabel
            : status.state === 'failed' ? copy.retryLabel : copy.label}
      </Button>
      <p className="m-0 text-xs text-[var(--nimi-text-muted)]">{copy.hint}</p>
      {!eligible ? <InlineAlert tone="warning">{copy.unavailableLabel}</InlineAlert> : null}
      {status.state === 'no-selection' ? <InlineAlert tone="warning">{copy.noSelectionLabel}</InlineAlert> : null}
      {status.state === 'committed' ? <InlineAlert tone="success">{copy.committedLabel}</InlineAlert> : null}
      {status.state === 'conflict' ? (
        <InlineAlert tone="warning">
          <div>{copy.conflictLabel}</div>
          <div data-nimi-model-config-current-machine-local-conflict="true">
            {interpolate(copy.conflictCurrentLabel, {
              revision: status.result.revision,
              summary: configSummary(status.result.config, copy),
            })}
          </div>
        </InlineAlert>
      ) : null}
      {status.state === 'failed' ? (
        <div className="space-y-2">
          <InlineAlert tone="danger">{status.error.message}</InlineAlert>
          {status.error.technicalDetail ? (
            <details className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] p-2 text-xs text-[var(--nimi-text-secondary)]">
              <summary className="cursor-pointer font-semibold">{copy.technicalDetailsLabel}</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[length:var(--nimi-type-overline-size)]">{status.error.technicalDetail}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
