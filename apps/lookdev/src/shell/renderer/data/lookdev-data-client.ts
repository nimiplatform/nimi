import { getPlatformClient } from '@nimiplatform/sdk';
import type { RealmServiceArgs, RealmServiceResult } from '@nimiplatform/sdk/realm';

function realm() {
  return getPlatformClient().realm;
}

type CreateImageDirectUploadResult = {
  uploadUrl: string;
  resourceId: string;
  storageRef?: string;
};
type FinalizeResourceInput = RealmServiceArgs<'ResourcesService', 'finalizeResource'>[1];
type BatchUpsertBindingsInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerBatchUpsertWorldBindings'>[1];
type CreatorListAgentsResult = RealmServiceResult<'CreatorService', 'creatorControllerListAgents'>;
type CreatorGetAgentResult = RealmServiceResult<'CreatorService', 'creatorControllerGetAgent'>;
type ListWorldBindingsResult = RealmServiceResult<'WorldControlService', 'worldControlControllerListWorldBindings'>;
type WorldListResult = RealmServiceResult<'WorldsService', 'worldControllerListWorlds'>;

export type LookdevWorldSummary = {
  id: string;
  name: string;
  status: string;
  agentCount: number;
};

export type LookdevPortraitBinding = {
  bindingId: string;
  resourceId: string;
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  createdAt: string;
};

export type LookdevAgentRecord = {
  id: string;
  handle: string;
  displayName: string;
  concept: string;
  description: string | null;
  scenario: string | null;
  greeting: string | null;
  worldId: string | null;
  avatarUrl: string | null;
  currentPortrait: LookdevPortraitBinding | null;
  importance: 'PRIMARY' | 'SECONDARY' | 'BACKGROUND' | 'UNKNOWN';
  status: string;
};

type LooseObject = Record<string, unknown>;

function asRecord(value: unknown): LooseObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as LooseObject : {};
}

function toStringOrNull(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized ? normalized : null;
}

function normalizeWorlds(payload: WorldListResult): LookdevWorldSummary[] {
  return Array.isArray(payload)
    ? payload.map((item) => {
      const record = asRecord(item);
      return {
        id: String(record.id || '').trim(),
        name: String(record.name || 'Untitled World').trim(),
        status: String(record.status || '').trim(),
        agentCount: Number(record.agentCount || 0),
      };
    }).filter((item) => item.id)
    : [];
}

function normalizeCreatorAgentListItem(value: unknown): Omit<LookdevAgentRecord, 'description' | 'scenario' | 'greeting' | 'currentPortrait'> | null {
  const item = asRecord(value);
  const user = asRecord(item.user);
  const agent = asRecord(user.agent);
  const agentProfile = asRecord(item.agentProfile);
  const id = String(item.id || item.agentId || user.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    id,
    handle: String(item.handle || user.handle || '').trim(),
    displayName: String(item.displayName || user.displayName || item.name || user.name || '').trim() || id,
    concept: String(item.concept || agent.concept || '').trim(),
    worldId: toStringOrNull(agent.worldId),
    avatarUrl: toStringOrNull(item.avatarUrl ?? user.avatarUrl ?? agentProfile.avatarUrl),
    importance: String(agentProfile.importance || agent.importance || 'UNKNOWN').trim().toUpperCase() as LookdevAgentRecord['importance'],
    status: String(item.status || agent.status || 'UNKNOWN').trim() || 'UNKNOWN',
  };
}

function normalizeAgentDetail(value: CreatorGetAgentResult): Pick<LookdevAgentRecord, 'description' | 'scenario' | 'greeting'> {
  const item = asRecord(value);
  const user = asRecord(item.user);
  return {
    description: toStringOrNull(item.description ?? item.bio ?? user.bio),
    scenario: toStringOrNull(item.scenario),
    greeting: toStringOrNull(item.greeting),
  };
}

function normalizePortraitBinding(payload: ListWorldBindingsResult): LookdevPortraitBinding | null {
  const items = Array.isArray(asRecord(payload).items) ? asRecord(payload).items as unknown[] : [];
  const record = asRecord(items[0]);
  const resource = asRecord(record.resource);
  const resourceId = String(record.objectId || resource.id || '').trim();
  const url = String(resource.url || '').trim();
  if (!resourceId || !url) {
    return null;
  }
  return {
    bindingId: String(record.id || '').trim(),
    resourceId,
    url,
    mimeType: String(resource.mimeType || 'image/png').trim() || 'image/png',
    width: Number(resource.width || 0) || undefined,
    height: Number(resource.height || 0) || undefined,
    createdAt: String(record.createdAt || '').trim(),
  };
}

export async function listLookdevWorlds(): Promise<LookdevWorldSummary[]> {
  const payload: WorldListResult = await realm().services.WorldsService.worldControllerListWorlds('ACTIVE');
  return normalizeWorlds(payload);
}

export async function listLookdevAgents(): Promise<Array<Omit<LookdevAgentRecord, 'description' | 'scenario' | 'greeting' | 'currentPortrait'>>> {
  const payload: CreatorListAgentsResult = await realm().services.CreatorService.creatorControllerListAgents();
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload).items)
      ? asRecord(payload).items as unknown[]
      : [];
  return items
    .map(normalizeCreatorAgentListItem)
    .filter((item): item is NonNullable<ReturnType<typeof normalizeCreatorAgentListItem>> => item !== null);
}

export async function getLookdevAgent(agentId: string): Promise<Pick<LookdevAgentRecord, 'description' | 'scenario' | 'greeting'>> {
  const payload: CreatorGetAgentResult = await realm().services.CreatorService.creatorControllerGetAgent(agentId);
  return normalizeAgentDetail(payload);
}

export async function getAgentPortraitBinding(worldId: string, agentId: string): Promise<LookdevPortraitBinding | null> {
  const payload: ListWorldBindingsResult = await realm().services.WorldControlService.worldControlControllerListWorldBindings(
    worldId,
    1,
    'AGENT_PORTRAIT',
    'PRESENTATION',
    agentId,
    'AGENT',
    undefined,
    'RESOURCE',
  );
  return normalizePortraitBinding(payload);
}

export async function createLookdevImageUpload(): Promise<CreateImageDirectUploadResult> {
  return getPlatformClient().domains.resources.createImageDirectUpload(undefined);
}

export async function finalizeLookdevResource(resourceId: string, input: FinalizeResourceInput) {
  return getPlatformClient().domains.resources.finalizeResource(resourceId, input);
}

export async function upsertAgentPortraitBinding(input: {
  worldId: string;
  agentId: string;
  resourceId: string;
  intentPrompt?: string;
}) {
  const payload: BatchUpsertBindingsInput = {
    bindingUpserts: [{
      hostId: input.agentId,
      hostType: 'AGENT',
      objectId: input.resourceId,
      objectType: 'RESOURCE',
      bindingKind: 'PRESENTATION',
      bindingPoint: 'AGENT_PORTRAIT',
      intentPrompt: input.intentPrompt,
      tags: ['lookdev', 'portrait'],
      priority: 0,
    }],
  };
  return realm().services.WorldControlService.worldControlControllerBatchUpsertWorldBindings(
    input.worldId,
    payload,
  );
}
