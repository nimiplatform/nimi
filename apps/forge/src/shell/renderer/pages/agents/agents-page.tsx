/**
 * Agents Page — list all creator agents (FG-AGENT-001)
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAgentListQuery, type AgentSummary } from '@renderer/hooks/use-agent-queries.js';
import { useAgentMutations } from '@renderer/hooks/use-agent-mutations.js';

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

type OwnerFilter = 'ALL' | 'MASTER_OWNED' | 'WORLD_OWNED';

export default function AgentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const agentsQuery = useAgentListQuery();
  const mutations = useAgentMutations();

  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('ALL');
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
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('pages.agents')}</h1>
            <p className="mt-1 text-sm text-neutral-400">
              {t('agents.subtitle', 'Manage your AI agents')}
            </p>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200 transition-colors"
          >
            {t('agents.createNew', 'Create Agent')}
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder={t('agents.searchPlaceholder', 'Search agents...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
          <div className="flex rounded-lg border border-neutral-700 overflow-hidden">
            {(['ALL', 'MASTER_OWNED', 'WORLD_OWNED'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setOwnerFilter(filter)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  ownerFilter === filter
                    ? 'bg-white text-black'
                    : 'bg-neutral-900 text-neutral-400 hover:text-white'
                }`}
              >
                {filter === 'ALL' ? t('agents.filterAll', 'All') :
                 filter === 'MASTER_OWNED' ? t('agents.filterMaster', 'Master') :
                 t('agents.filterWorld', 'World')}
              </button>
            ))}
          </div>
        </div>

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
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-8 text-center">
            <p className="text-neutral-400">
              {agents.length === 0
                ? t('agents.noAgents', 'No agents yet. Create your first agent to get started.')
                : t('agents.noResults', 'No agents match your search.')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
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
          </div>
        )}
      </div>
    </div>
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
  const ownerBadge = agent.ownershipType === 'WORLD_OWNED'
    ? 'bg-blue-500/20 text-blue-400'
    : 'bg-purple-500/20 text-purple-400';

  const statusColors: Record<string, string> = {
    ACTIVE: 'bg-green-500/20 text-green-400',
    INCUBATING: 'bg-yellow-500/20 text-yellow-400',
    READY: 'bg-cyan-500/20 text-cyan-400',
    SUSPENDED: 'bg-red-500/20 text-red-400',
    FAILED: 'bg-red-500/20 text-red-400',
  };

  return (
    <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 hover:border-neutral-700 transition-colors">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="h-10 w-10 flex-shrink-0 rounded-full bg-neutral-800 flex items-center justify-center overflow-hidden">
          {agent.avatarUrl ? (
            <img src={agent.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-lg text-neutral-500">
              {(agent.displayName || agent.handle || '?')[0]?.toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-white truncate">
              {agent.displayName || agent.handle}
            </p>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ownerBadge}`}>
              {agent.ownershipType === 'WORLD_OWNED' ? 'WORLD' : 'MASTER'}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusColors[agent.status] || 'bg-neutral-700 text-neutral-300'}`}>
              {agent.status}
            </span>
          </div>
          <p className="text-xs text-neutral-500 truncate">
            @{agent.handle} · {agent.concept || 'No concept'} · {formatDate(agent.updatedAt)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 ml-3">
        <button
          onClick={onEdit}
          className="rounded px-3 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-800 transition-colors"
        >
          Edit
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm('Delete this agent?')) void onDelete();
          }}
          className="rounded px-3 py-1 text-xs font-medium text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function CreateAgentForm({
  onSubmit,
  onCancel,
  creating,
}: {
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  creating: boolean;
}) {
  const { t } = useTranslation();
  const [handle, setHandle] = useState('');
  const [concept, setConcept] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [ownershipType, setOwnershipType] = useState<'MASTER_OWNED' | 'WORLD_OWNED'>('MASTER_OWNED');

  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-4 space-y-4">
      <h3 className="text-sm font-semibold text-white">{t('agents.createNew', 'Create Agent')}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-neutral-400 mb-1">Handle *</label>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="my-agent"
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-400 mb-1">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="My Agent"
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-neutral-400 mb-1">Concept *</label>
        <textarea
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          placeholder="A brief description of this agent's personality and purpose..."
          rows={3}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none resize-none"
        />
      </div>
      <div>
        <label className="block text-xs text-neutral-400 mb-1">Ownership</label>
        <div className="flex gap-2">
          {(['MASTER_OWNED', 'WORLD_OWNED'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setOwnershipType(type)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                ownershipType === type ? 'bg-white text-black' : 'bg-neutral-800 text-neutral-400 hover:text-white'
              }`}
            >
              {type === 'MASTER_OWNED' ? 'Master' : 'World'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="rounded px-4 py-1.5 text-sm text-neutral-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            if (!handle.trim() || !concept.trim()) return;
            void onSubmit({
              handle: handle.trim(),
              concept: concept.trim(),
              displayName: displayName.trim() || undefined,
              ownershipType,
            });
          }}
          disabled={creating || !handle.trim() || !concept.trim()}
          className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
        >
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  );
}
