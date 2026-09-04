import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  loadNimiAppAIProfileFactoryRows,
  type NimiAppAIProfileFactoryRow,
} from '@nimiplatform/sdk/app';
import type {
  NimiRuntimeFactoryProfileRecommendation,
  NimiRuntimeRecommendationApplicability,
} from '@nimiplatform/sdk/runtime';
import { Button, InlineAlert, SelectField, StatusBadge, Surface } from '@nimiplatform/kit/ui';

import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import { RuntimePageShell } from './runtime-config-page-shell.js';

const ALL_CAPABILITIES_FILTER = '__all_capabilities__';

export function ProfileRecommendationsPage(props: {
  readonly onOpenLoadouts: (capabilityContract: string) => void;
}) {
  const { t } = useTranslation();
  const client = useRuntimeConfigLocalEnvironmentClient();
  const factoryRows = useMemo(() => loadNimiAppAIProfileFactoryRows(), []);
  const [capabilityFilter, setCapabilityFilter] = useState(ALL_CAPABILITIES_FILTER);
  const filteredCapability = capabilityFilter === ALL_CAPABILITIES_FILTER ? '' : capabilityFilter;
  const capabilities = useMemo(() => {
    const values: string[] = [];
    for (const row of factoryRows) {
      for (const capability of row.capabilitySet) {
        if (!values.includes(capability)) values.push(capability);
      }
    }
    return values;
  }, [factoryRows]);
  const recommendations = useQuery({
    queryKey: ['factory-profile-recommendations', capabilityFilter],
    queryFn: () => client.listFactoryProfileRecommendations({
      ...(filteredCapability ? { capabilityContract: filteredCapability } : {}),
    }),
    refetchOnWindowFocus: false,
  });
  const cards = useMemo(() => joinFactoryRecommendations(factoryRows, recommendations.data ?? []), [factoryRows, recommendations.data]);
  const supported = filteredCapability
    ? cards.filter((card) => profileFilterApplicability(card.recommendation, filteredCapability) === 'supported')
    : cards;
  const unknown = filteredCapability
    ? cards.filter((card) => profileFilterApplicability(card.recommendation, filteredCapability) === 'unknown')
    : [];
  const unsupported = filteredCapability
    ? cards.filter((card) => profileFilterApplicability(card.recommendation, filteredCapability) === 'unsupported')
    : [];

  return (
    <RuntimePageShell>
      <Surface tone="card" className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.profiles.recommendedTitle', { defaultValue: 'Recommended Profiles' })}
          </h3>
          <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.recommendedDescription', {
              defaultValue: 'Portable factory Profiles stay canonical. A capability filter changes only that capability’s host assessment.',
            })}
          </p>
        </div>
        <SelectField
          aria-label={t('runtimeConfig.profiles.capabilityFilter', { defaultValue: 'Capability filter' })}
          value={capabilityFilter}
          options={[
            { value: ALL_CAPABILITIES_FILTER, label: t('runtimeConfig.profiles.allCapabilities', { defaultValue: 'All capabilities' }) },
            ...capabilities.map((capability) => ({
              value: capability,
              label: displayRuntimeConfigCapabilityLabel(capability, t),
            })),
          ]}
          onValueChange={setCapabilityFilter}
        />
      </Surface>
      {recommendations.isPending ? <p className="text-sm text-[var(--nimi-text-muted)]">{t('Common.loading', { defaultValue: 'Loading…' })}</p> : null}
      {recommendations.isError ? <InlineAlert tone="danger">{t('runtimeConfig.profiles.recommendationsFailed', { defaultValue: 'Profile recommendations are unavailable.' })}</InlineAlert> : null}
      {!recommendations.isPending && !recommendations.isError ? (
        <>
          <ProfileRecommendationGroup
            title={t('runtimeConfig.profiles.recommendedGroup', { defaultValue: 'Recommended' })}
            cards={supported}
            onOpenLoadouts={props.onOpenLoadouts}
          />
          {unknown.length > 0 ? (
            <ProfileRecommendationGroup
              title={t('runtimeConfig.profiles.unknownGroup', { defaultValue: 'Needs host information' })}
              cards={unknown}
              onOpenLoadouts={props.onOpenLoadouts}
            />
          ) : null}
          {unsupported.length > 0 ? (
            <ProfileRecommendationGroup
              title={t('runtimeConfig.profiles.unsupportedGroup', { defaultValue: 'Limited on this host' })}
              cards={unsupported}
              onOpenLoadouts={props.onOpenLoadouts}
            />
          ) : null}
        </>
      ) : null}
    </RuntimePageShell>
  );
}

type ProfileRecommendationCard = {
  readonly row: NimiAppAIProfileFactoryRow;
  readonly recommendation: NimiRuntimeFactoryProfileRecommendation;
};

export function joinFactoryRecommendations(
  rows: readonly NimiAppAIProfileFactoryRow[],
  recommendations: readonly NimiRuntimeFactoryProfileRecommendation[],
): readonly ProfileRecommendationCard[] {
  const rowsByAlias = new Map(rows.map((row) => [row.alias, row]));
  return recommendations.flatMap((recommendation) => {
    const row = rowsByAlias.get(recommendation.profileAlias);
    return row ? [{ row, recommendation }] : [];
  });
}

function profileFilterApplicability(
  recommendation: NimiRuntimeFactoryProfileRecommendation,
  capabilityContract: string,
): NimiRuntimeRecommendationApplicability | undefined {
  return recommendation.capabilities.find((capability) => (
    capability.capabilityContract === capabilityContract
  ))?.applicability;
}

function ProfileRecommendationGroup(props: {
  readonly title: string;
  readonly cards: readonly ProfileRecommendationCard[];
  readonly onOpenLoadouts: (capabilityContract: string) => void;
}) {
  if (props.cards.length === 0) return null;
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{props.title}</h3>
      {props.cards.map((card) => (
        <ProfileRecommendationCardView
          key={card.row.alias}
          card={card}
          onOpenLoadouts={props.onOpenLoadouts}
        />
      ))}
    </section>
  );
}

function ProfileRecommendationCardView(props: {
  readonly card: ProfileRecommendationCard;
  readonly onOpenLoadouts: (capabilityContract: string) => void;
}) {
  const { t } = useTranslation();
  const { row, recommendation } = props.card;
  return (
    <Surface tone="card" className="space-y-3 p-4" data-testid={`factory-profile:${row.alias}`}>
      <div>
        <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{profileAliasLabel(row.alias)}</h4>
        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{row.privacyPosture} · {row.computePosture} · {row.routingPolicy}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {row.capabilitySet.map((capabilityContract) => {
          const applicability = recommendation.capabilities.find((item) => (
            item.capabilityContract === capabilityContract
          ));
          return (
            <div key={capabilityContract} className="rounded-lg border border-[var(--nimi-border-subtle)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--nimi-text-primary)]">
                  {displayRuntimeConfigCapabilityLabel(capabilityContract, t)}
                </span>
                {applicability ? (
                  <StatusBadge tone={profileApplicabilityTone(applicability.applicability)} shape="soft">
                    {t(`runtimeConfig.profiles.applicability.${applicability.applicability}`, { defaultValue: applicability.applicability })}
                  </StatusBadge>
                ) : null}
              </div>
              {applicability?.reasons.length ? <p className="mt-1 font-mono text-xs text-[var(--nimi-text-muted)]">{applicability.reasons.join(' · ')}</p> : null}
              <Button size="sm" tone="ghost" className="mt-2" onClick={() => props.onOpenLoadouts(capabilityContract)}>
                {t('runtimeConfig.profiles.openLoadouts', { defaultValue: 'View capability plans' })}
              </Button>
            </div>
          );
        })}
      </div>
    </Surface>
  );
}

function profileApplicabilityTone(value: NimiRuntimeRecommendationApplicability): 'success' | 'warning' | 'danger' {
  if (value === 'supported') return 'success';
  if (value === 'unknown') return 'warning';
  return 'danger';
}

function profileAliasLabel(alias: string): string {
  return alias.split(/[-_.]+/u).filter(Boolean).map((part) => (
    part.charAt(0).toUpperCase() + part.slice(1)
  )).join(' ');
}
