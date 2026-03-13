import { useQuery } from '@tanstack/react-query';
import {
  listMyWorlds,
  getWorldDetailWithAgents,
  getWorldview,
  listWorldScenes,
  listWorldLorebooks,
} from './world-browser-data.js';

export function useMyWorldsQuery() {
  return useQuery({
    queryKey: ['worlds', 'mine'],
    queryFn: listMyWorlds,
  });
}

export function useWorldDetailWithAgentsQuery(worldId: string) {
  return useQuery({
    queryKey: ['world', worldId, 'detail-with-agents'],
    queryFn: () => getWorldDetailWithAgents(worldId),
    enabled: Boolean(worldId),
  });
}

export function useWorldviewQuery(worldId: string) {
  return useQuery({
    queryKey: ['world', worldId, 'worldview'],
    queryFn: () => getWorldview(worldId),
    enabled: Boolean(worldId),
  });
}

export function useWorldScenesQuery(worldId: string) {
  return useQuery({
    queryKey: ['world', worldId, 'scenes'],
    queryFn: () => listWorldScenes(worldId),
    enabled: Boolean(worldId),
  });
}

export function useWorldLorebooksQuery(worldId: string) {
  return useQuery({
    queryKey: ['world', worldId, 'lorebooks'],
    queryFn: () => listWorldLorebooks(worldId),
    enabled: Boolean(worldId),
  });
}
