import { useState } from 'react';
import { Button, Card, Pill } from '../ui';
import { IconFolder } from '../icons';
import { accessTokens, usageByService, usageSummary } from '../data';

export function UsageAccessPage() {
  const [tokens, setTokens] = useState(() => [...accessTokens]);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleCreateToken = () => {
    const id = `nimi_tok_${Math.random().toString(36).slice(2, 6)}`;
    setTokens((prev) => [
      { id, agent: 'New local agent', scopes: 'Chat, Embedding', created: 'Just now', lastUsed: 'Never' },
      ...prev,
    ]);
    setNotice(`Created prototype token ${id}…`);
  };

  const handleRevoke = (id: string, agent: string) => {
    setTokens((prev) => prev.filter((item) => item.id !== id));
    setNotice(`Revoked access token for ${agent}.`);
  };

  return (
    <div className="rt-page">
      <header className="rt-page-header">
        <h1>Usage &amp; Access</h1>
        <p>How much Nimi has used, and who else may call it.</p>
      </header>

      {notice && (
        <div className="rt-banner success" role="status">
          <div className="rt-banner-text">{notice}</div>
          <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <Card title="Usage this month">
        <div className="rt-stat-grid" style={{ marginBottom: 12 }}>
          <div className="rt-stat">
            <div className="rt-stat-value">{usageSummary.tokens}</div>
            <div className="rt-stat-label">Tokens</div>
          </div>
          <div className="rt-stat">
            <div className="rt-stat-value">{usageSummary.cost}</div>
            <div className="rt-stat-label">Estimated cost</div>
          </div>
          <div className="rt-stat">
            <div className="rt-stat-value">{usageSummary.images}</div>
            <div className="rt-stat-label">Images created</div>
          </div>
        </div>
        <table className="rt-table">
          <thead>
            <tr>
              <th>Where it ran</th>
              <th>Amount</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {usageByService.map((row) => (
              <tr key={row.service}>
                <td><strong>{row.service}</strong></td>
                <td>{row.amount}</td>
                <td>{row.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card
        title="Who else can use Nimi"
        subtitle="External agents holding a token may call this runtime."
        actions={<Button size="sm" variant="primary" onClick={handleCreateToken}>Create token</Button>}
      >
        {tokens.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--nimi-text-secondary)' }}>No external access tokens issued.</p>
        ) : (
          <table className="rt-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Token</th>
                <th>Allowed</th>
                <th>Created</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.agent}</strong></td>
                  <td className="rt-mono">{t.id}…</td>
                  <td>{t.scopes}</td>
                  <td>{t.created}</td>
                  <td>{t.lastUsed}</td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => handleRevoke(t.id, t.agent)}>
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Data &amp; storage" subtitle="How disk space is used on this device.">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78125rem' }}>
          <span><strong>{cacheCleared ? '52.6 GB' : '56.4 GB'}</strong> of 128 GB used</span>
          <span style={{ color: 'var(--nimi-text-tertiary)' }}>{cacheCleared ? '75.4 GB free' : '71.6 GB free'}</span>
        </div>
        <div className="rt-storage-bar">
          <div style={{ width: '34%', background: 'var(--nimi-chart-models)' }} />
          <div style={{ width: '7%', background: 'var(--nimi-chart-memory)' }} />
          {!cacheCleared && <div style={{ width: '3%', background: 'var(--nimi-chart-cache)' }} />}
          <div style={{ width: cacheCleared ? '59%' : '56%', background: 'var(--nimi-surface-hover)' }} />
        </div>
        <div className="rt-legend">
          <span><i style={{ background: 'var(--nimi-chart-models)' }} />Models (43.5 GB)</span>
          <span><i style={{ background: 'var(--nimi-chart-memory)' }} />Memory &amp; indexes (9.1 GB)</span>
          <span><i style={{ background: 'var(--nimi-chart-cache)' }} />Logs &amp; cache ({cacheCleared ? '0.0 GB' : '3.8 GB'})</span>
        </div>
        <div className="rt-row-actions rt-section-gap">
          <Button size="sm" onClick={() => setNotice('Prototype preview: opens ~/.nimi/data in the system file manager.')}>
            <IconFolder size={13} /> Open data folder
          </Button>
          <Button
            size="sm"
            disabled={cacheCleared}
            onClick={() => {
              setCacheCleared(true);
              setNotice('Cleared 3.8 GB of temporary logs and cache.');
            }}
          >
            {cacheCleared ? <Pill tone="success">Cache cleared</Pill> : 'Clear cache'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
