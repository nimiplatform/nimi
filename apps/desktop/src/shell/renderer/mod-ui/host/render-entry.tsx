import type { ReactNode } from 'react';
import type {
  UiExtensionContext,
  UiExtensionRegistration,
  UiSlotId,
} from '@renderer/mod-ui/contracts';
import { ModExtensionErrorBoundary } from './mod-extension-error-boundary';
import { renderFusedRoutePanel } from './fused-route-panel';

type RenderSlotEntryInput = {
  entry: UiExtensionRegistration;
  entryBase: ReactNode;
  slot: UiSlotId;
  context: UiExtensionContext;
  fusedRuntimeMods: Record<string, { reason: string; lastError: string; at: string }>;
  retryingModId: string | null;
  onRetryMod: (modId: string) => void;
  onRenderFailure: (entry: UiExtensionRegistration, error: unknown) => void;
};

export function renderSlotEntry(input: RenderSlotEntryInput): ReactNode {
  const isRouteSlot = input.slot === 'ui-extension.app.content.routes';

  if (
    isRouteSlot
    && input.context.isModFused(input.entry.modId)
    && input.context.activeTab === `mod:${input.entry.modId}`
  ) {
    return renderFusedRoutePanel({
      entry: input.entry,
      retryingModId: input.retryingModId,
      context: input.context,
      onRetryMod: input.onRetryMod,
      fusedRuntimeMods: input.fusedRuntimeMods,
    });
  }

  try {
    const rendered = input.entry.render({
      extensionId: input.entry.extensionId,
      modId: input.entry.modId,
      slot: input.slot,
      context: input.context,
      base: input.entryBase,
    });

    if (rendered == null) {
      return null;
    }

    return (
      <ModExtensionErrorBoundary
        extensionId={input.entry.extensionId}
        modId={input.entry.modId}
        slot={input.slot}
        fallback={isRouteSlot
          ? renderFusedRoutePanel({
            entry: input.entry,
            retryingModId: input.retryingModId,
            context: input.context,
            onRetryMod: input.onRetryMod,
            fusedRuntimeMods: input.fusedRuntimeMods,
          })
          : undefined}
        onError={(error) => {
          input.onRenderFailure(input.entry, error);
        }}
      >
        {rendered}
      </ModExtensionErrorBoundary>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'render failed');
    input.onRenderFailure(input.entry, error);
    if (isRouteSlot) {
      return renderFusedRoutePanel({
        entry: input.entry,
        detail: message,
        retryingModId: input.retryingModId,
        context: input.context,
        onRetryMod: input.onRetryMod,
        fusedRuntimeMods: input.fusedRuntimeMods,
      });
    }
    return null;
  }
}
