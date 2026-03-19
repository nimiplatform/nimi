import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';

export default function WorkbenchNewPage() {
  const navigate = useNavigate();
  const createWorkspace = useForgeWorkspaceStore((state) => state.createWorkspace);

  useEffect(() => {
    const workspaceId = createWorkspace({
      mode: 'NEW_WORLD',
      title: 'Untitled World',
    });
    navigate(`/workbench/${workspaceId}?panel=WORLD_TRUTH`, { replace: true });
  }, [createWorkspace, navigate]);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
    </div>
  );
}
