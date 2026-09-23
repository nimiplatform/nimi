import type { TFunction } from 'i18next';
import type { NimiMachineLoadouts, NimiRuntimeModelAssetRecord } from '@nimiplatform/sdk/runtime';
import { Button, OverlayShell, ScrollArea } from '@nimiplatform/kit/ui';

import { formatBytes } from '../../components/download-format.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { PackageIcon } from './runtime-config-local-model-center-helpers';
import { describeModelAssetPresentation } from './runtime-config-local-model-center-asset-presentation';

/** One Loadout that still binds the model being removed, in user terms. */
export type LocalModelAssetRemovalReference = {
  readonly loadoutId: string;
  readonly displayName: string;
  readonly capabilityContract: string;
  /** The Loadout is the current selection for its capability, so the model is live. */
  readonly active: boolean;
};

/** What removing a ModelAsset breaks, resolved for the confirmation dialog. */
export type LocalModelAssetRemovalImpact = {
  readonly references: readonly LocalModelAssetRemovalReference[];
  /** Referencing Loadout ids the aggregate could not describe (stale or unreadable). */
  readonly unresolvedCount: number;
};

export const EMPTY_MODEL_ASSET_REMOVAL_IMPACT: LocalModelAssetRemovalImpact = { references: [], unresolvedCount: 0 };

/**
 * Turns the runtime's referencing Loadout ids into names the user recognises.
 * Ids the aggregate does not know (or when the aggregate is unavailable) are
 * only counted: raw `loadout_*` ids are never something a user can act on.
 */
export function describeModelAssetRemovalImpact(
  referencingLoadoutIds: readonly string[],
  aggregate: NimiMachineLoadouts | null,
): LocalModelAssetRemovalImpact {
  const uniqueIds = [...new Set(referencingLoadoutIds)];
  if (!aggregate) return { references: [], unresolvedCount: uniqueIds.length };
  const activeLoadoutIds = new Set(aggregate.selections.map((selection) => selection.loadoutId));
  const references: LocalModelAssetRemovalReference[] = [];
  let unresolvedCount = 0;
  for (const loadoutId of uniqueIds) {
    const loadout = aggregate.loadouts.find((candidate) => candidate.loadoutId === loadoutId);
    if (!loadout) {
      unresolvedCount += 1;
      continue;
    }
    references.push({
      loadoutId,
      displayName: loadout.displayName.trim() || loadoutId,
      capabilityContract: loadout.capabilityContract,
      active: activeLoadoutIds.has(loadoutId),
    });
  }
  // Live setups first so the most consequential impact is read first.
  references.sort((left, right) => Number(right.active) - Number(left.active));
  return { references, unresolvedCount };
}

export type LocalModelAssetRemovalGroup = {
  readonly capabilityContract: string;
  readonly references: readonly LocalModelAssetRemovalReference[];
  readonly active: boolean;
};

/** Groups references by capability so eight Loadouts of one kind read as one line, not eight. */
export function groupModelAssetRemovalReferences(
  references: readonly LocalModelAssetRemovalReference[],
): LocalModelAssetRemovalGroup[] {
  const groups = new Map<string, LocalModelAssetRemovalReference[]>();
  for (const reference of references) {
    const bucket = groups.get(reference.capabilityContract) ?? [];
    bucket.push(reference);
    groups.set(reference.capabilityContract, bucket);
  }
  return [...groups.entries()]
    .map(([capabilityContract, members]) => ({
      capabilityContract,
      references: members,
      active: members.some((member) => member.active),
    }))
    .sort((left, right) => Number(right.active) - Number(left.active));
}

const MAX_VISIBLE_NAMES_PER_GROUP = 3;

function summarizeGroupNames(group: LocalModelAssetRemovalGroup, t: TFunction): string {
  const names = [...new Set(group.references.map((reference) => reference.displayName))];
  const visible = names.slice(0, MAX_VISIBLE_NAMES_PER_GROUP);
  const hidden = names.length - visible.length;
  const joined = visible.join(t('runtimeConfig.localModelCenter.removeModelNameSeparator', { defaultValue: ', ' }));
  return hidden > 0
    ? t('runtimeConfig.localModelCenter.removeModelMoreNames', { defaultValue: '{{names}} and {{count}} more', names: joined, count: hidden })
    : joined;
}

function AlertIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

function ShieldCheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export type RemoveModelAssetDialogBodyProps = {
  readonly asset: NimiRuntimeModelAssetRecord;
  readonly impact: LocalModelAssetRemovalImpact;
};

/** Dialog content, exported separately so it renders (and tests) without the overlay portal. */
export function RemoveModelAssetDialogBody({ asset, impact }: RemoveModelAssetDialogBodyProps) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  const presentation = describeModelAssetPresentation(asset);
  const groups = groupModelAssetRemovalReferences(impact.references);
  const referencedCount = impact.references.length + impact.unresolvedCount;
  const anyActive = impact.references.some((reference) => reference.active);

  return (
    <div className="space-y-4" data-testid="runtime-model-asset-remove-dialog">
      <div className="flex items-center gap-3 rounded-xl bg-[var(--nimi-surface-subtle)] px-3.5 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]" aria-hidden="true">
          <PackageIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{presentation.title}</span>
            {presentation.format ? (
              <span className="shrink-0 rounded-md bg-[var(--nimi-status-neutral-soft-bg)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] font-semibold tracking-wide text-[var(--nimi-status-neutral-soft-text)]">
                {presentation.format}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.localModelCenter.removeModelSize', { defaultValue: 'Model size: {{size}}', size: formatBytes(asset.totalSizeBytes) })}
          </p>
        </div>
      </div>

      <p className="text-sm text-[var(--nimi-text-secondary)]">
        {t('runtimeConfig.localModelCenter.confirmRemoveModelAsset', { defaultValue: 'Remove this model from the library? Files still used by other models or running tasks will be kept until those uses end.' })}
      </p>

      {referencedCount === 0 ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-[var(--nimi-status-success-soft-border)] bg-[var(--nimi-status-success-soft-bg)] px-3.5 py-3 text-sm text-[var(--nimi-status-success-soft-text)]" data-testid="runtime-model-asset-remove-safe">
          <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t('runtimeConfig.localModelCenter.removeModelNoReferences', { defaultValue: 'No setups use this model right now, so it is safe to remove.' })}</p>
        </div>
      ) : (
        <div className={`rounded-xl border px-3.5 py-3 ${anyActive
          ? 'border-[var(--nimi-status-danger-soft-border)] bg-[var(--nimi-status-danger-soft-bg)]'
          : 'border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)]'}`}
          data-testid="runtime-model-asset-remove-impact"
        >
          <div className={`flex items-start gap-2.5 text-sm ${anyActive ? 'text-[var(--nimi-status-danger-soft-text)]' : 'text-[var(--nimi-status-warning-soft-text)]'}`}>
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {t('runtimeConfig.localModelCenter.removeModelInUseHeading', { defaultValue: '{{count}} setups use this model', count: referencedCount })}
              </p>
              <p className="mt-0.5 text-xs opacity-90">
                {t('runtimeConfig.localModelCenter.removeModelInUseNote', { defaultValue: 'After removal they stop working.' })}
              </p>
            </div>
          </div>
          {groups.length > 0 ? (
            <ScrollArea className="mt-3 max-h-40" viewportClassName="pr-1">
              <ul className="space-y-1.5">
                {groups.map((group) => (
                  <li key={group.capabilityContract} className="flex items-start justify-between gap-3 rounded-lg bg-[var(--nimi-surface-card)] px-3 py-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-[var(--nimi-text-primary)]">
                          {displayRuntimeConfigCapabilityLabel(group.capabilityContract, t)}
                        </span>
                        {group.active ? (
                          <span className="rounded-full bg-[var(--nimi-status-danger)] px-1.5 py-px text-[length:var(--nimi-type-caption-size)] font-semibold text-white">
                            {t('runtimeConfig.localModelCenter.removeModelActiveBadge', { defaultValue: 'In use' })}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-[var(--nimi-text-muted)]" title={group.references.map((reference) => reference.displayName).join(', ')}>
                        {summarizeGroupNames(group, t)}
                      </p>
                    </div>
                    <span className="shrink-0 text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.localModelCenter.removeModelSetupCount', { defaultValue: '{{count}} setups', count: group.references.length })}
                    </span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          ) : null}
          {impact.unresolvedCount > 0 && groups.length > 0 ? (
            <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.localModelCenter.removeModelUnresolvedReferences', { defaultValue: '{{count}} more setups reference this model.', count: impact.unresolvedCount })}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export type RemoveModelAssetDialogProps = RemoveModelAssetDialogBodyProps & {
  readonly open: boolean;
  readonly removing: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
};

export function RemoveModelAssetDialog(props: RemoveModelAssetDialogProps) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  return (
    <OverlayShell
      open={props.open}
      kind="dialog"
      onClose={props.removing ? undefined : props.onClose}
      closeOnBackdrop={!props.removing}
      title={t('runtimeConfig.localModelCenter.removeModelTitle', { defaultValue: 'Remove model?' })}
      data-testid="runtime-model-asset-remove-overlay"
      footer={(
        <div className="flex gap-3">
          <div className="flex-1">
            <Button tone="secondary" fullWidth onClick={props.onClose} disabled={props.removing}>
              {t('Common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
          <div className="flex-1">
            <Button tone="danger" fullWidth onClick={props.onConfirm} loading={props.removing} data-testid="runtime-model-asset-remove-confirm">
              {props.removing
                ? t('runtimeConfig.localModelCenter.removeModelRemoving', { defaultValue: 'Removing…' })
                : t('runtimeConfig.localModelCenter.removeModelConfirm', { defaultValue: 'Remove model' })}
            </Button>
          </div>
        </div>
      )}
    >
      <RemoveModelAssetDialogBody asset={props.asset} impact={props.impact} />
    </OverlayShell>
  );
}
