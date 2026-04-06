// RL-FEAT-008 — Lightweight model status panel
// Shows available models (local active / cloud connectors) and status

import { useModelStatus } from './use-model-status.js';
import { OpenDesktopConfigButton } from './open-desktop-config-button.js';

export function ModelStatusPanel() {
  const { models, loading, error } = useModelStatus();

  const localModels = models.filter((m) => m.source === 'local');
  const cloudModels = models.filter((m) => m.source !== 'local');

  return (
    <div style={{ padding: '12px', fontSize: '13px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <strong>Model Status</strong>
        <OpenDesktopConfigButton />
      </div>

      {loading && <div style={{ color: '#888' }}>Loading models...</div>}
      {error && <div style={{ color: '#e55' }}>Error: {error}</div>}

      {!loading && !error && models.length === 0 && (
        <div style={{ color: '#888' }}>No models available</div>
      )}

      {localModels.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{ color: '#888', fontSize: '11px', marginBottom: '4px' }}>Local ({localModels.length})</div>
          {localModels.map((m) => (
            <div key={m.id} style={{ padding: '2px 0' }}>
              {m.name || m.id}
              {m.status && <span style={{ color: '#888', marginLeft: '6px' }}>({String(m.status)})</span>}
            </div>
          ))}
        </div>
      )}

      {cloudModels.length > 0 && (
        <div>
          <div style={{ color: '#888', fontSize: '11px', marginBottom: '4px' }}>Cloud ({cloudModels.length})</div>
          {cloudModels.map((m) => (
            <div key={m.id} style={{ padding: '2px 0' }}>
              {m.name || m.id}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
