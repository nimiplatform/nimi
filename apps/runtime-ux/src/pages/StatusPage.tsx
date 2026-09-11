import { Button, Card, Pill, StatusDot } from '../ui';
import { activityLog } from '../data';
import type { PageId } from '../pages';

export function StatusPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  return (
    <div className="rt-page">
      <header className="rt-page-header">
        <h1>Status</h1>
        <p>Is something broken? What's failing, why, and where to fix it.</p>
      </header>

      <div className="rt-banner warning">
        <StatusDot tone="warning" />
        <div className="rt-banner-text">
          <strong>1 thing needs attention</strong>
          Google Gemini is failing to authenticate — some answers can't use it.
        </div>
        <Button size="sm" onClick={() => onNavigate('answers')}>
          Fix in Answers
        </Button>
      </div>

      <Card title="What's running">
        <table className="rt-table">
          <tbody>
            <tr>
              <td><strong>Nimi runtime</strong></td>
              <td className="rt-mono">v1.4.2 · up 6 days</td>
              <td><Pill tone="success">Running</Pill></td>
              <td />
            </tr>
            <tr>
              <td><strong>On-device AI engine</strong></td>
              <td className="rt-mono">3 models loaded</td>
              <td><Pill tone="success">Running</Pill></td>
              <td />
            </tr>
            <tr>
              <td><strong>Google Gemini</strong></td>
              <td className="rt-mono">last test 14:02 · 401 unauthorized</td>
              <td><Pill tone="danger">Failing</Pill></td>
              <td>
                <Button size="sm" onClick={() => onNavigate('answers')}>
                  Fix in Answers
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card title="What happened" subtitle="A plain-language log of decisions and failures.">
        {activityLog.map((e, i) => (
          <div className="rt-log-row" key={i}>
            <span className="rt-log-time">{e.time}</span>
            <StatusDot tone={e.tone} />
            <span>{e.message}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
