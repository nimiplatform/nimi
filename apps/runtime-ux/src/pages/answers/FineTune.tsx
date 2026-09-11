import { useState } from 'react';
import { Button, Pill, SegmentedControl } from '../../ui';
import { IconArrowRight, IconCloud, IconCpu } from '../../icons';
import { routePlans, type Capability, type RoutePlan } from '../../data';

const capabilities = ['Chat', 'Image', 'Embedding'] as const;

function PlanCard({ plan }: { plan: RoutePlan }) {
  return (
    <div className={`rt-plan-card${plan.current ? ' current' : ''}`}>
      <div className="rt-plan-head">
        <span className="rt-plan-name">
          {plan.name}
          {plan.current && <Pill tone="accent">Current</Pill>}
          {plan.recommended && <Pill tone="success">Recommended</Pill>}
        </span>
        {!plan.current && <Button size="sm" variant="primary">Use this routing</Button>}
      </div>
      {plan.routes.map((r) => (
        <div className="rt-plan-route" key={r.capability}>
          {r.via === 'This device' ? <IconCpu size={14} /> : <IconCloud size={14} />}
          <span>
            {r.capability} <IconArrowRight size={12} style={{ verticalAlign: '-2px' }} />{' '}
            <strong>{r.target}</strong> ({r.via})
          </span>
        </div>
      ))}
      <p style={{ margin: '6px 0 0', color: 'var(--nimi-text-secondary)', fontSize: 12 }}>{plan.note}</p>
    </div>
  );
}

export function FineTune() {
  const [capability, setCapability] = useState<Capability>('Chat');
  const plans = routePlans[capability];

  return (
    <>
      <p style={{ margin: '0 0 12px', color: 'var(--nimi-text-secondary)', fontSize: 12.5 }}>
        Route each capability to a specific model or service. Presets already set sensible
        routing — only change this if you know what you want.
      </p>
      <div className="rt-toolbar">
        <SegmentedControl options={capabilities} value={capability} onChange={setCapability} />
      </div>
      <PlanCard plan={plans.current} />
      <h4 style={{ margin: '16px 0 8px', fontSize: 12, color: 'var(--nimi-text-secondary)' }}>
        Other routings
      </h4>
      {plans.recommended.map((p) => (
        <PlanCard key={p.id} plan={p} />
      ))}
    </>
  );
}
