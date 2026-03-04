import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import type { WorldEvent } from './world-detail-template';

const DEFAULT_WORLD_PREFETCH_STALE_TIME_MS = 30_000;

const EVENT_HORIZON_TAG: Record<string, string> = {
  PAST: 'Past',
  ONGOING: 'Ongoing',
  FUTURE: 'Future',
};

function normalizeWorldId(worldId: string): string {
  return String(worldId || '').trim();
}

function toWorldEvent(raw: Record<string, unknown>): WorldEvent {
  const horizon = typeof raw.eventHorizon === 'string' ? raw.eventHorizon : '';
  return {
    id: String(raw.id || ''),
    title: String(raw.title || 'Untitled Event'),
    description: String(raw.summary || raw.cause || raw.process || raw.result || ''),
    time: String(raw.timeRef || raw.createdAt || ''),
    tag: EVENT_HORIZON_TAG[horizon] || horizon || 'Event',
  };
}

export function worldListQueryKey() {
  return ['worlds-list'] as const;
}

export function worldDetailWithAgentsQueryKey(worldId: string) {
  return ['world-detail-with-agents', normalizeWorldId(worldId)] as const;
}

export function worldEventsQueryKey(worldId: string) {
  return ['world-events', normalizeWorldId(worldId)] as const;
}

export async function fetchWorldDetailWithAgents(worldId: string) {
  return dataSync.loadWorldDetailWithAgents(normalizeWorldId(worldId));
}

export async function fetchWorldEvents(worldId: string): Promise<WorldEvent[]> {
  const events = await dataSync.loadWorldEvents(normalizeWorldId(worldId));
  return events.map(toWorldEvent);
}

export function prefetchWorldDetailAndEvents(worldId: string): void {
  const normalizedWorldId = normalizeWorldId(worldId);
  if (!normalizedWorldId) {
    return;
  }

  void queryClient.prefetchQuery({
    queryKey: worldListQueryKey(),
    queryFn: () => dataSync.loadWorlds(),
    staleTime: DEFAULT_WORLD_PREFETCH_STALE_TIME_MS,
  });

  void queryClient.prefetchQuery({
    queryKey: worldDetailWithAgentsQueryKey(normalizedWorldId),
    queryFn: () => fetchWorldDetailWithAgents(normalizedWorldId),
    staleTime: DEFAULT_WORLD_PREFETCH_STALE_TIME_MS,
  });

  void queryClient.prefetchQuery({
    queryKey: worldEventsQueryKey(normalizedWorldId),
    queryFn: () => fetchWorldEvents(normalizedWorldId),
    staleTime: DEFAULT_WORLD_PREFETCH_STALE_TIME_MS,
  });
}
