import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { InlineAlert } from '@nimiplatform/kit/ui';
import type { AppSafetyDeclaration } from '@nimiplatform/sdk/runtime/wire-types';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-043c

/**
 * Publisher safety declaration display. The declaration is shown exactly as
 * declared for one version with its source: admitted through the Registry, or
 * carried by a local package the Registry never reviewed. Absence is shown as
 * "undeclared", never as an empty risk list, and nothing here derives a
 * safety verdict, an eligibility decision or an install gate.
 */
export type AppsSafetyDeclarationSource = 'registry' | 'local';

export interface AppsSafetyDeclarationFact {
  readonly label: string;
  readonly value: string;
}

function vocabulary(t: TFunction, value: string): string {
  return t(`Apps.safety.value.${value}`, { defaultValue: value });
}

function list(t: TFunction, values: readonly string[]): string {
  return values.length === 0 ? t('Apps.safety.none') : values.map((value) => vocabulary(t, value)).join(', ');
}

/** Flat, label-keyed facts; the diff compares two declarations by these labels. */
export function safetyDeclarationFacts(declaration: AppSafetyDeclaration, t: TFunction): readonly AppsSafetyDeclarationFact[] {
  const subjectNoticeApplies = declaration.aiRiskFeatures.some((feature) => feature === 'emotion-recognition' || feature === 'biometric-categorization');
  return [
    { label: t('Apps.safety.audience'), value: vocabulary(t, declaration.intendedAudience) },
    { label: t('Apps.safety.content'), value: declaration.contentDescriptors.length === 0 ? t('Apps.safety.contentNone') : list(t, declaration.contentDescriptors) },
    {
      label: t('Apps.safety.aiInteraction'),
      value: declaration.aiDirectInteraction
        ? `${t('Apps.safety.aiInteractionOn')} · ${t('Apps.safety.aiNotice')}: ${vocabulary(t, declaration.aiInteractionNotice)}`
        : t('Apps.safety.aiInteractionOff'),
    },
    { label: t('Apps.safety.riskFeatures'), value: list(t, declaration.aiRiskFeatures) },
    ...(subjectNoticeApplies ? [{ label: t('Apps.safety.subjectNotice'), value: vocabulary(t, declaration.aiSubjectNotice) }] : []),
    ...(declaration.aiOutputs.length === 0
      ? [{ label: t('Apps.safety.outputs'), value: t('Apps.safety.outputsNone') }]
      : declaration.aiOutputs.map((output) => ({
        label: t('Apps.safety.output', { modality: vocabulary(t, output.modality) }),
        value: [
          vocabulary(t, output.exposure),
          ...(output.exposure === 'publishable' ? [`${t('Apps.safety.publication')}: ${vocabulary(t, output.publicationControl)}`] : []),
          `${t('Apps.safety.inProductNotice')}: ${vocabulary(t, output.inProductNotice)}`,
          ...(output.exposure === 'in-app-only' ? [] : [`${t('Apps.safety.exportMarking')}: ${vocabulary(t, output.exportVisibleMarking)}`]),
          `${t('Apps.safety.machineMarking')}: ${vocabulary(t, output.machineReadableMarking)}`,
        ].join(' · '),
      }))),
    { label: t('Apps.safety.network'), value: t(declaration.publisherDirectExternalNetwork ? 'Apps.safety.networkOn' : 'Apps.safety.networkOff') },
    { label: t('Apps.safety.telemetry'), value: list(t, declaration.telemetry) },
    { label: t('Apps.safety.account'), value: vocabulary(t, declaration.thirdPartyAccount) },
    { label: t('Apps.safety.sharing'), value: vocabulary(t, declaration.userContentSharing) },
    { label: t('Apps.safety.commercial'), value: list(t, declaration.commercialFeatures) },
    { label: t('Apps.safety.sensitive'), value: list(t, declaration.sensitiveDataCategories) },
    { label: t('Apps.safety.highImpact'), value: list(t, declaration.highImpactDecisionUses) },
  ];
}

/** Short summary for an existing confirmation: audience, content, AI outputs and data facts only. */
export function safetyDeclarationSummaryFacts(declaration: AppSafetyDeclaration, t: TFunction): readonly AppsSafetyDeclarationFact[] {
  const dataFacts = [
    ...(declaration.publisherDirectExternalNetwork ? [t('Apps.safety.networkOnShort')] : []),
    ...declaration.telemetry.map((value) => vocabulary(t, value)),
    ...(declaration.thirdPartyAccount === 'none' ? [] : [`${t('Apps.safety.account')}: ${vocabulary(t, declaration.thirdPartyAccount)}`]),
    ...(declaration.userContentSharing === 'none' ? [] : [`${t('Apps.safety.sharing')}: ${vocabulary(t, declaration.userContentSharing)}`]),
    ...declaration.commercialFeatures.map((value) => vocabulary(t, value)),
    ...declaration.sensitiveDataCategories.map((value) => vocabulary(t, value)),
  ];
  return [
    { label: t('Apps.safety.audience'), value: vocabulary(t, declaration.intendedAudience) },
    { label: t('Apps.safety.content'), value: declaration.contentDescriptors.length === 0 ? t('Apps.safety.contentNone') : list(t, declaration.contentDescriptors) },
    {
      label: t('Apps.safety.outputs'),
      value: declaration.aiOutputs.length === 0
        ? t('Apps.safety.outputsNone')
        : declaration.aiOutputs.map((output) => `${vocabulary(t, output.modality)} (${vocabulary(t, output.exposure)})`).join(', '),
    },
    { label: t('Apps.safety.dataSummary'), value: dataFacts.length === 0 ? t('Apps.safety.dataSummaryNone') : dataFacts.join(', ') },
    ...(declaration.highImpactDecisionUses.length === 0 ? [] : [{ label: t('Apps.safety.highImpact'), value: list(t, declaration.highImpactDecisionUses) }]),
  ];
}

export interface AppsSafetyDeclarationChange {
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

/** Label-level changes between two declarations; an absent side reads as undeclared. */
export function safetyDeclarationChanges(
  before: AppSafetyDeclaration | null,
  after: AppSafetyDeclaration | null,
  t: TFunction,
): readonly AppsSafetyDeclarationChange[] {
  const left = new Map((before ? safetyDeclarationFacts(before, t) : []).map((fact) => [fact.label, fact.value]));
  const right = new Map((after ? safetyDeclarationFacts(after, t) : []).map((fact) => [fact.label, fact.value]));
  const changes: AppsSafetyDeclarationChange[] = [];
  for (const label of new Set([...left.keys(), ...right.keys()])) {
    const previous = left.get(label) ?? t('Apps.safety.undeclaredValue');
    const next = right.get(label) ?? t('Apps.safety.undeclaredValue');
    if (previous !== next) changes.push({ label, before: previous, after: next });
  }
  return changes;
}

function SourceLine({ declaration, source, version }: {
  readonly declaration: AppSafetyDeclaration | null;
  readonly source: AppsSafetyDeclarationSource;
  readonly version: string | null;
}): ReactElement {
  const { t } = useTranslation();
  if (!declaration) {
    return <p className="text-sm text-[var(--nimi-text-secondary)]">{t(source === 'local' ? 'Apps.safety.undeclaredLocal' : 'Apps.safety.undeclared')}</p>;
  }
  return <p className="text-xs text-[var(--nimi-text-muted)]">{t(source === 'local' ? 'Apps.safety.sourceLocal' : 'Apps.safety.sourceRegistry', { version: version ?? '' })}</p>;
}

/** The declaration of one exact version, or the fact that it could not be read yet. */
export type AppsSafetyDeclarationState =
  | { readonly status: 'loaded'; readonly declaration: AppSafetyDeclaration | null; readonly version: string | null }
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' };

/**
 * Picks the declaration that belongs to the shown version. An installed
 * release uses its own information snapshot; while that is loading, the
 * Catalog declaration substitutes only when the Catalog target is the same
 * release. A read failure stays a read failure rather than "undeclared".
 */
export function resolveSafetyDeclarationState(input: {
  readonly installedVersion: string | null;
  readonly installedInfo: { readonly version: string; readonly safetyDeclaration?: AppSafetyDeclaration } | null | undefined;
  readonly installedInfoError: string | null | undefined;
  readonly catalog: { readonly version: string; readonly safetyDeclaration?: AppSafetyDeclaration } | null;
}): AppsSafetyDeclarationState {
  if (!input.installedVersion) {
    return input.catalog ? { status: 'loaded', declaration: input.catalog.safetyDeclaration ?? null, version: input.catalog.version } : { status: 'unavailable' };
  }
  if (input.installedInfo) return { status: 'loaded', declaration: input.installedInfo.safetyDeclaration ?? null, version: input.installedInfo.version };
  if (input.installedInfoError) return { status: 'unavailable' };
  if (input.catalog && input.catalog.version === input.installedVersion) {
    return { status: 'loaded', declaration: input.catalog.safetyDeclaration ?? null, version: input.catalog.version };
  }
  return { status: 'loading' };
}

export function AppsSafetyDeclarationSection({ declaration, source, version, compact = false, state = 'loaded' }: {
  readonly declaration: AppSafetyDeclaration | null;
  readonly source: AppsSafetyDeclarationSource;
  readonly version: string | null;
  readonly compact?: boolean;
  readonly state?: AppsSafetyDeclarationState['status'];
}): ReactElement {
  const { t } = useTranslation();
  const facts = declaration && state === 'loaded' ? (compact ? safetyDeclarationSummaryFacts(declaration, t) : safetyDeclarationFacts(declaration, t)) : [];
  if (state !== 'loaded') {
    return (
      <section data-testid="apps-safety-declaration" data-declared="unknown" data-declaration-state={state} data-declaration-source={source} className="space-y-3">
        {compact ? <h3 className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.safety.sectionTitle')}</h3> : null}
        {state === 'loading'
          ? <p role="status" className="text-sm text-[var(--nimi-text-secondary)]">{t('Apps.info.loading')}</p>
          : <InlineAlert tone="warning" data-testid="apps-safety-declaration-unavailable">{t('Apps.info.unavailable')}</InlineAlert>}
      </section>
    );
  }
  return (
    <section data-testid="apps-safety-declaration" data-declared={declaration ? 'true' : 'false'} data-declaration-state="loaded" data-declaration-source={source} className="space-y-3">
      {compact ? <h3 className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.safety.sectionTitle')}</h3> : null}
      <SourceLine declaration={declaration} source={source} version={version} />
      {declaration ? (
        <dl className="grid gap-2 text-sm">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-[var(--nimi-text-muted)]">{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {declaration && !compact ? <p className="text-xs text-[var(--nimi-text-muted)]">{t('Apps.safety.notUniform')}</p> : null}
    </section>
  );
}

/** Compact block attached to an existing install or update confirmation. */
export function AppsSafetyDeclarationSummary({ declaration, source, version }: {
  readonly declaration: AppSafetyDeclaration | null;
  readonly source: AppsSafetyDeclarationSource;
  readonly version: string | null;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div data-testid="apps-safety-declaration-summary" data-declared={declaration ? 'true' : 'false'} className="space-y-2">
      <p className="text-sm font-medium">{t('Apps.safety.sectionTitle')}</p>
      <SourceLine declaration={declaration} source={source} version={version} />
      {declaration ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {safetyDeclarationSummaryFacts(declaration, t).map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-[var(--nimi-text-muted)]">{fact.label}</dt>
              <dd className="text-right">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** Actual declaration difference between an installed version and a pending update; adds no approval step. */
export function AppsSafetyDeclarationDiff({ before, after, afterVersion }: {
  readonly before: AppSafetyDeclaration | null;
  readonly after: AppSafetyDeclaration | null;
  readonly afterVersion: string | null;
}): ReactElement {
  const { t } = useTranslation();
  const changes = safetyDeclarationChanges(before, after, t);
  return (
    <div data-testid="apps-safety-declaration-diff" data-changes={changes.length} className="space-y-2">
      <p className="text-sm font-medium">{t('Apps.safety.diffTitle', { version: afterVersion ?? '' })}</p>
      {changes.length === 0 ? (
        <p className="text-xs text-[var(--nimi-text-muted)]">{t(!before && !after ? 'Apps.safety.diffUndeclaredBoth' : 'Apps.safety.diffNone')}</p>
      ) : (
        <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-[var(--nimi-text-muted)]">{t('Apps.safety.diffField')}</dt>
          <dd className="text-[var(--nimi-text-muted)]">{t('Apps.safety.diffBefore')}</dd>
          <dd className="text-[var(--nimi-text-muted)]">{t('Apps.safety.diffAfter')}</dd>
          {changes.map((change) => (
            <div key={change.label} className="contents">
              <dt>{change.label}</dt>
              <dd className="break-words">{change.before}</dd>
              <dd className="break-words">{change.after}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
