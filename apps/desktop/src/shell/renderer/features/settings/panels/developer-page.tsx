import { useMemo } from 'react';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { PageShell, SectionTitle } from '../settings-layout-components';

function formatBoolean(value: boolean): string {
  return value ? 'true' : 'false';
}

export function DeveloperPage() {
  const auth = useAppStore((state) => state.auth);
  const activeTab = useAppStore((state) => state.activeTab);
  const selectedWorldId = useAppStore((state) => state.selectedWorldId);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);

  const snapshot = useMemo(() => ({
    authStatus: auth.status,
    hasAccessToken: Boolean(auth.token),
    hasRefreshToken: Boolean(auth.refreshToken),
    activeTab,
    selectedWorldId,
    selectedChatId,
    runtimeFields,
    generatedAt: new Date().toISOString(),
  }), [activeTab, auth.refreshToken, auth.status, auth.token, runtimeFields, selectedChatId, selectedWorldId]);

  const copySnapshot = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setStatusBanner({
        kind: 'success',
        message: 'Developer snapshot copied to clipboard.',
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to copy developer snapshot.',
      });
    }
  };

  return (
    <PageShell
      title="Developer"
      description="Runtime diagnostics, auth state, and integration debug helpers"
    >
      <section>
        <SectionTitle>Session Snapshot</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="space-y-2 text-sm text-gray-700">
            <p>
              <span className="font-semibold text-gray-900">Auth status:</span>
              {' '}
              {auth.status}
            </p>
            <p>
              <span className="font-semibold text-gray-900">Has access token:</span>
              {' '}
              {formatBoolean(Boolean(auth.token))}
            </p>
            <p>
              <span className="font-semibold text-gray-900">Has refresh token:</span>
              {' '}
              {formatBoolean(Boolean(auth.refreshToken))}
            </p>
            <p>
              <span className="font-semibold text-gray-900">Active tab:</span>
              {' '}
              {activeTab}
            </p>
            <p>
              <span className="font-semibold text-gray-900">Selected chat:</span>
              {' '}
              {selectedChatId || '-'}
            </p>
            <p>
              <span className="font-semibold text-gray-900">Selected world:</span>
              {' '}
              {selectedWorldId || '-'}
            </p>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>Debug Helpers</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">
            Copy current app snapshot for bug reports and integration debugging.
          </p>
          <button
            type="button"
            onClick={() => { void copySnapshot(); }}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 hover:border-gray-300"
          >
            Copy Developer Snapshot
          </button>
        </div>
      </section>
    </PageShell>
  );
}
