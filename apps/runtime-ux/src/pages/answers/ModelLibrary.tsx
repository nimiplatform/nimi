import { useState } from 'react';
import { Button, Card, Chips, EmptyState, Pill, ProgressBar, SegmentedControl } from '../../ui';
import { IconCheck, IconDownload, IconModel } from '../../icons';
import { catalogModels, installedModels } from '../../data';

type Mode = 'Installed' | 'Discover';
const categories = ['All', 'Chat', 'Image', 'Embedding'] as const;
type Category = (typeof categories)[number];

function statusCell(m: (typeof installedModels)[number]) {
  if (m.status === 'ready') return <Pill tone="success">Ready</Pill>;
  if (m.status === 'error') return <Pill tone="danger">Error</Pill>;
  return (
    <div className="rt-row-actions">
      <ProgressBar value={m.progress ?? 0} label={`${m.name} download`} />
      <span className="rt-mono">{m.progress}%</span>
    </div>
  );
}

export function ModelLibrary({
  emptyInstalled = false,
  showInstallPrompt = false,
}: {
  emptyInstalled?: boolean;
  showInstallPrompt?: boolean;
}) {
  const [mode, setMode] = useState<Mode>('Installed');
  const [category, setCategory] = useState<Category>('All');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // null = prompt visible, 'used' = accepted, 'dismissed' = declined
  const [promptState, setPromptState] = useState<'used' | 'dismissed' | null>(null);

  const installed = emptyInstalled ? [] : installedModels;
  const filteredCatalog = catalogModels.filter(
    (m) =>
      (category === 'All' || m.capability === category) &&
      m.name.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = catalogModels.find((m) => m.id === selectedId);

  return (
    <>
      <div className="rt-toolbar" style={{ marginBottom: 12 }}>
        <SegmentedControl options={['Installed', 'Discover'] as const} value={mode} onChange={setMode} />
      </div>

      {mode === 'Installed' ? (
        <>
          {showInstallPrompt && promptState === null && (
            <div className="rt-inline-prompt">
              <IconCheck size={15} />
              <span className="rt-inline-prompt-text">
                <strong>Qwen3 14B installed.</strong> Use it for Chat now?
              </span>
              <Button size="sm" variant="primary" onClick={() => setPromptState('used')}>
                Use for Chat
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPromptState('dismissed')}>
                Not now
              </Button>
            </div>
          )}
          {showInstallPrompt && promptState === 'used' && (
            <div className="rt-inline-prompt">
              <IconCheck size={15} />
              <span className="rt-inline-prompt-text">
                Chat now answers via <strong>Qwen3 14B</strong> (this device).
              </span>
            </div>
          )}
          {installed.length === 0 ? (
            <EmptyState
              icon={<IconModel size={32} />}
              title="No models on this device"
              description="Install a model from the catalog, or import a model file you already have."
              action={
                <div className="rt-row-actions" style={{ justifyContent: 'center' }}>
                  <Button variant="primary" onClick={() => setMode('Discover')}>
                    Browse catalog
                  </Button>
                  <Button>Import file</Button>
                </div>
              }
            />
          ) : (
            <>
              <table className="rt-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Used for</th>
                    <th>Size</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {installed.map((m) => (
                    <tr key={m.id}>
                      <td><strong>{m.name}</strong></td>
                      <td>{m.capability}</td>
                      <td>{m.size}</td>
                      <td>{m.source}</td>
                      <td>{statusCell(m)}</td>
                      <td>
                        <Button size="sm" variant="ghost">Remove</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="rt-section-gap">
                <Button size="sm">Import file</Button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="rt-toolbar">
            <input
              className="rt-input"
              placeholder="Search models…"
              aria-label="Search models"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Chips options={categories} value={category} onChange={setCategory} />
          </div>
          <div className="rt-grid">
            {filteredCatalog.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`rt-model-card${selectedId === m.id ? ' selected' : ''}`}
                aria-pressed={selectedId === m.id}
                onClick={() => setSelectedId(m.id === selectedId ? null : m.id)}
              >
                <span className="rt-model-name">{m.name}</span>
                <span className="rt-model-desc">{m.description}</span>
                <span className="rt-model-meta">
                  <span>{m.capability} · {m.size}</span>
                  <span>{m.downloads} installs</span>
                </span>
              </button>
            ))}
          </div>
          {selected && (
            <div className="rt-section-gap">
              <Card
                title={selected.name}
                subtitle={`${selected.capability} · ${selected.size} · ${selected.downloads} installs`}
                actions={
                  selected.installed ? (
                    <Pill tone="success">Installed</Pill>
                  ) : (
                    <Button variant="primary" size="sm">
                      <IconDownload size={13} /> Install
                    </Button>
                  )
                }
              >
                <p style={{ margin: 0, color: 'var(--nimi-text-secondary)' }}>{selected.description}</p>
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );
}
