import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { runtimeSlotRegistry } from '@renderer/mod-ui/registry/slot-registry';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { i18n } from '@renderer/i18n';
import type {
  UiExtensionContext,
  UiExtensionRegistration,
  UiSlotId,
} from '@renderer/mod-ui/contracts';
import { logSlotConflicts } from './conflict-log';
import { renderSlotEntry } from './render-entry';
import { retryRuntimeMod } from './retry-runtime-mod';

type SlotHostProps = {
  slot: UiSlotId;
  base: ReactNode;
  context: UiExtensionContext;
};

function extractErrorChain(error: unknown): string[] {
  const chain: string[] = [];
  let current: unknown = error;
  let depth = 0;
  const maxDepth = 6;

  while (current && depth < maxDepth) {
    if (current instanceof Error) {
      const name = String(current.name || '').trim();
      const message = String(current.message || '').trim();
      const entry = message
        ? (name ? `${name}: ${message}` : message)
        : (name || 'Error');
      chain.push(entry);

      const candidate = (current as Error & { cause?: unknown }).cause;
      if (!candidate) break;
      current = candidate;
      depth += 1;
      continue;
    }

    const fallback = String(current || '').trim();
    if (fallback) {
      chain.push(fallback);
    }
    break;
  }

  return chain.filter(Boolean);
}

export function SlotHost(props: SlotHostProps) {
  const { slot, base, context } = props;
  const resolution = runtimeSlotRegistry.resolve(slot);
  const [retryingModId, setRetryingModId] = useState<string | null>(null);
  const localManifestSummaries = useAppStore((state) => state.localManifestSummaries);
  const runtimeModDisabledIds = useAppStore((state) => state.runtimeModDisabledIds);
  const runtimeModUninstalledIds = useAppStore((state) => state.runtimeModUninstalledIds);
  const setRuntimeModFailures = useAppStore((state) => state.setRuntimeModFailures);
  const runtimeModFailures = useAppStore((state) => state.runtimeModFailures);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const fusedRuntimeMods = useAppStore((state) => state.fusedRuntimeMods);

  useEffect(() => {
    logSlotConflicts(slot, resolution.conflicts);
  }, [resolution.conflicts, slot]);

  const retryMod = useCallback(async (modId: string) => {
    const normalizedModId = String(modId || '').trim();
    if (!normalizedModId) {
      return;
    }
    setRetryingModId(normalizedModId);
    try {
      await retryRuntimeMod({
        modId: normalizedModId,
        context,
        localManifestSummaries,
        runtimeModDisabledIds,
        runtimeModUninstalledIds,
        setRuntimeModFailures,
        setStatusBanner,
      });
    } finally {
      setRetryingModId(null);
    }
  }, [
    context,
    localManifestSummaries,
    runtimeModDisabledIds,
    runtimeModUninstalledIds,
    setRuntimeModFailures,
    setStatusBanner,
  ]);

  const handleRenderFailure = useCallback((entry: UiExtensionRegistration, error: unknown) => {
    const renderChain = extractErrorChain(error);
    const bootstrapChain = runtimeModFailures
      .filter((failure) => failure.modId === entry.modId)
      .map((failure) => `[${failure.stage}] ${failure.error}`);
    const mergedChain = [
      ...bootstrapChain,
      ...renderChain,
    ];
    const mergedMessage = mergedChain.join(' -> ') || 'render failed';

    context.markModFused(entry.modId, mergedMessage, 'render');
    setStatusBanner({
      kind: 'warning',
      message: i18n.t('ModUI.renderFailedWithChain', {
        modId: entry.modId,
        chain: mergedMessage,
        defaultValue: `Mod ${entry.modId} render failed, error chain: ${mergedMessage}`,
      }),
    });
    logRendererEvent({
      level: 'warn',
      area: 'mod-ui',
      message: 'mod-ui:mod-fused',
      details: {
        modId: entry.modId,
        extensionId: entry.extensionId,
        slot,
        errorChain: mergedChain,
      },
    });
  }, [context, runtimeModFailures, setStatusBanner, slot]);

  const renderEntry = useCallback((entry: UiExtensionRegistration, entryBase: ReactNode) => {
    return renderSlotEntry({
      entry,
      entryBase,
      slot,
      context,
      fusedRuntimeMods,
      retryingModId,
      onRetryMod: (modId) => {
        void retryMod(modId);
      },
      onRenderFailure: handleRenderFailure,
    });
  }, [context, fusedRuntimeMods, handleRenderFailure, retryMod, retryingModId, slot]);

  if (resolution.hide) {
    return null;
  }

  let content: ReactNode = base;

  const replace = resolution.replace[0];
  if (replace) {
    content = renderEntry(replace, content);
  }

  for (const wrapper of resolution.wrap) {
    content = renderEntry(wrapper, content);
  }

  return (
    <>
      {content}
      {resolution.append.map((entry) => {
        const rendered = renderEntry(entry, null);
        if (rendered == null) {
          return null;
        }

        if (slot === 'ui-extension.app.content.routes') {
          return (
            <div key={entry.extensionId} className="contents">
              {rendered}
            </div>
          );
        }

        return (
          <div key={entry.extensionId}>
            {rendered}
          </div>
        );
      })}
    </>
  );
}
