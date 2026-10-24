import type { NimiAppActivityOpenResult, NimiAppActivityRecord } from '@nimiplatform/sdk/app';
import type { SystemEntryActionDispatch, SystemEntryContext, SystemEntryProjection } from '../../../shared/system-entry-types.js';
import { isSystemEntryActionOffered, SYSTEM_ENTRY_ACTION_DISPATCH_MS } from '../../../shared/system-entry-types.js';
import type { HomeNavigation, HomeDestination } from '../../app-shell/providers/home-navigation.js';
import type { AppStoreState } from '../../app-shell/providers/store-types.js';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import { invokeChecked } from '../../bridge/runtime-bridge/invoke.js';
import type { DesktopAppsEntry } from '../apps/apps-panel-projection.js';
import type { LocalAgentListItem } from '../agents/local-agent-list-model.js';
import { resolveAgentTargetSnapshotForSourceRef } from '../agents/agent-conversation-source-resolution.js';
import { launchAgentConversationFromDisplay } from '../chat/agent-conversation-launcher.js';

export type SystemEntryNotificationControls = Readonly<{
  enabled: boolean;
  pausedUntil: number;
  pause(): Promise<void>;
  resume(): Promise<void>;
}>;
export type SystemEntryReadingNavigation = Readonly<{
  openUsage(): Promise<void>;
  openCurrentWork(): Promise<void>;
}>;

// @nimi-authority: rule.nimi.desktop.shell-ui.r065
export async function executeSystemEntryRendererAction(request: SystemEntryActionDispatch, input: {
  context(): SystemEntryContext | null;
  published(): SystemEntryProjection | null;
  readCurrentContext(): Promise<SystemEntryContext | null>;
  navigation: HomeNavigation;
  sdk: DesktopRendererSdkPort;
  ownerUserId: string;
  appEntries: readonly DesktopAppsEntry[];
  agents: readonly LocalAgentListItem[];
  activityRecords: readonly NimiAppActivityRecord[];
  openActivity(record: NimiAppActivityRecord): Promise<NimiAppActivityOpenResult>;
  notifications: SystemEntryNotificationControls;
  reading: SystemEntryReadingNavigation;
  setAgentConversationTargetSnapshot: AppStoreState['setAgentConversationTargetSnapshot'];
  refresh(): Promise<void>;
  now?: () => number;
}): Promise<void> {
  const now = input.now ?? Date.now;
  const deadline = now() + SYSTEM_ENTRY_ACTION_DISPATCH_MS;
  const navigationGeneration = input.navigation.getSnapshot().generation;
  const guard = (): void => {
    const context = input.context();
    if (!context || context.generation !== request.generation || context.state !== 'ready'
      || input.navigation.getSnapshot().generation !== navigationGeneration) throw new Error('system-entry-view-stale');
    if (now() >= deadline) throw new Error('system-entry-action-expired');
  };
  const current = await input.readCurrentContext();
  const projection = input.published();
  if (!current || current.state !== 'ready' || current.generation !== request.generation
    || !projection || request.revision !== projection.revision || !isSystemEntryActionOffered(projection, request.action)) {
    throw new Error('system-entry-view-stale');
  }
  guard();
  const navigate = async (destination: HomeDestination): Promise<void> => {
    guard();
    const result = await input.navigation.push(destination);
    if (result.status !== 'committed' && result.status !== 'unchanged') throw new Error('system-entry-navigation-rejected');
    guard();
  };
  const action = request.action;
  switch (action.kind) {
    case 'home': return navigate({ id: 'home', homeSection: 'overview' });
    case 'messages': return navigate({ id: 'home', homeSection: 'center' });
    case 'activity': await input.reading.openCurrentWork(); guard(); return;
    case 'usage': await input.reading.openUsage(); guard(); return;
    case 'downloads': return navigate({ id: 'downloads' });
    case 'apps': return navigate({ id: 'apps' });
    case 'ai-capabilities': return navigate({ id: 'runtime', runtime: { page: 'aiSettings', section: 'overview' } });
    case 'settings': return navigate({ id: 'settings' });
    case 'notification-settings': return navigate({ id: 'settings', settingsSection: 'notifications' });
    case 'support': return navigate({ id: 'support' });
    case 'chat': return navigate({ id: 'chat', chat: { mode: 'agent' } });
    case 'pause-notifications':
      if (!input.notifications.enabled) throw new Error('system-entry-notifications-disabled');
      await input.notifications.pause(); guard(); return;
    case 'resume-notifications':
      if (!input.notifications.enabled) throw new Error('system-entry-notifications-disabled');
      await input.notifications.resume(); guard(); return;
    case 'refresh': await input.refresh(); guard(); return;
    case 'quit': throw new Error('system-entry-native-action-required');
    case 'open-activity': {
      const record = input.activityRecords.find((candidate) => candidate.activityId === action.activityId);
      if (!record || record.source.kind !== 'app' || record.objectRef === null) throw new Error('system-entry-activity-unavailable');
      const result = await input.openActivity(record);
      guard();
      if (result.outcome !== 'opened') throw new Error('system-entry-activity-open-failed');
      return;
    }
    case 'continue-chat': {
      const agent = input.agents.find((candidate) => candidate.localAgentRef === action.localAgentRef);
      if (!agent || agent.ownerUserId !== input.ownerUserId) throw new Error('system-entry-chat-unavailable');
      const target = await resolveAgentTargetSnapshotForSourceRef({
        sourceRef: agent.sourceRef, selectedLocalAgentRef: agent.localAgentRef,
        ownerUserId: input.ownerUserId, sdk: input.sdk,
        isCurrent: () => { guard(); return true; },
      });
      guard();
      if (!target) throw new Error('system-entry-chat-unavailable');
      await launchAgentConversationFromDisplay({ target, navigation: input.navigation, setAgentConversationTargetSnapshot: input.setAgentConversationTargetSnapshot });
      guard();
      return;
    }
    case 'focus-app': {
      const entry = input.appEntries.find((candidate) => candidate.identity.entryKey === action.entryKey);
      if (!entry || entry.run?.state !== 'running') throw new Error('system-entry-app-not-running');
      if (entry.localDevelopment) {
        const selector = entry.localDevelopment.selector;
        if (action.source.kind !== 'local-development' || action.source.selector !== selector) throw new Error('system-entry-view-stale');
        await invokeChecked('local_development_registration_focus', { payload: { selector, generation: request.generation, requestId: request.requestId } }, (value) => {
          if (!value || typeof value !== 'object' || (value as { state?: unknown }).state !== 'running'
            || (value as { selector?: unknown }).selector !== selector) throw new Error('system-entry-app-focus-failed');
          return value;
        });
      } else if (entry.committedRelease) {
        const selector = [...entry.committedRelease.launchSelector];
        if (action.source.kind !== 'installed' || JSON.stringify(action.source.launchSelector) !== JSON.stringify(selector)) throw new Error('system-entry-view-stale');
        await invokeChecked('installed_app_focus', { payload: { launchSelector: selector, generation: request.generation, requestId: request.requestId } }, (value) => {
          if (!value || typeof value !== 'object' || (value as { state?: unknown }).state !== 'running'
            || JSON.stringify((value as { launchSelector?: unknown }).launchSelector) !== JSON.stringify(selector)) throw new Error('system-entry-app-focus-failed');
          return value;
        });
      } else throw new Error('system-entry-app-focus-unavailable');
      guard();
      return;
    }
  }
}
