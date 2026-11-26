import { useState } from 'react';
import { Button, EmptyState, Pill, StatusDot } from '../../ui';
import { IconCloud, IconPlus } from '../../icons';
import { services, type Service } from '../../data';

function statusPill(status: Service['status']) {
  if (status === 'connected') return <Pill tone="success">Connected</Pill>;
  if (status === 'action-needed') return <Pill tone="warning">Action needed</Pill>;
  return <Pill tone="neutral">Not configured</Pill>;
}

export function ConnectedServices({ empty = false }: { empty?: boolean }) {
  const [list, setList] = useState<Service[]>(() => (empty ? [] : services.map((s) => ({ ...s }))));
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const handleTestOrConfigure = (service: Service) => {
    setList((prev) =>
      prev.map((item) =>
        item.id === service.id
          ? {
              ...item,
              status: 'connected',
              detail: service.status === 'not-configured' ? 'Configured · verified just now' : 'Health check passed just now',
              models: item.models.length > 0 ? item.models : ['default-chat'],
            }
          : item,
      ),
    );
    setStatusNote(
      service.status === 'not-configured'
        ? `Configured ${service.name} in prototype preview.`
        : `Connection test for ${service.name} succeeded.`,
    );
  };

  const handleAddService = () => {
    const nextIdx = list.length + 1;
    const added: Service = {
      id: `custom-${nextIdx}`,
      name: `OpenRouter #${nextIdx}`,
      kind: 'API key',
      status: 'connected',
      detail: 'Connected just now',
      models: ['openrouter/auto'],
    };
    setList((prev) => [...prev, added]);
    setStatusNote(`Added ${added.name}.`);
  };

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<IconCloud size={32} />}
        title="No services connected"
        description="Connect a cloud provider like OpenAI or Anthropic so Nimi can answer through their models. Credentials stay on this device."
        action={
          <Button variant="primary" onClick={handleAddService}>
            <IconPlus size={14} /> Add service
          </Button>
        }
      />
    );
  }

  return (
    <>
      {statusNote && (
        <div className="rt-inline-prompt" role="status">
          <span className="rt-inline-prompt-text">{statusNote}</span>
          <Button size="sm" variant="ghost" onClick={() => setStatusNote(null)}>
            Dismiss
          </Button>
        </div>
      )}
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
                <div style={{ color: 'var(--nimi-text-tertiary)', fontSize: '0.71875rem', marginTop: 2 }}>
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
                <Button size="sm" onClick={() => handleTestOrConfigure(s)}>
                  {s.status === 'not-configured' ? 'Configure' : 'Test'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rt-section-gap">
        <Button size="sm" onClick={handleAddService}>
          <IconPlus size={13} /> Add service
        </Button>
      </div>
    </>
  );
}
