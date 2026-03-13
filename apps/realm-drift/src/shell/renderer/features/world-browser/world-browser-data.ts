import { getPlatformClient } from '@runtime/platform-client.js';

export type WorldSummary = {
  id: string;
  name: string;
  description?: string;
  genre?: string;
  era?: string;
  themes?: string[];
  status?: string;
  bannerUrl?: string;
  iconUrl?: string;
  agentCount: number;
  createdAt?: string;
  updatedAt?: string;
};

export type WorldDetailWithAgents = {
  id: string;
  name: string;
  description?: string;
  genre?: string;
  era?: string;
  themes?: string[];
  bannerUrl?: string;
  iconUrl?: string;
  agents: WorldAgent[];
};

export type WorldAgent = {
  id: string;
  name: string;
  bio?: string;
  avatarUrl?: string;
};

export type WorldviewData = {
  description?: string;
  lore?: string;
  geography?: string;
  culture?: string;
  history?: string;
};

export type WorldScene = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
};

export type WorldLorebook = {
  id: string;
  title: string;
  content?: string;
  category?: string;
};

function extractString(obj: Record<string, unknown>, key: string): string {
  return String(obj[key] || '').trim();
}

function extractStringArray(obj: Record<string, unknown>, key: string): string[] {
  const val = obj[key];
  if (Array.isArray(val)) return val.map((v) => String(v || '').trim()).filter(Boolean);
  return [];
}

export async function listMyWorlds(): Promise<WorldSummary[]> {
  const { realm } = getPlatformClient();
  const data = await realm.raw.request<Record<string, unknown>>({
    method: 'GET',
    path: '/api/worlds/mine',
  });
  const items = (data.worlds ?? data.items ?? data) as Record<string, unknown>[];
  if (!Array.isArray(items)) return [];

  return items.map((w) => ({
    id: extractString(w, 'id'),
    name: extractString(w, 'name'),
    description: extractString(w, 'description') || undefined,
    genre: extractString(w, 'genre') || undefined,
    era: extractString(w, 'era') || undefined,
    themes: extractStringArray(w, 'themes'),
    status: extractString(w, 'status') || undefined,
    bannerUrl: extractString(w, 'bannerUrl') || extractString(w, 'banner') || undefined,
    iconUrl: extractString(w, 'iconUrl') || extractString(w, 'icon') || undefined,
    agentCount: Number(w.agentCount ?? w.agentsCount ?? 0),
    createdAt: extractString(w, 'createdAt') || undefined,
    updatedAt: extractString(w, 'updatedAt') || undefined,
  }));
}

export async function getWorldDetailWithAgents(worldId: string): Promise<WorldDetailWithAgents> {
  const { realm } = getPlatformClient();
  const data = await realm.raw.request<Record<string, unknown>>({
    method: 'GET',
    path: `/api/world/by-id/${worldId}/detail-with-agents`,
  });

  const agents = ((data.agents ?? []) as Record<string, unknown>[]).map((a) => ({
    id: extractString(a, 'id'),
    name: extractString(a, 'name'),
    bio: extractString(a, 'bio') || extractString(a, 'description') || undefined,
    avatarUrl: extractString(a, 'avatarUrl') || undefined,
  }));

  return {
    id: extractString(data, 'id'),
    name: extractString(data, 'name'),
    description: extractString(data, 'description') || undefined,
    genre: extractString(data, 'genre') || undefined,
    era: extractString(data, 'era') || undefined,
    themes: extractStringArray(data, 'themes'),
    bannerUrl: extractString(data, 'bannerUrl') || extractString(data, 'banner') || undefined,
    iconUrl: extractString(data, 'iconUrl') || extractString(data, 'icon') || undefined,
    agents,
  };
}

export async function getWorldview(worldId: string): Promise<WorldviewData> {
  const { realm } = getPlatformClient();
  const data = await realm.raw.request<Record<string, unknown>>({
    method: 'GET',
    path: `/api/world/by-id/${worldId}/worldview`,
  });

  return {
    description: extractString(data, 'description') || undefined,
    lore: extractString(data, 'lore') || undefined,
    geography: extractString(data, 'geography') || undefined,
    culture: extractString(data, 'culture') || undefined,
    history: extractString(data, 'history') || undefined,
  };
}

export async function listWorldScenes(worldId: string): Promise<WorldScene[]> {
  const { realm } = getPlatformClient();
  const data = await realm.raw.request<Record<string, unknown>>({
    method: 'GET',
    path: `/api/worlds/${worldId}/scenes`,
  });
  const items = (data.scenes ?? data.items ?? data) as Record<string, unknown>[];
  if (!Array.isArray(items)) return [];

  return items.map((s) => ({
    id: extractString(s, 'id'),
    name: extractString(s, 'name'),
    description: extractString(s, 'description') || undefined,
    imageUrl: extractString(s, 'imageUrl') || extractString(s, 'image') || undefined,
  }));
}

export async function listWorldLorebooks(worldId: string): Promise<WorldLorebook[]> {
  const { realm } = getPlatformClient();
  const data = await realm.raw.request<Record<string, unknown>>({
    method: 'GET',
    path: `/api/worlds/${worldId}/lorebooks`,
  });
  const items = (data.lorebooks ?? data.items ?? data) as Record<string, unknown>[];
  if (!Array.isArray(items)) return [];

  return items.map((l) => ({
    id: extractString(l, 'id'),
    title: extractString(l, 'title') || extractString(l, 'name'),
    content: extractString(l, 'content') || undefined,
    category: extractString(l, 'category') || undefined,
  }));
}
