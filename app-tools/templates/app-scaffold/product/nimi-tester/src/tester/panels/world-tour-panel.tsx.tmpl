import { useState } from 'react';
import { Button, InlineAlert, Surface } from '@nimiplatform/kit/ui';
import type { TesterPanelProps } from './panel-shared.js';
import { openWorldTourWindow, resolveWorldTourFixture, type ResolvedWorldTourFixture } from '../world-tour/world-tour-shared.js';

export function WorldTourPanel(props: TesterPanelProps) {
  const [fixture, setFixture] = useState<ResolvedWorldTourFixture | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function resolveFixture() {
    setBusy(true);
    setMessage(null);
    try {
      setFixture(await resolveWorldTourFixture({}));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error || 'World-tour fixture is unavailable.'));
    } finally {
      setBusy(false);
    }
  }

  async function openViewer() {
    if (!fixture) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await openWorldTourWindow({ manifestPath: fixture.manifestPath });
      setMessage(`Opened standalone viewer: ${response.windowLabel}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error || 'World-tour viewer launch failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface className="tester-panel" material="glass-regular" tone="panel" elevation="raised" data-testid="nimi-tester-capability-panel">
      <div className="tester-panel__header">
        <div>
          <p className="eyebrow">{props.capability.surface}</p>
          <h2>{props.capability.label}</h2>
        </div>
      </div>
      <p className="tester-panel__summary">{props.capability.summary}</p>
      <div className="tester-detail-list">
        <span>standalone Tauri fixture resolver</span>
        <span>viewer launch token</span>
        <span>render acceptance persistence</span>
      </div>
      <div className="tester-actions">
        <Button type="button" tone="primary" onClick={resolveFixture} disabled={busy}>
          Resolve fixture
        </Button>
        <Button type="button" tone="secondary" onClick={openViewer} disabled={busy || !fixture}>
          Open viewer
        </Button>
      </div>
      {fixture ? (
        <pre className="tester-json">{JSON.stringify(fixture, null, 2)}</pre>
      ) : null}
      {message ? (
        <InlineAlert tone={fixture ? 'success' : 'warning'}>
          <div className="runtime-alert-copy">
            <strong>{fixture ? 'World-tour command result' : 'Typed unavailable'}</strong>
            <span>{message}</span>
          </div>
        </InlineAlert>
      ) : null}
    </Surface>
  );
}
