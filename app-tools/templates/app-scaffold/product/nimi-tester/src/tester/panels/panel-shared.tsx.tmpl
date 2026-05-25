import { useState } from 'react';
import { Button, InlineAlert, Surface, TextareaField } from '@nimiplatform/kit/ui';
import type { TesterCapability } from '../tester-capabilities.js';
import { runTesterCapability, type TesterCapabilityRunResult } from '../tester-runtime.js';

export type TesterPanelProps = {
  capability: TesterCapability;
  onResult: (result: TesterCapabilityRunResult, prompt: string) => void | Promise<void>;
};

function resultTone(result: TesterCapabilityRunResult | null): 'neutral' | 'success' | 'warning' {
  if (!result) return 'neutral';
  return result.ok ? 'success' : 'warning';
}

export function CapabilityExecutionPanel(props: TesterPanelProps & {
  defaultPrompt: string;
  details: string[];
}) {
  const [prompt, setPrompt] = useState(props.defaultPrompt);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TesterCapabilityRunResult | null>(null);

  async function run() {
    setBusy(true);
    try {
      const nextResult = await runTesterCapability({ capabilityId: props.capability.id, prompt });
      setResult(nextResult);
      await props.onResult(nextResult, prompt);
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
      <TextareaField
        value={prompt}
        onChange={(event) => setPrompt(event.currentTarget.value)}
        rows={5}
        aria-label={`${props.capability.label} request`}
      />
      <div className="tester-detail-list">
        {props.details.map((detail) => <span key={detail}>{detail}</span>)}
      </div>
      <Button type="button" tone="primary" onClick={run} disabled={busy || !prompt.trim()}>
        {busy ? 'Checking Runtime surface' : 'Run capability'}
      </Button>
      {result ? (
        <InlineAlert tone={resultTone(result)}>
          <div className="runtime-alert-copy">
            <strong>{result.ok ? 'Runtime execution ready' : 'Typed unavailable'}</strong>
            <span>{result.ok ? result.message : result.message}</span>
            {!result.ok && result.missingSurface ? <span>{result.missingSurface}</span> : null}
          </div>
        </InlineAlert>
      ) : null}
    </Surface>
  );
}
