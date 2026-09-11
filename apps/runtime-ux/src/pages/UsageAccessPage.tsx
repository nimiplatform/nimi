import { Button, Card } from '../ui';
import { IconFolder } from '../icons';
import { accessTokens, usageByService, usageSummary } from '../data';

export function UsageAccessPage() {
  return (
    <div className="rt-page">
      <header className="rt-page-header">
        <h1>Usage &amp; Access</h1>
        <p>How much Nimi has used, and who else may call it.</p>
      </header>

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
        actions={<Button size="sm" variant="primary">Create token</Button>}
      >
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
            {accessTokens.map((t) => (
              <tr key={t.id}>
                <td><strong>{t.agent}</strong></td>
                <td className="rt-mono">{t.id}…</td>
                <td>{t.scopes}</td>
                <td>{t.created}</td>
                <td>{t.lastUsed}</td>
                <td><Button size="sm" variant="ghost">Revoke</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Data &amp; storage" subtitle="How disk space is used on this device.">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span><strong>56.4 GB</strong> of 128 GB used</span>
          <span style={{ color: 'var(--nimi-text-tertiary)' }}>71.6 GB free</span>
        </div>
        <div className="rt-storage-bar">
          <div style={{ width: '34%', background: '#2f6fed' }} />
          <div style={{ width: '7%', background: '#7c5cd6' }} />
          <div style={{ width: '3%', background: '#1f9d63' }} />
          <div style={{ width: '56%', background: 'var(--nimi-surface-hover)' }} />
        </div>
        <div className="rt-legend">
          <span><i style={{ background: '#2f6fed' }} />Models (43.5 GB)</span>
          <span><i style={{ background: '#7c5cd6' }} />Memory &amp; indexes (9.1 GB)</span>
          <span><i style={{ background: '#1f9d63' }} />Logs &amp; cache (3.8 GB)</span>
        </div>
        <div className="rt-row-actions rt-section-gap">
          <Button size="sm"><IconFolder size={13} /> Open data folder</Button>
          <Button size="sm">Clear cache</Button>
        </div>
      </Card>
    </div>
  );
}
