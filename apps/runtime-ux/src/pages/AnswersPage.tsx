import { useState } from 'react';
import { Button, Disclosure, Pill, StatusDot } from '../ui';
import { IconCheck } from '../icons';
import { presets, type PresetId } from '../data';
import { ConnectedServices } from './answers/ConnectedServices';
import { ModelLibrary } from './answers/ModelLibrary';
import { FineTune } from './answers/FineTune';

export function AnswersPage({
  empty = false,
  presetApplied = false,
  justInstalled = false,
}: {
  empty?: boolean;
  presetApplied?: boolean;
  justInstalled?: boolean;
}) {
  const [applied, setApplied] = useState<PresetId | null>(presetApplied ? 'balanced' : null);
  const appliedPreset = presets.find((p) => p.id === applied);

  return (
    <div className="rt-page">
      <header className="rt-page-header">
        <h1>Answers</h1>
        <p>How should Nimi answer? Pick an intent — the details are handled for you.</p>
      </header>

      {empty && !applied && (
        <div className="rt-banner warning">
          <StatusDot tone="warning" />
          <div className="rt-banner-text">
            <strong>Nothing is set up yet</strong>
            Choose how Nimi should answer below — we'll handle the details.
          </div>
        </div>
      )}

      {appliedPreset && (
        <div className="rt-banner success">
          <IconCheck size={15} style={{ color: 'var(--nimi-success)', flexShrink: 0 }} />
          <div className="rt-banner-text">
            <strong>{appliedPreset.name} applied</strong>
            {appliedPreset.appliedSummary}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setApplied(null)}>
            Undo
          </Button>
        </div>
      )}

      <div className="rt-preset-grid">
        {presets.map((preset) => (
          <div
            key={preset.id}
            className={`rt-preset-card${applied === preset.id ? ' applied' : ''}`}
          >
            <span className="rt-preset-name">
              {preset.name}
              {preset.recommended && <Pill tone="success">Recommended</Pill>}
            </span>
            <span className="rt-preset-tag">{preset.tagline}</span>
            {applied === preset.id ? (
              <Pill tone="accent">
                <IconCheck size={11} /> Active
              </Pill>
            ) : (
              <div>
                <Button size="sm" variant="primary" onClick={() => setApplied(preset.id)}>
                  Apply
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Disclosure
        title="Connected services"
        subtitle="Cloud providers Nimi can call"
        badge={<Pill tone="neutral">Advanced</Pill>}
      >
        <ConnectedServices empty={empty} />
      </Disclosure>

      <Disclosure
        title="Model library"
        subtitle="Models on this device, and the catalog to install from"
        badge={<Pill tone="neutral">Advanced</Pill>}
        defaultOpen={justInstalled}
      >
        <ModelLibrary emptyInstalled={empty} showInstallPrompt={justInstalled} />
      </Disclosure>

      <Disclosure
        title="Fine-tune per capability"
        subtitle="Route Chat / Image / Embedding yourself"
        badge={<Pill tone="neutral">Advanced</Pill>}
      >
        <FineTune />
      </Disclosure>
    </div>
  );
}
