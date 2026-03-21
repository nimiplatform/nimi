import type { ReactNode } from 'react';
import type {
  UiExtensionContext,
  UiExtensionRegistration,
} from '@renderer/mod-ui/contracts';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { i18n } from '@renderer/i18n';

type RenderFusedRoutePanelInput = {
  entry: UiExtensionRegistration;
  detail?: string;
  retryingModId: string | null;
  context: UiExtensionContext;
  onRetryMod: (modId: string) => void;
  fusedRuntimeMods: Record<string, { reason: string; lastError: string; at: string }>;
};

function FusedRoutePanel(input: RenderFusedRoutePanelInput) {
  const modWorkspaceTitle = useAppStore((state) => state.modWorkspaceTabs.find((tab) => tab.modId === input.entry.modId)?.title || '');
  const fused = input.fusedRuntimeMods[input.entry.modId];
  const detail = input.detail || fused?.lastError || '';
  const displayName = modWorkspaceTitle || input.entry.modId;
  return (
    <section className="m-4 rounded-xl border border-red-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-red-700">
        {i18n.t('ModUI.modFusedTitle', { defaultValue: 'Mod fused' })}
      </h3>
      <p className="mt-2 text-xs text-gray-600">{displayName}</p>
      {detail ? (
        <p className="mt-2 break-all text-xs text-gray-500">{detail}</p>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            input.onRetryMod(input.entry.modId);
          }}
          disabled={input.retryingModId === input.entry.modId}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        >
          {input.retryingModId === input.entry.modId
            ? i18n.t('ModUI.retrying', { defaultValue: 'Retrying...' })
            : i18n.t('ModUI.retry', { defaultValue: 'Retry' })}
        </button>
        {input.context.activeTab.startsWith('mod:') ? (
          <button
            type="button"
            onClick={() => input.context.closeModTab(input.context.activeTab as `mod:${string}`)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700"
          >
            {i18n.t('ModUI.closeTab', { defaultValue: 'Close tab' })}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function renderFusedRoutePanel(input: RenderFusedRoutePanelInput): ReactNode {
  return <FusedRoutePanel {...input} />;
}
