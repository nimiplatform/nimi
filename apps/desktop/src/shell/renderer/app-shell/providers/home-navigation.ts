import { SETTINGS_SECTIONS } from '../../features/settings/settings-sections.js';
import { createNimiNavigation, type NimiNavigationController, type NimiNavigationLeaveGuard, type NimiNavigationResult } from '@nimiplatform/kit/core/navigation';
import type { NimiDesktopOpenAppsSection } from '@nimiplatform/kit/core/desktop-open';
import { readCharacterSourceRefV3, type CharacterSourceRefV3 } from '../../features/realm-source/realm-source-identity.js';
import type { AppTab, WorldDetailInitialSubpage } from './store-types.js';
import type { RuntimeAdvancedDiagnosticsPane, RuntimePageIdV11 } from '../../features/runtime-config/runtime-config-state-types.js';
import type { RuntimeConfigProfileUseOwner } from '../../features/runtime-config/runtime-config-panel-types.js';
import type { AgentCenterSectionId } from '@nimiplatform/kit/features/agent-center';

export type HomeRuntimePosition = {
  readonly page?: 'aiSettings' | 'modelLibrary';
  readonly section?: 'models' | 'saved' | 'discover' | 'downloaded';
  readonly capabilityContract?: string;
  readonly setupTaskId?: string;
  readonly profileViewId?: string;
  readonly profileTaskDetailId?: string;
  readonly loadoutId?: string;
  readonly profileOwner?: RuntimeConfigProfileUseOwner;
  readonly recipeId?: string; readonly recipeRevision?: string; readonly slotId?: string;
  readonly market?: 'browse' | 'slot'; readonly offerRef?: string;
  readonly connectorId?: string;
  readonly pane?: RuntimeAdvancedDiagnosticsPane;
};

export type HomeAppSection = NimiDesktopOpenAppsSection | 'overview' | 'access';

export type HomeDestination = {
  readonly id: AppTab;
  readonly homeSection?: 'overview' | 'integrations' | 'ai-activity';
  readonly profileId?: string;
  readonly sourceRef?: CharacterSourceRefV3;
  readonly worldId?: string;
  readonly worldSubpage?: WorldDetailInitialSubpage;
  readonly exploreSection?: 'worlds';
  readonly partnerManagerAnchorId?: string;
  readonly partnerManagerSection?: AgentCenterSectionId;
  readonly connectionAppId?: string;
  readonly connectionSourceId?: string;
  readonly exploreSearchKind?: 'worlds' | 'characters';
  readonly partnerQuery?: string;
  readonly partner?: { readonly localAgentRef: string; readonly settingsSection?: AgentCenterSectionId;
    readonly activity?: { readonly sourceRef?: string; readonly pendingOnly?: boolean } };
  readonly search?: string;
  readonly exploreWorldId?: string;
  readonly exploreTopicId?: string;
  readonly worldSearch?: string;
  readonly worldTopicId?: string;
  readonly worldCollection?: 'favorites';
  readonly appId?: string;
  readonly appEntryKey?: string;
  readonly appSection?: HomeAppSection;
  readonly settingsSection?: string;
  readonly messageFilter?: 'all' | 'unread' | 'pending';
  readonly messageSource?: string;
  readonly contactView?: 'partners';
  readonly conversationFilter?: 'all' | 'human' | 'partner';
  readonly partnerChat?: { readonly localAgentRef: string; readonly messageId?: string; readonly turnId?: string; readonly draft?: { readonly text: string; readonly source?: string } };
  readonly chat?: HomeChatPosition;
  readonly runtime?: HomeRuntimePosition;
};
export type HomeChatPosition = {
  readonly mode: 'ai' | 'human';
  readonly contactsSection?: 'conversations' | 'friends' | 'received' | 'sent' | 'blocked';
  readonly targetId?: string;
  readonly threadId?: string;
};
const CATALOG: Record<AppTab, readonly string[]> = {
  home: ['homeSection'], chat: ['chat'], contacts: ['chat', 'profileId', 'contactView', 'conversationFilter', 'partnerQuery', 'partner', 'partnerManagerAnchorId', 'partnerManagerSection', 'partnerChat'], explore: ['exploreSection', 'exploreSearchKind', 'search', 'exploreWorldId', 'exploreTopicId', 'worldSearch', 'worldTopicId', 'worldCollection'],
  connections: ['connectionAppId', 'connectionSourceId'],
  apps: ['appId', 'appEntryKey', 'appSection'], runtime: ['runtime'], cloud: ['runtime'], downloads: [], diagnostics: ['runtime'],
  settings: ['settingsSection'], profile: ['profileId'],
  'source-detail': ['sourceRef'], 'world-detail': ['worldId', 'worldSubpage', 'search'],
  notification: ['messageFilter', 'messageSource'],
};
const stringRef = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error('Home destination requires a nonempty reference.');
  return value;
};
// @nimi-authority: rule.nimi.desktop.shell-ui.standard-navigation
export function validateHomeDestination(value: unknown): HomeDestination {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Home destination.');
  const input = value as Record<string, unknown>;
  if (typeof input.id !== 'string' || !Object.hasOwn(CATALOG, input.id)) throw new Error('Unknown Home destination.');
  const id = input.id as AppTab;
  if (Object.keys(input).some(key => key !== 'id' && !CATALOG[id].includes(key))) throw new Error('Unexpected Home destination fields.');
  const result: Record<string, unknown> = { id };
  for (const key of CATALOG[id]) if (input[key] !== undefined) result[key] = input[key];
  for (const key of ['profileId', 'worldId', 'exploreWorldId', 'exploreTopicId', 'worldTopicId', 'appId', 'appEntryKey']) if (result[key] !== undefined) result[key] = stringRef(result[key]);
  if (typeof result.profileId === 'string' && /^(local-agent:|runtime-source:)/.test(result.profileId)) throw new Error('A human profile requires an account reference.');
  if (id === 'world-detail' && !result.worldId) throw new Error('World detail requires a world reference.');
  if (id === 'source-detail') {
    const sourceRef = readCharacterSourceRefV3(result.sourceRef);
    if (!sourceRef) throw new Error('Source detail requires a canonical source reference.');
    result.sourceRef = sourceRef;
  }
  const closed = (key: string, allowed: readonly string[]) => { if (result[key] !== undefined && !allowed.includes(result[key] as string)) throw new Error(`Invalid Home ${key}.`); };
  closed('homeSection', ['overview', 'integrations', 'ai-activity']);
  closed('exploreSection', ['worlds']);
  closed('partnerManagerSection', ['overview', 'ai-config', 'behavior', 'cognition', 'appearance', 'advanced']);
  if (result.partnerManagerAnchorId && result.partner) throw new Error('Conflicting partner selections.');
  if (result.partnerManagerSection && !result.partnerManagerAnchorId) throw new Error('Manager section requires its correlation.');
  for (const key of ['partnerManagerAnchorId', 'connectionAppId', 'connectionSourceId']) if (result[key] !== undefined) result[key] = stringRef(result[key]);
  closed('exploreSearchKind', ['worlds', 'characters']);
  closed('worldCollection', ['favorites']);
  closed('worldSubpage', ['relationship-explorer', 'reader']);
  closed('appSection', ['overview', 'access', 'ai-models']);
  closed('settingsSection', SETTINGS_SECTIONS);
  closed('messageFilter', ['all', 'unread', 'pending']);
  if (result.messageSource !== undefined) result.messageSource = stringRef(result.messageSource);
  if (result.search !== undefined && typeof result.search !== 'string') throw new Error('Invalid Home search.');
  if (result.worldSearch !== undefined && typeof result.worldSearch !== 'string') throw new Error('Invalid Home world search.');
  if (result.partnerQuery !== undefined && typeof result.partnerQuery !== 'string') throw new Error('Invalid Home partner search.');
  closed('contactView', ['partners']);
  if (id === 'contacts' && result.profileId && (result.chat || result.contactView || result.partnerChat)) throw new Error('Conflicting profile position.');
  closed('conversationFilter', ['all', 'human', 'partner']);
  if (result.contactView === 'partners' && (result.chat || result.partnerChat)) throw new Error('Conflicting contact positions.');
  if (result.contactView !== 'partners' && (result.partner || result.partnerManagerAnchorId || result.partnerQuery !== undefined)) throw new Error('Partner directory position requires its view.');
  if (result.partnerChat !== undefined) {
    if (result.chat) throw new Error('Conflicting conversation targets.');
    const target = result.partnerChat as Record<string, unknown>;
    if (!target || typeof target !== 'object' || Array.isArray(target)
      || Object.keys(target).some(key => !['localAgentRef', 'messageId', 'turnId', 'draft'].includes(key))) throw new Error('Invalid partner conversation position.');
    const draft = target.draft as Record<string, unknown> | undefined;
    if (draft !== undefined && (!draft || typeof draft !== 'object' || Array.isArray(draft)
      || Object.keys(draft).some(key => key !== 'text' && key !== 'source')
      || typeof draft.text !== 'string' || !draft.text.trim() || [...draft.text].length > 8000 || draft.text.includes('\0'))) throw new Error('Invalid partner draft.');
    result.partnerChat = { localAgentRef: stringRef(target.localAgentRef),
      ...(target.messageId === undefined ? {} : { messageId: stringRef(target.messageId) }),
      ...(target.turnId === undefined ? {} : { turnId: stringRef(target.turnId) }),
      ...(draft ? { draft: { text: draft.text, ...(draft.source === undefined ? {} : { source: stringRef(draft.source) }) } } : {}) };
  }
  if (result.partner !== undefined) {
    const partner = result.partner as Record<string, unknown>;
    if (id !== 'contacts' || !partner || typeof partner !== 'object' || Array.isArray(partner)
      || Object.keys(partner).some(key => !['localAgentRef', 'settingsSection', 'activity'].includes(key))
      || (partner.settingsSection !== undefined && !['overview', 'ai-config', 'behavior', 'cognition', 'appearance', 'advanced'].includes(partner.settingsSection as string))) throw new Error('Invalid Home partner position.');
    let activity: { sourceRef?: string; pendingOnly?: boolean } | undefined;
    if (partner.activity !== undefined) {
      const value = partner.activity as Record<string, unknown>;
      if (!value || typeof value !== 'object' || Array.isArray(value) || partner.settingsSection
        || Object.keys(value).some(key => !['sourceRef', 'pendingOnly'].includes(key))
        || (value.pendingOnly !== undefined && typeof value.pendingOnly !== 'boolean')) throw new Error('Invalid partner activity position.');
      activity = { ...(value.sourceRef === undefined ? {} : { sourceRef: stringRef(value.sourceRef) }),
        ...(value.pendingOnly === undefined ? {} : { pendingOnly: value.pendingOnly }) };
    }
    result.partner = { localAgentRef: stringRef(partner.localAgentRef), ...(partner.settingsSection ? { settingsSection: partner.settingsSection } : {}), ...(activity ? { activity } : {}) };
  }
  if (!result.appId && (result.appSection || result.appEntryKey)) throw new Error('App detail requires an App reference.');
  if (id === 'home') result.homeSection ??= 'overview';
  if (id === 'explore') { result.exploreSection ??= 'worlds'; result.search ??= ''; }
  if (id === 'settings') result.settingsSection ??= 'appearance';
  if (id === 'notification') result.messageFilter ??= 'all';
  if (id === 'runtime' || id === 'cloud' || id === 'diagnostics') {
    const position = result.runtime ?? {};
    if (!position || typeof position !== 'object' || Array.isArray(position)) throw new Error('Invalid Runtime position.');
    const fields = position as Record<string, unknown>;
    const allowed = id === 'cloud' ? ['connectorId'] : id === 'diagnostics' ? ['pane']
      : ['page', 'section', 'capabilityContract', 'setupTaskId', 'profileViewId', 'profileTaskDetailId', 'loadoutId', 'profileOwner', 'recipeId', 'recipeRevision', 'slotId', 'market', 'offerRef'];
    if (Object.keys(fields).some(key => !allowed.includes(key))) throw new Error('Unexpected Runtime position fields.');
    const normalized: Record<string, unknown> = {};
    for (const key of allowed) if (fields[key] !== undefined) normalized[key] = fields[key];
    for (const key of ['capabilityContract', 'setupTaskId', 'profileViewId', 'profileTaskDetailId', 'loadoutId', 'recipeId', 'recipeRevision', 'slotId', 'offerRef', 'connectorId']) if (normalized[key] !== undefined) normalized[key] = stringRef(normalized[key]);
    if (id === 'runtime') {
      normalized.page ??= 'aiSettings';
      if (!['aiSettings', 'modelLibrary'].includes(normalized.page as string)) throw new Error('Invalid Runtime page.');
      if ((normalized.profileViewId || normalized.profileTaskDetailId) && normalized.page !== 'aiSettings') throw new Error('Profile views require AI Capabilities.');
      if (normalized.profileTaskDetailId && !normalized.setupTaskId) throw new Error('Profile item detail requires its setup task.');
      const sections = normalized.page === 'aiSettings' ? ['models', 'saved'] : ['discover', 'downloaded'];
      normalized.section ??= sections[0];
      if (!sections.includes(normalized.section as string)) throw new Error('Invalid Runtime section.');
      if (normalized.market !== undefined && !['browse', 'slot'].includes(normalized.market as string)) throw new Error('Invalid model market position.');
      if (normalized.market && (normalized.page !== 'modelLibrary' || !normalized.capabilityContract)) throw new Error('Model market requires its capability.');
      if (normalized.market === 'slot' && ['recipeId', 'recipeRevision', 'slotId', 'offerRef'].some(key => !normalized[key])) throw new Error('Model slot requires its exact references.');
      if (normalized.loadoutId && !normalized.capabilityContract) throw new Error('Loadout detail requires its capability.');
      if (normalized.profileOwner !== undefined) {
        const owner = normalized.profileOwner as Record<string, unknown>;
        if (!owner || typeof owner !== 'object' || Array.isArray(owner) || !['app', 'local-agent'].includes(owner.kind as string)
          || Object.keys(owner).some(key => !['kind', 'ownerAppId', 'returnFocus'].includes(key)) || owner.kind === 'local-agent' && owner.ownerAppId !== undefined) throw new Error('Invalid profile owner reference.');
        const copy: Record<string, string> = { kind: owner.kind as string };
        if (owner.kind === 'app') copy.ownerAppId = stringRef(owner.ownerAppId);
        if (owner.returnFocus !== undefined) copy.returnFocus = stringRef(owner.returnFocus);
        normalized.profileOwner = copy;
      }
    }
    if (id === 'diagnostics') {
      normalized.pane ??= 'services';
      if (!['services', 'activity', 'access', 'data'].includes(normalized.pane as string)) throw new Error('Invalid diagnostics pane.');
    }
    result.runtime = normalized;
  }
  if (id === 'chat' || id === 'contacts' && !result.contactView && !result.partnerChat && !result.profileId) {
    const chat = result.chat ?? (id === 'contacts' ? { mode: 'human', contactsSection: 'conversations' } : { mode: 'ai', targetId: 'ai:assistant' });
    if (!chat || typeof chat !== 'object' || Array.isArray(chat)) throw new Error('Invalid chat position.');
    const fields = chat as Record<string, unknown>;
    if (fields.mode !== (id === 'contacts' ? 'human' : 'ai')) throw new Error('Conversation mode does not belong to this destination.');
    const keys = fields.mode === 'human' ? ['mode', 'targetId', 'threadId', 'contactsSection'] : ['mode', 'targetId', 'threadId'];
    if (Object.keys(fields).some(key => !keys.includes(key))) throw new Error('Invalid chat position fields.');
    const normalized: Record<string, unknown> = { mode: fields.mode };
    for (const key of keys) if (key !== 'mode' && fields[key] !== undefined) normalized[key] = stringRef(fields[key]);
    if (normalized.contactsSection !== undefined && !['conversations', 'friends', 'received', 'sent', 'blocked'].includes(normalized.contactsSection as string)) throw new Error('Invalid contacts section.');
    result.chat = normalized;
  }
  return result as HomeDestination;
}
export type HomeNavigation = NimiNavigationController<HomeDestination> & {
  readonly registerLeaveGuard: (guard: NimiNavigationLeaveGuard<HomeDestination>) => () => void;
};
export async function openHomeContacts(navigation: HomeNavigation): Promise<NimiNavigationResult> {
  if (navigation.getSnapshot().current.destination.id === 'contacts') return { status: 'unchanged' };
  return navigation.push({ id: 'contacts' });
}

export function homeRuntimeDestination(page: RuntimePageIdV11, position: HomeRuntimePosition = {}): HomeDestination {
  return { id: page === 'cloudServices' ? 'cloud' : page === 'advancedDiagnostics' ? 'diagnostics' : 'runtime',
    runtime: page === 'cloudServices' || page === 'advancedDiagnostics' ? position : { ...position, page } };
}
export function homeNavigationColumn(destination: HomeDestination): AppTab {
  switch (destination.id) {
    case 'source-detail':
    case 'world-detail': return 'explore';
    case 'diagnostics': return 'runtime';
    default: return destination.id;
  }
}
export function createHomeNavigation(): HomeNavigation {
  const guards = new Set<NimiNavigationLeaveGuard<HomeDestination>>();
  const beforeLeave: NimiNavigationLeaveGuard<HomeDestination> = async context => {
    for (const guard of guards) {
      const result = await guard(context);
      if (result !== 'allow' || context.signal.aborted) return context.signal.aborted ? 'cancel' : result;
    }
    return 'allow';
  };
  const navigation = createNimiNavigation({ initial: { id: 'home', homeSection: 'overview' }, validate: validateHomeDestination,
    // Preserve ordinary synchronous navigation commits when no editor needs a guard.
    get beforeLeave() { return guards.size ? beforeLeave : undefined; },
  });
  return Object.freeze({
    ...navigation,
    registerLeaveGuard(guard: NimiNavigationLeaveGuard<HomeDestination>) {
      guards.add(guard);
      return () => { guards.delete(guard); };
    },
  });
}

/** A late action cannot reclaim a position after the user left it, even if Back returns there. */
export function captureHomeNavigationScope(navigation: HomeNavigation) {
  const origin = navigation.getSnapshot();
  let left = false;
  const isCurrent = () => !left && navigation.getSnapshot().generation === origin.generation
    && navigation.getSnapshot().current === origin.current;
  const unsubscribe = navigation.subscribe(() => { if (!isCurrent()) left = true; });
  return { isCurrent, dispose() { left = true; unsubscribe(); } };
}
