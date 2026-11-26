import { useState } from 'react';
import { Button, Pill, SegmentedControl } from '../../ui';
import { IconArrowRight, IconCloud, IconCpu } from '../../icons';
import { routePlans, type Capability, type RoutePlan } from '../../data';

const capabilities = ['Chat', 'Image', 'Embedding'] as const;

function PlanCard({
  plan,
  isCurrent,
  onSelect,
}: {
  plan: RoutePlan;
  isCurrent: boolean;
  onSelect?: () => void;
}) {
  return (
    <div className={`rt-plan-card${isCurrent ? ' current' : ''}`}>
      <div className="rt-plan-head">
        <span className="rt-plan-name">
          {plan.name}
          {isCurrent && <Pill tone="accent">Current</Pill>}
          {plan.recommended && <Pill tone="success">Recommended</Pill>}
        </span>
        {!isCurrent && (
          <Button size="sm" variant="primary" onClick={onSelect}>
            Use this routing
          </Button>
        )}
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
      <p style={{ margin: '6px 0 0', color: 'var(--nimi-text-secondary)', fontSize: '0.75rem' }}>{plan.note}</p>
    </div>
  );
}

export function FineTune() {
  const [capability, setCapability] = useState<Capability>('Chat');
  const [activePlanByCap, setActivePlanByCap] = useState<Record<Capability, string>>({
    Chat: routePlans.Chat.current.id,
    Image: routePlans.Image.current.id,
    Embedding: routePlans.Embedding.current.id,
  });

  const plans = routePlans[capability];
  const allPlans = [plans.current, ...plans.recommended];
  const activeId = activePlanByCap[capability];
  const currentPlan = allPlans.find((p) => p.id === activeId) ?? plans.current;
  const otherPlans = allPlans.filter((p) => p.id !== currentPlan.id);

  return (
    <>
      <p style={{ margin: '0 0 12px', color: 'var(--nimi-text-secondary)', fontSize: '0.78125rem' }}>
        Route each capability to a specific model or service. Presets already set sensible
        routing — only change this if you know what you want.
      </p>
      <div className="rt-toolbar">
        <SegmentedControl options={capabilities} value={capability} onChange={setCapability} />
      </div>
      <PlanCard plan={currentPlan} isCurrent />
      <h4 style={{ margin: '16px 0 8px', fontSize: '0.75rem', color: 'var(--nimi-text-secondary)' }}>
        Other routings
      </h4>
      {otherPlans.map((p) => (
        <PlanCard
          key={p.id}
          plan={p}
          isCurrent={false}
          onSelect={() => setActivePlanByCap((prev) => ({ ...prev, [capability]: p.id }))}
        />
      ))}
    </>
  );
}
