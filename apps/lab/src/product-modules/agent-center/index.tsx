import { useMemo } from 'react';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import {
  AppAgentCenterEntry,
  createAgentCenterShellHostMechanics,
} from '@nimiplatform/kit/features/agent-center';
import {
  createAgentCenterShellBridge,
  hasElectronInvoke,
} from '@nimiplatform/kit/shell/renderer/bridge';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-agid-014a
export function AgentCenterCapability(props: { readonly client: NimiLocalAppClient }) {
  const hostMechanics = useMemo(() => (
    hasElectronInvoke()
      ? createAgentCenterShellHostMechanics(createAgentCenterShellBridge())
      : null
  ), []);
  return (
    <AppAgentCenterEntry
      client={props.client}
      hostMechanics={hostMechanics}
      language={globalThis.document?.documentElement.lang || 'en'}
    />
  );
}
