import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentDetail } from '@renderer/hooks/use-agent-queries.js';
import { FieldGroup, formatDate } from './agent-detail-page-shared';

type ProfileTabProps = {
  agent: AgentDetail;
  onSave: (updates: Record<string, unknown>) => Promise<void>;
  saving: boolean;
};

export function ProfileTab({ agent, onSave, saving }: ProfileTabProps) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(agent.displayName);
  const [concept, setConcept] = useState(agent.concept);
  const [description, setDescription] = useState(agent.description || '');
  const [scenario, setScenario] = useState(agent.scenario || '');
  const [greeting, setGreeting] = useState(agent.greeting || '');
  const [wakeStrategy, setWakeStrategy] = useState(agent.wakeStrategy);

  const dirty =
    displayName !== agent.displayName ||
    concept !== agent.concept ||
    description !== (agent.description || '') ||
    scenario !== (agent.scenario || '') ||
    greeting !== (agent.greeting || '') ||
    wakeStrategy !== agent.wakeStrategy;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-xs text-neutral-500">
        <span>{t('agentDetail.statusLabel', 'Status:')} <strong className="text-neutral-300">{agent.status}</strong></span>
        <span>{t('agentDetail.stateLabel', 'State:')} <strong className="text-neutral-300">{agent.state}</strong></span>
        <span>{t('agentDetail.ownershipLabel', 'Ownership:')} <strong className="text-neutral-300">{agent.ownershipType === 'WORLD_OWNED' ? t('agentDetail.ownerWorld', 'World') : t('agentDetail.ownerMaster', 'Master')}</strong></span>
        {agent.worldId && <span>{t('agentDetail.worldLabel', 'World:')} <strong className="text-neutral-300">{agent.worldId}</strong></span>}
        <span>{t('agentDetail.createdLabel', 'Created:')} {formatDate(agent.createdAt)}</span>
        <span>{t('agentDetail.updatedLabel', 'Updated:')} {formatDate(agent.updatedAt)}</span>
      </div>

      <div className="space-y-4">
        <FieldGroup label={t('agentDetail.displayName', 'Display Name')}>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
        </FieldGroup>

        <FieldGroup label={t('agentDetail.concept', 'Concept')}>
          <textarea
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            rows={2}
            className="w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
        </FieldGroup>

        <FieldGroup label={t('agentDetail.description', 'Description')}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder={t('agentDetail.descriptionPlaceholder', 'Detailed description of the agent...')}
            className="w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
        </FieldGroup>

        <FieldGroup label={t('agentDetail.scenario', 'Scenario')}>
          <textarea
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            rows={3}
            placeholder={t('agentDetail.scenarioPlaceholder', 'The scenario or setting for this agent...')}
            className="w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
        </FieldGroup>

        <FieldGroup label={t('agentDetail.greeting', 'Greeting')}>
          <textarea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={2}
            placeholder={t('agentDetail.greetingPlaceholder', 'The first message the agent sends...')}
            className="w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
        </FieldGroup>

        <FieldGroup label={t('agentDetail.wakeStrategy', 'Wake Strategy')}>
          <div className="flex gap-2">
            {(['PASSIVE', 'PROACTIVE'] as const).map((strategy) => (
              <button
                key={strategy}
                onClick={() => setWakeStrategy(strategy)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  wakeStrategy === strategy
                    ? 'bg-white text-black'
                    : 'bg-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                {strategy === 'PASSIVE' ? t('agentDetail.passive', 'PASSIVE') : t('agentDetail.proactive', 'PROACTIVE')}
              </button>
            ))}
          </div>
        </FieldGroup>
      </div>

      <div className="flex justify-end pt-2">
        <button
          onClick={() => {
            void onSave({
              displayName,
              concept,
              description: description || undefined,
              scenario: scenario || undefined,
              greeting: greeting || undefined,
              wakeStrategy,
            });
          }}
          disabled={saving || !dirty}
          className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
        >
          {saving ? t('agentDetail.saving', 'Saving...') : t('agentDetail.saveProfile', 'Save Profile')}
        </button>
      </div>
    </div>
  );
}
