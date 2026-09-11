import { Button, EmptyState, Pill, StatusDot } from '../../ui';
import { IconCloud, IconPlus } from '../../icons';
import { services, type Service } from '../../data';

function statusPill(status: Service['status']) {
  if (status === 'connected') return <Pill tone="success">Connected</Pill>;
  if (status === 'action-needed') return <Pill tone="warning">Action needed</Pill>;
  return <Pill tone="neutral">Not configured</Pill>;
}

export function ConnectedServices({ empty = false }: { empty?: boolean }) {
  const list = empty ? [] : services;

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<IconCloud size={32} />}
        title="No services connected"
        description="Connect a cloud provider like OpenAI or Anthropic so Nimi can answer through their models. Credentials stay on this device."
        action={
          <Button variant="primary">
            <IconPlus size={14} /> Add service
          </Button>
        }
      />
    );
  }

  return (
    <>
      <table className="rt-table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Sign-in</th>
            <th>Status</th>
            <th>Models available</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td>
                <span className="rt-row-actions">
                  <StatusDot
                    tone={s.status === 'connected' ? 'success' : s.status === 'action-needed' ? 'warning' : 'danger'}
                  />
                  <strong>{s.name}</strong>
                </span>
              </td>
              <td>{s.kind}</td>
              <td>
                {statusPill(s.status)}
                <div style={{ color: 'var(--nimi-text-tertiary)', fontSize: 11.5, marginTop: 2 }}>
                  {s.detail}
                </div>
              </td>
              <td>
                {s.models.length > 0 ? (
                  <div className="rt-chips">
                    {s.models.map((m) => (
                      <span key={m} className="rt-pill neutral">
                        {m}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span style={{ color: 'var(--nimi-text-tertiary)' }}>None reachable</span>
                )}
              </td>
              <td>
                <Button size="sm">{s.status === 'not-configured' ? 'Configure' : 'Test'}</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rt-section-gap">
        <Button size="sm">
          <IconPlus size={13} /> Add service
        </Button>
      </div>
    </>
  );
}
