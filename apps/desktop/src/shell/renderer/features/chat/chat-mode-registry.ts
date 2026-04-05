import type { ConversationMode } from '@nimiplatform/nimi-kit/features/chat/headless';
import type { DesktopConversationModeHost } from './chat-mode-host-types';

export type DesktopConversationModeRegistry = {
  hosts: readonly DesktopConversationModeHost[];
  visibleModes: readonly ConversationMode[];
};

export function createDesktopConversationModeRegistry(input: {
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated';
  aiHost: DesktopConversationModeHost;
  humanHost: DesktopConversationModeHost;
  agentHost: DesktopConversationModeHost;
}): DesktopConversationModeRegistry {
  const hosts = input.authStatus === 'authenticated'
    ? [input.aiHost, input.humanHost, input.agentHost]
    : [input.aiHost];
  return {
    hosts,
    visibleModes: hosts.map((host) => host.mode),
  };
}

export function resolveDesktopConversationModeHost(
  registry: DesktopConversationModeRegistry,
  mode: ConversationMode,
): DesktopConversationModeHost | null {
  return registry.hosts.find((host) => host.mode === mode) || registry.hosts[0] || null;
}
