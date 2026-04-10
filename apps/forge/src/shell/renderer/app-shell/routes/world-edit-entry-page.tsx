import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ForgeEmptyState, ForgeLoadingSpinner } from '@renderer/components/page-layout.js';
import { useWorldDetailQuery } from '@renderer/hooks/use-world-queries.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';

export default function WorldEditEntryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { worldId = '' } = useParams<{ worldId: string }>();
  const ensureWorkspaceForWorld = useForgeWorkspaceStore((state) => state.ensureWorkspaceForWorld);
  const worldQuery = useWorldDetailQuery(worldId);
  const redirectedRef = useRef<string | null>(null);

  useEffect(() => {
    const world = worldQuery.data;
    if (!worldId || !world) {
      return;
    }
    const workspaceId = ensureWorkspaceForWorld({
      worldId,
      title: world.name,
      description: world.description,
    });
    if (redirectedRef.current === workspaceId) {
      return;
    }
    redirectedRef.current = workspaceId;
    const nextParams = new URLSearchParams(location.search);
    nextParams.set('panel', 'WORLD_TRUTH');
    navigate(`/workbench/${workspaceId}?${nextParams.toString()}`, { replace: true });
  }, [ensureWorkspaceForWorld, location.search, navigate, worldId, worldQuery.data]);

  if (!worldId) {
    return <ForgeEmptyState message="No world ID provided." />;
  }

  if (worldQuery.isLoading || worldQuery.isFetching) {
    return <ForgeLoadingSpinner />;
  }

  if (!worldQuery.data) {
    return <ForgeEmptyState message="World not found." />;
  }

  return <ForgeLoadingSpinner />;
}
