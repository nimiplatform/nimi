import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useWorldResourceQueries } from '@renderer/hooks/use-world-queries.js';
import { useAgentListQuery } from '@renderer/hooks/use-agent-queries.js';
import { useBalancesQuery } from '@renderer/hooks/use-revenue-queries.js';

const NAV_CARDS = [
  { path: '/workbench', label: 'nav.worlds', icon: '🌍', description: 'dashboard.worldsDesc' },
  { path: '/agents/library', label: 'nav.agents', icon: '🤖', description: 'dashboard.agentsDesc' },
  { path: '/content/images', label: 'nav.content', icon: '🎨', description: 'dashboard.contentDesc' },
  { path: '/revenue', label: 'nav.revenue', icon: '💰', description: 'dashboard.revenueDesc' },
] as const;

export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const worldQueries = useWorldResourceQueries({ enabled: true, worldId: '', enableCollections: true });
  const agentQuery = useAgentListQuery(true);
  const balancesQuery = useBalancesQuery(true);

  const worldCount = (worldQueries.worldsQuery.data?.length ?? 0) + (worldQueries.draftsQuery.data?.length ?? 0);
  const agentCount = agentQuery.data?.length ?? 0;

  const balancesData = balancesQuery.data && typeof balancesQuery.data === 'object'
    ? (balancesQuery.data as Record<string, unknown>)
    : {};
  const sparkBalance = Number(balancesData.spark ?? 0);

  const stats = [
    { label: t('dashboard.worlds', 'Worlds'), value: worldCount },
    { label: t('dashboard.agents', 'Agents'), value: agentCount },
    { label: t('dashboard.sparkBalance', 'Spark'), value: sparkBalance },
  ];

  return (
    <div className="h-full overflow-auto p-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t('dashboard.title')}</h1>
          <p className="mt-2 text-neutral-400">{t('dashboard.welcome')}</p>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4"
            >
              <p className="text-xs text-neutral-500">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold text-white">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Navigation cards */}
        <div className="grid grid-cols-2 gap-4">
          {NAV_CARDS.map((card) => (
            <button
              key={card.path}
              onClick={() => navigate(card.path)}
              className="flex items-start gap-4 rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4 text-left transition-colors hover:border-neutral-600 hover:bg-neutral-900"
            >
              <span className="text-2xl">{card.icon}</span>
              <div>
                <p className="text-sm font-medium text-white">{t(card.label)}</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {t(card.description, card.description)}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
