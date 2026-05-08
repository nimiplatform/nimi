import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';

type WorldWorkbenchTarget = {
  id: string;
  name: string;
  description?: string | null;
};

type WorldWorkbenchNavigationOptions = {
  search?: URLSearchParams | string;
};

export function buildWorldWorkbenchPath(
  workspaceId: string,
  options: WorldWorkbenchNavigationOptions = {},
): string {
  const nextParams = new URLSearchParams(options.search);
  nextParams.set('panel', 'WORLD_TRUTH');
  return `/workbench/${workspaceId}?${nextParams.toString()}`;
}

export function useWorldWorkbenchNavigation() {
  const navigate = useNavigate();
  const ensureWorkspaceForWorld = useForgeWorkspaceStore((state) => state.ensureWorkspaceForWorld);

  return useCallback((world: WorldWorkbenchTarget, options: WorldWorkbenchNavigationOptions = {}) => {
    const workspaceId = ensureWorkspaceForWorld({
      worldId: world.id,
      title: world.name,
      description: world.description ?? '',
    });
    navigate(buildWorldWorkbenchPath(workspaceId, options));
  }, [ensureWorkspaceForWorld, navigate]);
}
