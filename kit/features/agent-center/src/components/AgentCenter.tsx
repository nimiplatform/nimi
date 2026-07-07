import { Brain, Gauge, MonitorCog, Palette, Settings2, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AGENT_CENTER_SECTION_LABELS } from '../sections.js';
import { resolveAgentCenterState } from '../state.js';
import type { AgentCenterProps, AgentCenterSectionId, AgentCenterState } from '../types.js';
import { AgentCenterAppearanceSection } from './AgentCenterAppearanceSection.js';
import { AgentCenterBehaviorSection } from './AgentCenterBehaviorSection.js';
import { AgentCenterCognitionSection } from './AgentCenterCognitionSection.js';
import { AgentCenterModelSection } from './AgentCenterModelSection.js';

const sectionIcons = {
  overview: Gauge,
  model: MonitorCog,
  behavior: Settings2,
  cognition: Brain,
  appearance: Palette,
  advanced: Wrench,
} as const;

function toneColor(tone: AgentCenterState['statusTone']) {
  switch (tone) {
    case 'ready':
      return '#146c43';
    case 'attention':
      return '#8a5a00';
    case 'failed':
      return '#b42318';
    case 'loading':
      return '#3451b2';
    default:
      return '#5f6368';
  }
}

function AgentCenterOverview({ state }: { readonly state: AgentCenterState }) {
  return (
    <section aria-labelledby="agent-center-overview-title" style={{ display: 'grid', gap: 12 }}>
      <header>
        <h2 id="agent-center-overview-title" style={{ margin: 0, fontSize: 18 }}>Overview</h2>
        <p style={{ margin: '4px 0 0', color: '#5f6368', fontSize: 13 }}>
          Runtime {state.runtimeStatus}
        </p>
      </header>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {[
          ['Text readiness', state.baseTextReady ? 'ready' : state.baseTextDisabledReason || 'unavailable'],
          ['Autonomy', state.autonomy.mode || 'unavailable'],
          ['Cognition', state.cognition.statusText || state.cognition.executionState || 'unavailable'],
          ['Appearance', state.appearance.status],
        ].map(([label, value]) => (
          <div key={label} style={{ border: '1px solid #d8dee8', borderRadius: 8, padding: 10 }}>
            <div style={{ color: '#687386', fontSize: 12 }}>{label}</div>
            <div style={{ fontSize: 14, marginTop: 4, overflowWrap: 'anywhere' }}>{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AgentCenterAdvanced({ state }: { readonly state: AgentCenterState }) {
  return (
    <section aria-labelledby="agent-center-advanced-title" style={{ display: 'grid', gap: 12 }}>
      <header>
        <h2 id="agent-center-advanced-title" style={{ margin: 0, fontSize: 18 }}>Advanced</h2>
        <p style={{ margin: '4px 0 0', color: '#5f6368', fontSize: 13 }}>
          {state.diagnostics.source}
        </p>
      </header>
      <dl style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(128px, auto) 1fr', margin: 0, fontSize: 13 }}>
        <dt style={{ color: '#687386' }}>Config revision</dt>
        <dd style={{ margin: 0 }}>{state.diagnostics.configRevision ?? 'unavailable'}</dd>
        <dt style={{ color: '#687386' }}>Runtime turn</dt>
        <dd style={{ margin: 0 }}>{state.diagnostics.runtimeTurnId || 'not projected'}</dd>
        <dt style={{ color: '#687386' }}>Runtime stream</dt>
        <dd style={{ margin: 0 }}>{state.diagnostics.runtimeStreamId || 'not projected'}</dd>
        <dt style={{ color: '#687386' }}>Runtime error</dt>
        <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{state.diagnostics.runtimeError || 'none'}</dd>
      </dl>
    </section>
  );
}

function renderSection(section: AgentCenterSectionId, state: AgentCenterState) {
  switch (section) {
    case 'model':
      return <AgentCenterModelSection state={state} />;
    case 'behavior':
      return <AgentCenterBehaviorSection state={state} />;
    case 'cognition':
      return <AgentCenterCognitionSection state={state} />;
    case 'appearance':
      return <AgentCenterAppearanceSection state={state} />;
    case 'advanced':
      return <AgentCenterAdvanced state={state} />;
    default:
      return <AgentCenterOverview state={state} />;
  }
}

export function AgentCenter(props: AgentCenterProps) {
  const state = useMemo(() => resolveAgentCenterState(props.state), [props.state]);
  const [uncontrolledSection, setUncontrolledSection] = useState<AgentCenterSectionId>(
    props.defaultSection || 'overview',
  );
  const activeSection = props.activeSection || uncontrolledSection;
  const setSection = (section: AgentCenterSectionId) => {
    if (!props.activeSection) {
      setUncontrolledSection(section);
    }
    props.onSectionChange?.(section);
  };

  return (
    <section
      aria-label={props.ariaLabel || 'Agent Center'}
      data-chat-agent-center="true"
      style={{
        background: '#f8fafc',
        border: '1px solid #ccd6e3',
        borderRadius: 8,
        color: '#172033',
        display: 'grid',
        gap: 14,
        maxWidth: '100%',
        minWidth: 0,
        padding: 14,
      }}
    >
      <header style={{ alignItems: 'start', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 20, lineHeight: 1.2, margin: 0 }}>Agent Center</h1>
          <p style={{ color: toneColor(state.statusTone), fontSize: 13, margin: '6px 0 0', overflowWrap: 'anywhere' }}>
            {state.baseTextReady ? 'Runtime text turns ready' : state.baseTextDisabledReason}
          </p>
        </div>
        {props.placementActions?.close ? (
          <button
            aria-label="Close Agent Center"
            onClick={props.placementActions.close}
            style={{ border: '1px solid #c7d1df', borderRadius: 6, minHeight: 32, padding: '4px 10px' }}
            type="button"
          >
            Close
          </button>
        ) : null}
      </header>
      <nav aria-label="Agent Center sections" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {state.sections.map((section) => {
          const Icon = sectionIcons[section];
          const selected = section === activeSection;
          return (
            <button
              aria-current={selected ? 'page' : undefined}
              aria-pressed={selected}
              data-testid={`chat-agent-center-section:${section}`}
              key={section}
              onClick={() => setSection(section)}
              style={{
                alignItems: 'center',
                background: selected ? '#163b66' : '#ffffff',
                border: '1px solid #c7d1df',
                borderRadius: 6,
                color: selected ? '#ffffff' : '#1d2a3b',
                display: 'inline-flex',
                gap: 6,
                minHeight: 34,
                padding: '6px 10px',
              }}
              type="button"
            >
              <Icon aria-hidden="true" size={15} />
              <span>{AGENT_CENTER_SECTION_LABELS[section]}</span>
            </button>
          );
        })}
      </nav>
      <div style={{ minWidth: 0 }}>
        {renderSection(activeSection, state)}
      </div>
    </section>
  );
}
