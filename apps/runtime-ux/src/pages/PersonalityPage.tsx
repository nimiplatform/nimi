import { useState } from 'react';
import { Button, Chips, Pill } from '../ui';
import { IconPlus } from '../icons';
import { personalities } from '../data';

const filters = ['All', 'Recommended', 'Mine'] as const;
type Filter = (typeof filters)[number];

export function PersonalityPage({ onNewPersonality }: { onNewPersonality: () => void }) {
  const [filter, setFilter] = useState<Filter>('All');
  const visible = personalities.filter((p) => filter === 'All' || p.origin === filter);

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
            <div className="rt-profile-desc">{p.description}</div>
          </div>
          <div className="rt-row-actions">
            {!p.active && <Button size="sm">Set active</Button>}
            <Button size="sm" variant="ghost">Edit</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
