/**
 * Agents Page — list all creator agents (FG-AGENT-001)
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, SearchField, Surface } from '@nimiplatform/nimi-kit/ui';
import { useAgentListQuery, type AgentSummary } from '@renderer/hooks/use-agent-queries.js';
import { useAgentMutations } from '@renderer/hooks/use-agent-mutations.js';
import type { JsonObject } from '@renderer/bridge';
import {
  ForgePage,
  ForgePageHeader,
  ForgeEmptyState,
  ForgeLoadingSpinner,
  ForgeSection,
} from '@renderer/components/page-layout.js';
import { ForgeSegmentControl } from '@renderer/components/segment-control.js';
import { ForgeListCard, ForgeEntityAvatar } from '@renderer/components/card-list.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { LabeledTextField, LabeledTextareaField } from '@renderer/components/form-fields.js';
import { ForgeConfirmDialog, useConfirmDialog } from '@renderer/components/confirm-modals.js';
import { formatDate } from '@renderer/components/format-utils.js';

type OwnerFilter = 'ALL' | 'MASTER_OWNED' | 'WORLD_OWNED';

export default function AgentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const agentsQuery = useAgentListQuery();
  const mutations = useAgentMutations();

  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('MASTER_OWNED');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const agents = agentsQuery.data || [];

  const filtered = useMemo(() => {
    let list = agents;
    if (ownerFilter !== 'ALL') {
      list = list.filter((a) => a.ownershipType === ownerFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.displayName.toLowerCase().includes(q) ||
          a.handle.toLowerCase().includes(q) ||
          a.concept.toLowerCase().includes(q),
      );
    }
    return list;
  }, [agents, ownerFilter, search]);

  return (
    <ForgePage>
      <ForgePageHeader
        title={t('pages.agents')}
        subtitle={t('agents.subtitle', 'Master agent library and world-owned agent entrypoints')}
        actions={
          <Button tone="primary" size="md" onClick={() => setShowCreateForm(true)}>
            {t('agents.createNew', 'Create Agent')}
          </Button>
        }
      />

      <ForgeSection className="flex flex-col gap-3 md:flex-row md:items-center">
        <SearchField
          placeholder={t('agents.searchPlaceholder', 'Search agents...')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        <ForgeSegmentControl
          options={[
            { value: 'ALL' as const, label: t('agents.filterAll', 'All') },
            { value: 'MASTER_OWNED' as const, label: t('agents.filterMaster', 'Master') },
            { value: 'WORLD_OWNED' as const, label: t('agents.filterWorld', 'World') },
          ]}
          value={ownerFilter}
          onChange={setOwnerFilter}
        />
      </ForgeSection>

      {/* Create form */}
      {showCreateForm && (
        <CreateAgentForm
          onSubmit={async (payload) => {
            await mutations.createAgentMutation.mutateAsync(payload);
            await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'list'] });
            setShowCreateForm(false);
          }}
          onCancel={() => setShowCreateForm(false)}
          creating={mutations.createAgentMutation.isPending}
        />
      )}

      {/* Agent list */}
      {agentsQuery.isLoading ? (
        <ForgeLoadingSpinner />
      ) : filtered.length === 0 ? (
        <ForgeEmptyState
          message={
            agents.length === 0
              ? t('agents.noAgents', 'No agents yet. Create your first agent to get started.')
              : t('agents.noResults', 'No agents match your search.')
          }
        />
      ) : (
        <ForgeSection className="space-y-2">
          {filtered.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onEdit={() => navigate(`/agents/${agent.id}`)}
              onDelete={async () => {
                await mutations.deleteAgentMutation.mutateAsync(agent.id);
                await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'list'] });
              }}
            />
          ))}
        </ForgeSection>
      )}
    </ForgePage>
  );
}

function AgentCard({
  agent,
  onEdit,
  onDelete,
}: {
  agent: AgentSummary;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const deleteConfirm = useConfirmDialog();

  return (
    <>
      <ForgeListCard
        leading={<ForgeEntityAvatar src={agent.avatarUrl} name={agent.displayName || agent.handle} />}
        title={agent.displayName || agent.handle}
        subtitle={`@${agent.handle} · ${agent.concept || t('agents.noConcept', 'No concept')} · ${formatDate(agent.updatedAt)}`}
        badges={
          <>
            <ForgeStatusBadge
              domain="ownership"
              status={agent.ownershipType}
              label={agent.ownershipType === 'WORLD_OWNED' ? t('agents.badgeWorld', 'WORLD') : t('agents.badgeMaster', 'MASTER')}
            />
            <ForgeStatusBadge domain="agent" status={agent.status} />
          </>
        }
        actions={
          <>
            <Button tone="ghost" size="sm" onClick={onEdit}>
              {t('agents.edit', 'Edit')}
            </Button>
            <Button
              tone="danger"
              size="sm"
              onClick={async (e) => {
                e.stopPropagation();
                const confirmed = await deleteConfirm.confirm();
                if (confirmed) void onDelete();
              }}
            >
              {t('agents.delete', 'Delete')}
            </Button>
          </>
        }
      />
      <ForgeConfirmDialog
        {...deleteConfirm.dialogProps}
        title={t('agents.deleteDialogTitle', 'Delete Agent')}
        message={t('agents.confirmDelete', 'Delete this agent?')}
        confirmLabel={t('agents.delete', 'Delete')}
      />
    </>
  );
}

function CreateAgentForm({
  onSubmit,
  onCancel,
  creating,
}: {
  onSubmit: (payload: JsonObject) => Promise<void>;
  onCancel: () => void;
  creating: boolean;
}) {
  const { t } = useTranslation();
  const [handle, setHandle] = useState('');
  const [concept, setConcept] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [ownershipType, setOwnershipType] = useState<'MASTER_OWNED' | 'WORLD_OWNED'>('MASTER_OWNED');

  return (
    <Surface tone="card" material="glass-regular" elevation="raised" padding="md">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('agents.createNew', 'Create Agent')}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <LabeledTextField
            label={t('agents.handleLabel', 'Handle')}
            required
            value={handle}
            onChange={setHandle}
            placeholder={t('agents.handlePlaceholder', 'my-agent')}
          />
          <LabeledTextField
            label={t('agents.displayNameLabel', 'Display Name')}
            value={displayName}
            onChange={setDisplayName}
            placeholder={t('agents.displayNamePlaceholder', 'My Agent')}
          />
        </div>
        <LabeledTextareaField
          label={t('agents.conceptLabel', 'Concept')}
          required
          value={concept}
          onChange={setConcept}
          placeholder={t('agents.conceptPlaceholder', "A brief description of this agent's personality and purpose...")}
          rows={3}
        />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
            {t('agents.ownershipLabel', 'Ownership')}
          </label>
          <ForgeSegmentControl
            options={[
              { value: 'MASTER_OWNED' as const, label: t('agents.ownerMaster', 'Master') },
              { value: 'WORLD_OWNED' as const, label: t('agents.ownerWorld', 'World') },
            ]}
            value={ownershipType}
            onChange={setOwnershipType}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button tone="ghost" size="sm" onClick={onCancel}>
            {t('agents.cancel', 'Cancel')}
          </Button>
          <Button
            tone="primary"
            size="sm"
            disabled={creating || !handle.trim() || !concept.trim()}
            onClick={() => {
              if (!handle.trim() || !concept.trim()) return;
              void onSubmit({
                handle: handle.trim(),
                concept: concept.trim(),
                displayName: displayName.trim() || undefined,
                ownershipType,
              });
            }}
          >
            {creating ? t('agents.creating', 'Creating...') : t('agents.create', 'Create')}
          </Button>
        </div>
      </div>
    </Surface>
  );
}
