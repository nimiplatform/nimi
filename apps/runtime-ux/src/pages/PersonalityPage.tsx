import { useState } from 'react';
import { Button, Chips, Pill } from '../ui';
import { IconPlus } from '../icons';
import { personalities } from '../data';

const filters = ['All', 'Recommended', 'Mine'] as const;
type Filter = (typeof filters)[number];

export function PersonalityPage({ onNewPersonality }: { onNewPersonality: () => void }) {
  const [filter, setFilter] = useState<Filter>('All');
  const [items, setItems] = useState(() => personalities.map((item) => ({ ...item })));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftDesc, setDraftDesc] = useState('');
  const visible = items.filter((p) => filter === 'All' || p.origin === filter);

  const setActive = (id: string) => {
    setItems((prev) => prev.map((item) => ({ ...item, active: item.id === id })));
  };

  const saveEdit = (id: string) => {
    const trimmed = draftDesc.trim();
    if (trimmed) {
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, description: trimmed } : item)));
    }
    setEditingId(null);
  };

  return (
    <div className="rt-page">
      <header className="rt-page-header rt-page-header-row">
        <div>
          <h1>Personality</h1>
          <p>How Nimi talks to you. One personality is active at a time.</p>
        </div>
        <Button variant="primary" onClick={onNewPersonality}>
          <IconPlus size={14} /> New personality
        </Button>
      </header>

      <div className="rt-toolbar">
        <Chips options={filters} value={filter} onChange={setFilter} />
      </div>

      {visible.map((p) => (
        <div key={p.id} className={`rt-profile-card${p.active ? ' active' : ''}`}>
          <span className="rt-avatar" style={{ background: p.color }}>
            {p.name.slice(0, 1)}
          </span>
          <div className="rt-profile-body">
            <span className="rt-profile-name">
              {p.name}
              {p.active && <Pill tone="accent">Active</Pill>}
              <Pill tone="neutral">{p.origin}</Pill>
            </span>
            {editingId === p.id ? (
              <div className="rt-row-actions" style={{ marginTop: 6 }}>
                <input
                  className="rt-input"
                  aria-label={`Edit ${p.name} description`}
                  value={draftDesc}
                  onChange={(e) => setDraftDesc(e.target.value)}
                />
                <Button size="sm" variant="primary" onClick={() => saveEdit(p.id)}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="rt-profile-desc">{p.description}</div>
            )}
          </div>
          <div className="rt-row-actions">
            {!p.active && <Button size="sm" onClick={() => setActive(p.id)}>Set active</Button>}
            {editingId !== p.id && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditingId(p.id);
                  setDraftDesc(p.description);
                }}
              >
                Edit
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
