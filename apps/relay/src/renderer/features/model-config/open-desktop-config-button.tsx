// RL-IPC-013, RL-INTOP-004 — Button to open Desktop runtime config

import { useCallback } from 'react';
import { getBridge } from '../../bridge/electron-bridge.js';

export function OpenDesktopConfigButton({ pageId }: { pageId?: string }) {
  const handleClick = useCallback(() => {
    void getBridge().desktop.openConfig(pageId);
  }, [pageId]);

  return (
    <button
      type="button"
      onClick={handleClick}
      style={{
        fontSize: '12px',
        padding: '4px 8px',
        cursor: 'pointer',
        border: '1px solid #555',
        borderRadius: '4px',
        background: 'transparent',
        color: 'inherit',
      }}
    >
      Open Desktop Config
    </button>
  );
}
