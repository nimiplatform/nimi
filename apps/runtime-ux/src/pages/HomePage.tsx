import { Button, Card, Pill, StatusDot } from '../ui';
import { IconChat, IconCheck, IconCpu, IconModel, IconSparkle } from '../icons';
import type { PageId } from '../pages';

const setupRows = [
  { icon: IconChat, capability: 'Chat', summary: 'answers via GPT-5 (cloud)' },
  { icon: IconModel, capability: 'Images', summary: 'created by Qwen3-VL (on this device)' },
  { icon: IconCpu, capability: 'Memory search', summary: 'runs on this device (BGE-M3)' },
];

export function HomePage({
  setupComplete = true,
  onNavigate,
  onOpenSetupGuide,
}: {
  setupComplete?: boolean;
  onNavigate: (page: PageId) => void;
  onOpenSetupGuide: () => void;
}) {
  const steps = [
    {
      id: 'answer',
      title: 'Give Nimi a way to answer',
      description: 'Connect a cloud service or install a model on this device.',
      done: false,
      target: 'answers' as PageId,
      actionLabel: 'Set up answers',
    },
    {
      id: 'confirm',
      title: 'Confirm how Nimi answers',
      description: 'Review the recommended setup, or fine-tune it.',
      done: false,
      target: 'answers' as PageId,
      actionLabel: 'Review answers',
    },
    {
      id: 'personality',
      title: 'Pick a personality',
      description: 'Choose how Nimi talks to you.',
      done: false,
      target: 'personality' as PageId,
      actionLabel: 'Browse personalities',
    },
  ];

  return (
    <div className="rt-page">
      <header className="rt-page-header">
        <h1>Home</h1>
        <p>Who's answering for you, and whether everything is OK.</p>
      </header>

      {setupComplete ? (
        <div className="rt-banner success">
          <StatusDot tone="success" />
          <div className="rt-banner-text">
            <strong>Everything is working</strong>
            Nimi answered 42 requests today, no failures.
          </div>
          <Pill tone="success">Healthy</Pill>
        </div>
      ) : (
        <div className="rt-banner warning">
          <StatusDot tone="warning" />
          <div className="rt-banner-text">
            <strong>Setup isn't finished</strong>
            Nimi can't answer yet — finish the steps below.
          </div>
        </div>
      )}

      {setupComplete ? (
        <Card
          title="Your setup"
          subtitle="How Nimi answers right now, in plain language."
          actions={
            <Button size="sm" onClick={() => onNavigate('answers')}>
              Change
            </Button>
          }
        >
          {setupRows.map((row) => (
            <div className="rt-setup-row" key={row.capability}>
              <row.icon size={15} />
              <span className="rt-setup-cap">{row.capability}</span>
              <span>{row.summary}</span>
            </div>
          ))}
        </Card>
      ) : (
        <Card
          title="Getting started"
          subtitle="Three steps and Nimi is ready."
          actions={
            <Button variant="ghost" size="sm" onClick={onOpenSetupGuide}>
              <IconSparkle size={14} /> Setup Guide
            </Button>
          }
        >
          {steps.map((step, i) => (
            <div className="rt-check-item" key={step.id}>
              <span className={`rt-check-num${step.done ? ' done' : ''}`}>
                {step.done ? <IconCheck size={12} /> : i + 1}
              </span>
              <div className="rt-check-body">
                <strong>{step.title}</strong>
                <div className="rt-check-desc">{step.description}</div>
              </div>
              {!step.done && (
                <Button size="sm" onClick={() => onNavigate(step.target)}>
                  {step.actionLabel}
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}

      <div className="rt-stat-grid">
        <div className="rt-stat">
          <div className="rt-stat-value">1.2M</div>
          <div className="rt-stat-label">Tokens this month</div>
        </div>
        <div className="rt-stat">
          <div className="rt-stat-value">$4.32</div>
          <div className="rt-stat-label">Estimated cost this month</div>
        </div>
        <div className="rt-stat">
          <div className="rt-stat-value">Companion</div>
          <div className="rt-stat-label">Active personality</div>
        </div>
      </div>
    </div>
  );
}
