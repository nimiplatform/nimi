import { useState } from 'react';
import { Button, InlineAlert, SegmentedControl, StatusBadge, Surface } from '@nimiplatform/kit/ui';

const demoModes = [
  { value: 'glass', label: 'Glass' },
  { value: 'forms', label: 'Forms' },
  { value: 'status', label: 'Status' },
];

export function DemoSurfaces() {
  const [mode, setMode] = useState('glass');
  return (
    <Surface className="panel-section" material="glass-thin" tone="panel">
      <div className="panel-heading">
        <h2>Kit Demo</h2>
        <StatusBadge tone="info">{mode}</StatusBadge>
      </div>
      <SegmentedControl items={demoModes} value={mode} onValueChange={setMode} ariaLabel="Demo mode" size="sm" />
      <InlineAlert tone="info">
        <div className="runtime-alert-copy">
          <strong>Runtime-safe UI</strong>
          <span>Controls render from reviewed kit imports and keep app behavior inside owned routes.</span>
        </div>
      </InlineAlert>
      <div className="demo-actions">
        <Button type="button" tone="primary" size="sm">Primary</Button>
        <Button type="button" tone="secondary" size="sm">Secondary</Button>
      </div>
    </Surface>
  );
}
