import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ForgeLoadingSpinner } from '@renderer/components/page-layout.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';

const DEFAULT_NEW_WORLD_WORKSPACE_TITLE = 'New World Workspace';

export default function WorkbenchNewPage() {
  const navigate = useNavigate();
  const createWorkspace = useForgeWorkspaceStore((state) => state.createWorkspace);

  useEffect(() => {
    const workspaceId = createWorkspace({
      mode: 'NEW_WORLD',
      title: DEFAULT_NEW_WORLD_WORKSPACE_TITLE,
    });
    navigate(`/workbench/${workspaceId}?panel=WORLD_TRUTH`, { replace: true });
  }, [createWorkspace, navigate]);

  return (
    <div className="flex h-full items-center justify-center">
      <ForgeLoadingSpinner />
    </div>
  );
}
