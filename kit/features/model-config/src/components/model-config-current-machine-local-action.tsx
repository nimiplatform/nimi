import { useEffect, useMemo, useRef, useState } from 'react';
import type { NimiPortableAppAIConfig, NimiPortableAppAIConfigIntent } from '@nimiplatform/kit/core/sdk-contract';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import {
  resolveModelConfigCurrentMachineLocalActionCopy,
} from '../current-machine-local-action-copy.js';
import {
  readModelConfigCurrentMachineLocalSelections,
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

// @nimi-authority: rule.nimi.platform.ui-design-system.p-model-config-002
export function ModelConfigCurrentMachineLocalAction(
  props: ModelConfigCurrentMachineLocalActionProps,
) {
  const copy = useMemo(
    () => resolveModelConfigCurrentMachineLocalActionCopy(props.language, props.ownerKey),
    [props.language, props.ownerKey],
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
  // Host query refreshes recreate arrays and callbacks. Only actual owner/config
  // changes invalidate an action; object identity is not a configuration change.
  const contextKey = JSON.stringify([
    props.ownerKey, explicitContracts, props.capabilities, props.revision, eligible,
  ]);
  const selectionKey = JSON.stringify([props.ownerKey, explicitContracts, eligible]);
  const contextRef = useRef({
    key: contextKey,
    ownerKey: props.ownerKey,
    contracts: explicitContracts,
    capabilities: props.capabilities,
    revision: props.revision,
    listOptions: props.listOptions,
    onOverwrite: props.onOverwrite,
    epoch: 0,
  });
  if (contextRef.current.key !== contextKey) {
    contextRef.current = {
      key: contextKey,
      ownerKey: props.ownerKey,
      contracts: explicitContracts,
      capabilities: props.capabilities,
      revision: props.revision,
      listOptions: props.listOptions,
      onOverwrite: props.onOverwrite,
      epoch: contextRef.current.epoch + 1,
    };
  }
  contextRef.current.listOptions = props.listOptions;
  contextRef.current.onOverwrite = props.onOverwrite;
  const contextEpoch = contextRef.current.epoch;
  const [selection, setSelection] = useState<{
    readonly key: string;
    readonly contracts: readonly string[] | null;
  } | null>(null);

  useEffect(() => {
    setStatus({ state: 'idle' });
  }, [contextEpoch]);

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    const context = contextRef.current;
    void readModelConfigCurrentMachineLocalSelections(context.contracts, context.listOptions!).then(
      (contracts) => {
        if (!cancelled) setSelection({ key: selectionKey, contracts });
      },
      () => {
        // An unavailable read cannot establish an applied state. The explicit
        // action still performs its own fresh reads and exposes retryable errors.
        if (!cancelled) setSelection({ key: selectionKey, contracts: null });
      },
    );
    return () => { cancelled = true; };
  }, [selectionKey, eligible]);

  const checking = eligible && selection?.key !== selectionKey;
  const applied = eligible && (status.state === 'committed'
    || (selection?.key === selectionKey && Boolean(selection.contracts?.length)
      && selection.contracts!.every((contract) => props.capabilities?.some((intent) => (
        intent.capabilityContract === contract && intent.route.oneofKind === 'local'
      )))));

  const execute = async () => {
    // The applied label describes the last observed machine selection. Machine
    // Loadouts can change without changing this owner's AIConfig revision, so
    // keep the action available and re-read the selection on every explicit use.
    if (!eligible || props.disabled || busy || checking) return;
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
      setSelection({ key: selectionKey, contracts: result.selectedCapabilityContracts });
      if (result.outcome === 'conflict') {
        setStatus({ state: 'conflict', result });
      } else if (result.outcome === 'no-selection') {
        setStatus({ state: 'no-selection' });
      } else {
        setStatus({ state: 'committed' });
      }
    } catch (error) {
      if (!isCurrent()) return;
      setSelection({ key: selectionKey, contracts: null });
      setStatus({
        state: 'failed',
        error: defaultFormatError(error, copy.failedLabel),
      });
    }
  };

  const showFeedback = !eligible
    || status.state === 'no-selection'
    || status.state === 'committed'
    || status.state === 'conflict'
    || status.state === 'failed';

  return (
    <div
      className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3"
      data-nimi-model-config-current-machine-local-action={eligible ? 'available' : 'unavailable'}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="2" />
            <rect x="9.5" y="9.5" width="5" height="5" />
            <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
          </svg>
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-text-primary)]">
            {copy.title}
          </div>
          <p className="m-0 mt-0.5 text-[length:var(--nimi-type-caption-size)] leading-relaxed text-[var(--nimi-text-muted)]">
            {copy.hint}
          </p>
        </div>
        <Button
          tone="secondary"
          size="sm"
          className="shrink-0"
          disabled={!eligible || Boolean(props.disabled) || busy || checking}
          loading={busy}
          onClick={() => { void execute(); }}
          data-testid="model-config-current-machine-local-action"
        >
          {status.state === 'loading'
            ? copy.loadingLabel
            : status.state === 'saving'
              ? copy.savingLabel
              : applied ? copy.appliedLabel : status.state === 'failed' ? copy.retryLabel : copy.label}
        </Button>
      </div>
      {showFeedback ? (
        <div className="mt-3 space-y-2">
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
      ) : null}
    </div>
  );
}
