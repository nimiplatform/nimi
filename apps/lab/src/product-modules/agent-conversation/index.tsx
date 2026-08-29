import { useMemo } from 'react';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import {
  AppConversationEntry,
  createBrowserAppConversationHostPort,
} from '@nimiplatform/kit/features/chat';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c
// @nimi-authority: rule.nimi.runtime.agent-participation.r093
export function AgentConversationCapability(props: { readonly client: NimiLocalAppClient }) {
  const hostPort = useMemo(() => createBrowserAppConversationHostPort(), []);
  return (
    <AppConversationEntry
      client={props.client}
      hostPort={hostPort}
      language={globalThis.document?.documentElement.lang || 'en'}
    />
  );
}
