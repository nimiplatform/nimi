import { createNimiNavigation, type NimiNavigationController } from '@nimiplatform/kit/core/navigation';
import type { NimiDesktopOpenAppsSection } from '@nimiplatform/kit/core/desktop-open';
import { readCharacterSourceRefV3, type CharacterSourceRefV3 } from '../../features/realm-source/realm-source-identity.js';
import type { AppTab, WorldDetailInitialSubpage } from './store-types.js';
import type { RuntimeAdvancedDiagnosticsPane, RuntimePageIdV11 } from '../../features/runtime-config/runtime-config-state-types.js';
import type { RuntimeConfigProfileUseOwner } from '../../features/runtime-config/runtime-config-panel-types.js';

export type HomeRuntimePosition = {
  readonly page?: 'aiSettings' | 'modelLibrary';
  readonly section?: 'overview' | 'models' | 'advanced' | 'saved' | 'discover' | 'downloaded';
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

export type HomeDestination = {
  readonly id: AppTab;
  readonly homeSection?: 'overview' | 'center' | 'integrations';
  readonly profileId?: string;
  readonly sourceRef?: CharacterSourceRefV3;
  readonly worldId?: string;
  readonly worldSubpage?: WorldDetailInitialSubpage;
  readonly exploreSection?: 'worlds' | 'personas';
  readonly search?: string;
  readonly exploreWorldId?: string;
  readonly worldSearch?: string;
  readonly worldTopicId?: string;
  readonly worldCollection?: 'favorites';
  readonly appId?: string;
  readonly appEntryKey?: string;
  readonly appSection?: NimiDesktopOpenAppsSection;
  readonly settingsSection?: string;
  readonly chat?: HomeChatPosition;
  readonly runtime?: HomeRuntimePosition;
};
export type HomeChatPosition = {
  readonly mode: 'ai' | 'human' | 'agent';
  readonly targetId?: string;
  readonly threadId?: string;
  readonly agentHandle?: string;
  /** Durable management return hint; resolved against fresh references. */
  readonly agentBinding?: string;
  readonly conversationAnchorId?: string;
  /** Pending management navigation only; never an admitted Agent selector. */
  readonly managerAnchorId?: string;
};
const CATALOG: Record<AppTab, readonly string[]> = {
  home: ['homeSection'], chat: ['chat'], 'agent-center': ['chat'], explore: ['exploreSection', 'search', 'exploreWorldId', 'worldSearch', 'worldTopicId', 'worldCollection'],
  apps: ['appId', 'appEntryKey', 'appSection'], runtime: ['runtime'], cloud: ['runtime'], downloads: [], diagnostics: ['runtime'],
  settings: ['settingsSection'], support: [], profile: ['profileId'],
  'source-detail': ['sourceRef'], 'world-detail': ['worldId', 'worldSubpage', 'search'],
  notification: [], 'privacy-policy': [], 'terms-of-service': [],
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
  for (const key of ['profileId', 'worldId', 'exploreWorldId', 'worldTopicId', 'appId', 'appEntryKey']) if (result[key] !== undefined) result[key] = stringRef(result[key]);
  if (id === 'profile' && typeof result.profileId === 'string' && /^(local-agent:|runtime-source:)/.test(result.profileId)) throw new Error('A human profile requires an account reference.');
  if (id === 'world-detail' && !result.worldId) throw new Error('World detail requires a world reference.');
  if (id === 'source-detail') {
    const sourceRef = readCharacterSourceRefV3(result.sourceRef);
    if (!sourceRef) throw new Error('Source detail requires a canonical source reference.');
    result.sourceRef = sourceRef;
  }
  const closed = (key: string, allowed: readonly string[]) => { if (result[key] !== undefined && !allowed.includes(result[key] as string)) throw new Error(`Invalid Home ${key}.`); };
  closed('homeSection', ['overview', 'center', 'integrations']);
  closed('exploreSection', ['worlds', 'personas']);
  closed('worldCollection', ['favorites']);
  closed('worldSubpage', ['relationship-explorer']);
  closed('appSection', ['overview', 'ai-models']);
  closed('settingsSection', ['profile', 'appearance', 'privacy', 'security', 'notifications', 'developer', 'data', 'about-legal']);
  if (result.search !== undefined && typeof result.search !== 'string') throw new Error('Invalid Home search.');
  if (result.worldSearch !== undefined && typeof result.worldSearch !== 'string') throw new Error('Invalid Home world search.');
  if (!result.appId && (result.appSection || result.appEntryKey)) throw new Error('App detail requires an App reference.');
  if (id === 'home') result.homeSection ??= 'overview';
  if (id === 'explore') { result.exploreSection ??= 'worlds'; result.search ??= ''; }
  if (id === 'settings') result.settingsSection ??= 'profile';
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
      const sections = normalized.page === 'aiSettings' ? ['overview', 'models', 'advanced', 'saved'] : ['discover', 'downloaded'];
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
  if (id === 'chat' || id === 'agent-center') {
    const chat = result.chat ?? (id === 'agent-center' ? { mode: 'agent' } : { mode: 'ai', targetId: 'ai:assistant' });
    if (!chat || typeof chat !== 'object' || Array.isArray(chat)) throw new Error('Invalid chat position.');
    const fields = chat as Record<string, unknown>;
    if (id === 'agent-center' && fields.mode !== 'agent') throw new Error('Partner management requires Agent mode.');
    const keys = fields.mode === 'agent' ? ['mode', 'targetId', 'agentHandle', 'conversationAnchorId', 'managerAnchorId', ...(id === 'agent-center' ? ['agentBinding'] : [])] : ['mode', 'targetId', 'threadId'];
    if (!['ai', 'human', 'agent'].includes(fields.mode as string) || Object.keys(fields).some(key => !keys.includes(key))) throw new Error('Invalid chat position fields.');
    const normalized: Record<string, unknown> = { mode: fields.mode };
    for (const key of keys) if (key !== 'mode' && fields[key] !== undefined) normalized[key] = stringRef(fields[key]);
    if (fields.mode === 'agent' && (id === 'chat' && Boolean(normalized.agentHandle) !== Boolean(normalized.conversationAnchorId) || normalized.conversationAnchorId && !normalized.agentHandle && !(id === 'agent-center' && normalized.agentBinding))) throw new Error('Agent conversation position requires its proven handle and Conversation anchor together.');
    result.chat = normalized;
  }
  return result as HomeDestination;
}
export type HomeNavigation = NimiNavigationController<HomeDestination>;
export function homeRuntimeDestination(page: RuntimePageIdV11, position: HomeRuntimePosition = {}): HomeDestination {
  return { id: page === 'cloudServices' ? 'cloud' : page === 'advancedDiagnostics' ? 'diagnostics' : 'runtime',
    runtime: page === 'cloudServices' || page === 'advancedDiagnostics' ? position : { ...position, page } };
}
export function homeNavigationColumn(destination: HomeDestination): AppTab {
  switch (destination.id) {
    case 'agent-center': return 'chat';
    case 'source-detail':
    case 'world-detail': return 'explore';
    case 'diagnostics': return 'runtime';
    case 'privacy-policy':
    case 'terms-of-service': return 'settings';
    default: return destination.id;
  }
}
export function createHomeNavigation(): HomeNavigation {
  return createNimiNavigation({ initial: { id: 'home', homeSection: 'overview' }, validate: validateHomeDestination });
}
