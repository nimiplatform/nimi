import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ForgePage,
  ForgePageHeader,
  ForgeSection,
  ForgeSectionHeading,
  ForgeStatCard,
} from '@renderer/components/page-layout.js';
import { ForgeActionCard } from '@renderer/components/card-list.js';
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
    <ForgePage>
      <ForgePageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.welcome')}
      />

      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow={t('dashboard.title')}
          title={t('dashboard.quickStats', 'Studio Snapshot')}
          description={t('dashboard.quickStatsDesc', 'Current counts across worlds, agents, and available spark.')}
        />
        <div className="grid gap-4 md:grid-cols-3">
          {stats.map((stat) => (
            <ForgeStatCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
            />
          ))}
        </div>
      </ForgeSection>

      <ForgeSection className="space-y-4" material="glass-regular">
        <ForgeSectionHeading
          eyebrow={t('dashboard.title')}
          title={t('dashboard.jumpIn', 'Jump Back In')}
          description={t('dashboard.jumpInDesc', 'Open the main creator surfaces without leaving the unified studio shell.')}
        />
        <div className="grid gap-4 md:grid-cols-2">
          {NAV_CARDS.map((card) => (
            <ForgeActionCard
              key={card.path}
              icon={<span className="text-2xl">{card.icon}</span>}
              title={t(card.label)}
              description={t(card.description, card.description)}
              onClick={() => navigate(card.path)}
            />
          ))}
        </div>
      </ForgeSection>
    </ForgePage>
  );
}
