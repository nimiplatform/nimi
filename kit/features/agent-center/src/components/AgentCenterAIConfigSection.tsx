import { useMemo, useState } from 'react';
import type { NimiCapabilityAIConfigIntent } from '@nimiplatform/kit/core/sdk-contract';
import type {
  AgentCenterI18n,
  AgentCenterSession,
  AgentCenterSnapshot,
} from '../types.js';
import { translateAgentCenter } from '../i18n.js';
import {
  AgentButton,
  Card,
  Notice,
  SectionHeader,
  SectionShell,
  StatusPill,
} from './AgentCenterPrimitives.js';
import { AgentCenterProductActionNotice } from './AgentCenterProductActionNotice.js';

export interface AgentCenterAIConfigSectionProps {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly i18n?: AgentCenterI18n;
}

export function AgentCenterAIConfigSection({ session, snapshot, i18n }: AgentCenterAIConfigSectionProps) {
  const projection = snapshot.state.sharedAIConfig;
  const availability = snapshot.availability.overwriteSharedAIConfig;
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const labels = useMemo(() => ({
    title: translateAgentCenter(i18n, 'AgentCenter.aiConfig.sectionTitle', 'AI configuration'),
    description: translateAgentCenter(
      i18n,
      'AgentCenter.aiConfig.capabilityConfigurationDescription',
      'Choose Local or Cloud capability intent. Runtime selects the implementation when execution starts.',
    ),
    local: translateAgentCenter(i18n, 'AgentCenter.aiConfig.localIntentLabel', 'Local'),
    cloud: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudIntentLabel', 'Cloud'),
    configureLocal: translateAgentCenter(i18n, 'AgentCenter.aiConfig.configureLocalAction', 'Use Local'),
    notConfigured: translateAgentCenter(i18n, 'AgentCenter.aiConfig.notConfiguredLabel', 'Not configured'),
    saved: translateAgentCenter(i18n, 'AgentCenter.aiConfig.savedLabel', 'Configuration saved'),
    failed: translateAgentCenter(i18n, 'AgentCenter.aiConfig.saveFailedLabel', 'Configuration update failed'),
  }), [i18n]);

  const configureLocalText = async () => {
    if (!projection || saving) return;
    const existing = projection.aiConfig.capabilities.find(
      (intent) => intent.capabilityContract === 'text.generate',
    );
    const nextIntent: NimiCapabilityAIConfigIntent = {
      capabilityContract: 'text.generate',
      route: { oneofKind: 'local', local: {} },
      requiredFeatures: [...(existing?.requiredFeatures ?? [])],
      ...(existing?.defaults ? { defaults: existing.defaults } : {}),
    };
    const capabilities = projection.aiConfig.capabilities
      .filter((intent) => intent.capabilityContract !== 'text.generate')
      .concat(nextIntent);
    setSaving(true);
    setStatus('');
    try {
      await session.overwriteSharedAIConfig({ capabilities });
      setStatus(labels.saved);
    } catch {
      setStatus(labels.failed);
    } finally {
      setSaving(false);
    }
  };

  if (availability.state === 'unavailable') {
    return (
      <SectionShell labelledBy="agent-center-ai-config-title">
        <SectionHeader id="agent-center-ai-config-title" title={labels.title} description={labels.description} />
        <AgentCenterProductActionNotice
          action="overwriteSharedAIConfig"
          availability={availability}
          i18n={i18n}
          session={session}
        />
      </SectionShell>
    );
  }

  return (
    <SectionShell labelledBy="agent-center-ai-config-title">
      <SectionHeader
        id="agent-center-ai-config-title"
        title={labels.title}
        description={labels.description}
        right={(
          <AgentButton
            disabled={!projection || saving}
            onClick={() => { void configureLocalText(); }}
            variant="primary"
          >
            {saving ? '…' : labels.configureLocal}
          </AgentButton>
        )}
      />
      {projection ? (
        <Card>
          <div className="divide-y divide-slate-100">
            {projection.aiConfig.capabilities.length > 0 ? projection.aiConfig.capabilities.map((intent) => {
              const local = intent.route.oneofKind === 'local';
              return (
                <div
                  className="flex min-w-0 items-center justify-between gap-3 px-3.5 py-3"
                  data-agent-center-capability-intent={intent.capabilityContract}
                  key={intent.capabilityContract}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-slate-950">
                      {intent.capabilityContract}
                    </div>
                    {intent.requiredFeatures.length > 0 ? (
                      <div className="mt-0.5 truncate text-[11.5px] text-slate-500">
                        {intent.requiredFeatures.join(', ')}
                      </div>
                    ) : null}
                  </div>
                  <StatusPill tone={local ? 'ready' : 'muted'} label={local ? labels.local : labels.cloud} />
                </div>
              );
            }) : (
              <div className="px-3.5 py-3 text-[12.5px] text-slate-500">{labels.notConfigured}</div>
            )}
          </div>
        </Card>
      ) : <Notice tone="warn">{labels.notConfigured}</Notice>}
      {status ? <Notice ariaLive="polite" tone={status === labels.failed ? 'warn' : 'info'}>{status}</Notice> : null}
    </SectionShell>
  );
}
