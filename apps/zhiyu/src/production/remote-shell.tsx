import type { ReactNode } from 'react';
import { NimiAccountControl, NimiAppAccessGate, useNimiAppSession } from '@nimiplatform/kit/auth/app';
import type { NimiRendererHostFacadeV1, NimiRendererHostMethodMap } from '@nimiplatform/kit/shell/renderer/host';
import { ZhiyuFrame } from './surface.js';
import { ZhiyuNavigationOwner } from '../shell/app/navigation.js';

export function ZhiyuRemoteShell({
  host,
  title,
  renderSurface,
}: {
  readonly host: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>;
  readonly title: string;
  readonly renderSurface?: ReactNode;
}) {
  const { snapshot } = useNimiAppSession();
  const connected = snapshot.identity.status === 'signed-in' && snapshot.runtime.status === 'connected';
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--nimi-app-background)] text-[var(--nimi-text-primary)]">
      {!connected ? (
        <header className="zhiyu-remote-gate-header flex shrink-0 items-center justify-between gap-3 border-b border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 text-sm text-[var(--nimi-text-primary)]">
          <strong className="truncate font-semibold">{title}</strong>
          <NimiAccountControl hideSignedOut />
        </header>
      ) : null}
      <NimiAppAccessGate title="与 Nimi 伙伴继续交流" externalAccountControl>
        {scope => (
          <div className="min-h-0 flex-1 overflow-hidden">
            <ZhiyuNavigationOwner>
              <ZhiyuFrame
                host={host}
                client={scope.client}
                appName={title}
                chromeTrailing={<NimiAccountControl hideSignedOut />}
              >
                {renderSurface}
              </ZhiyuFrame>
            </ZhiyuNavigationOwner>
          </div>
        )}
      </NimiAppAccessGate>
    </div>
  );
}
