import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { Button, InlineAlert, LoadingSkeleton, Surface } from '@nimiplatform/kit/ui';
import { Check, CheckCircle2, Lock, X } from 'lucide-react';
import {
  useDesktopRendererCommands,
  useDesktopRendererSdk,
} from '../../renderer/binding-context.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { capabilityIcon, capabilityModelIdentity } from './runtime-capability-presentation.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { downloadRuntimeConfigProfileArtifact } from './runtime-config-profile-presentation.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import { exportRuntimeConfigAIProfileFromLoadouts } from './runtime-config-ai-profile-transfer.js';
import {
  buildRuntimeConfigShareInventory,
  defaultRuntimeConfigShareChoice,
  includedRuntimeConfigShareLoadouts,
  resolveRuntimeConfigShareChoices,
  runtimeConfigShareFileName,
  type RuntimeConfigShareBlockReason,
  type RuntimeConfigShareChoices,
  type RuntimeConfigShareInventory,
  type RuntimeConfigShareUse,
} from './runtime-config-profile-share-model.js';
import type { RuntimeConfigLoadoutNavigationContext } from './runtime-config-panel-types.js';

type Translate = (key: string, options?: Record<string, unknown>) => string;

type ShareExportFailure = { readonly detail: string };

type ShareExportDone = {
  readonly title: string;
  readonly fileName: string;
  readonly included: readonly { readonly capabilityContract: string; readonly model: string }[];
};

/**
 * The person's decisions survive a repair detour: the panel unmounts when
 * they leave for a saved setup and reloads on return, and the draft keeps
 * the title and the per-use include/exclude choices across that trip.
 */
let shareDraft: { title: string; choices: RuntimeConfigShareChoices } = { title: '', choices: {} };

export function ProfileExportPanel(props: {
  readonly onOpenSavedConfigs?: (context: RuntimeConfigLoadoutNavigationContext) => void;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const loadoutsClient = useMemo(() => sdk.machineProduct().local.loadouts, [sdk]);
  const modelAssetsClient = useRuntimeConfigLocalEnvironmentClient();

  const [inventory, setInventory] = useState<RuntimeConfigShareInventory | null>(null);
  const [assets, setAssets] = useState<readonly NimiRuntimeModelAssetRecord[]>([]);
  const [recipes, setRecipes] = useState<readonly NimiLoadoutRecipe[]>([]);
  const [choices, setChoices] = useState<RuntimeConfigShareChoices>(shareDraft.choices);
  const [title, setTitle] = useState(shareDraft.title);
  const [expandedUse, setExpandedUse] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [exportFailure, setExportFailure] = useState<ShareExportFailure | null>(null);
  const [done, setDone] = useState<ShareExportDone | null>(null);
  const [repairedUses, setRepairedUses] = useState<readonly string[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);
  const previousShareable = useRef<ReadonlySet<string> | null>(null);

  useEffect(() => {
    shareDraft = { title, choices };
  }, [title, choices]);

  const reload = useCallback(async () => {
    setLoadError('');
    try {
      const [machine, assetList, recipeList] = await Promise.all([
        loadoutsClient.get(),
        modelAssetsClient.listModelAssets(),
        loadoutsClient.listRecipes(),
      ]);
      const next = buildRuntimeConfigShareInventory({ loadouts: machine.loadouts, selections: machine.selections, assets: assetList });
      const nowShareable = new Set(next.shareable.map((use) => use.capabilityContract));
      const before = previousShareable.current;
      // A use that became shareable since the last read (a repair, typically)
      // joins the file with its default and is announced; nothing else moves.
      setRepairedUses(before ? [...nowShareable].filter((id) => !before.has(id)) : []);
      previousShareable.current = nowShareable;
      setAssets(assetList);
      setRecipes(recipeList);
      setInventory(next);
      setChoices((current) => resolveRuntimeConfigShareChoices(next, current));
    } catch (error) {
      // A read failure is not an empty inventory: keep whatever was shown and
      // say so, so "nothing to share" only appears when nothing is configured.
      setLoadError(exportErrorMessage(error));
    }
  }, [loadoutsClient, modelAssetsClient]);

  useEffect(() => {
    let active = true;
    void reload().then(() => { if (!active) previousShareable.current = null; });
    const onFocus = () => { void reload(); };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [reload, retryNonce]);

  const included = useMemo(
    () => (inventory ? includedRuntimeConfigShareLoadouts(inventory, choices) : []),
    [inventory, choices],
  );
  const modelName = useCallback(
    (loadout: NimiMachineLoadout) => capabilityModelIdentity(loadout, recipes).shortTitle || loadout.displayName,
    [recipes],
  );
  const useLabel = useCallback((id: string) => displayRuntimeConfigCapabilityLabel(id, t), [t]);

  const exportNow = () => {
    if (!inventory || included.length === 0) return;
    const resolvedTitle = title.trim() || t('runtimeConfig.profiles.exportedTitle', { defaultValue: 'Shared Loadouts' });
    try {
      // Same export the probe ran, against the asset list the inventory was
      // built from, so "shareable" on screen and "exports" here agree.
      const artifact = exportRuntimeConfigAIProfileFromLoadouts({
        profileId: `profile.loadouts.${Date.now()}`,
        title: resolvedTitle,
        loadouts: included,
        assets,
      });
      const fileName = runtimeConfigShareFileName(artifact.profile.profileId);
      downloadRuntimeConfigProfileArtifact(artifact.artifactJson, fileName);
      setExportFailure(null);
      setDone({
        title: resolvedTitle,
        fileName,
        included: included.map((loadout) => ({ capabilityContract: loadout.capabilityContract, model: modelName(loadout) })),
      });
    } catch (error) {
      setExportFailure({ detail: exportErrorMessage(error) });
      // A setup that stopped exporting since the last read moves back to
      // "not shareable yet" on this reload; the person's choices stay.
      void reload();
    }
  };

  const openRepair = (loadout: NimiMachineLoadout) => {
    const context = { capabilityContract: loadout.capabilityContract, recipeId: loadout.recipeId, recipeRevision: loadout.recipeRevision };
    if (props.onOpenSavedConfigs) {
      props.onOpenSavedConfigs(context);
      return;
    }
    setActiveTab('runtime');
    runtimeConfigNavigation.focusAction({
      page: 'aiSettings',
      action: 'open-saved-configs',
      focus: 'runtime-config-action-focus.saved-configs',
    });
  };

  if (done) {
    return (
      <ShareDonePanel
        done={done}
        useLabel={useLabel}
        t={t}
        onExportAgain={() => setDone(null)}
      />
    );
  }

  const loading = inventory === null && !loadError;
  const shareableCount = inventory?.shareable.length ?? 0;
  const blockedCount = inventory?.blocked.length ?? 0;

  return (
    <div className="space-y-5" data-testid="runtime-portable-profile-loadout-export">
      <header className="max-w-2xl space-y-2">
        <h2 className="text-xl font-semibold tracking-tight text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.profiles.share.title', { defaultValue: 'Share my model setup' })}
        </h2>
        <p className="text-sm leading-relaxed text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.profiles.share.lead', { defaultValue: 'Create a setup file to send to a colleague or another computer. It only says which model each use runs; the model files themselves are not included.' })}
        </p>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-1 text-xs text-[var(--nimi-text-secondary)]">
          <Lock size={13} strokeWidth={2} aria-hidden="true" className="text-[var(--nimi-status-success)]" />
          {t('runtimeConfig.profiles.share.privacyPill', { defaultValue: 'Never includes local paths, account details, or secrets' })}
        </span>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {loadError ? (
            <InlineAlert tone="danger">
              <p className="font-semibold">{t('runtimeConfig.profiles.exportInventoryLoadFailed', { defaultValue: 'Your current model setup could not be loaded.' })}</p>
              <p className="mt-1 text-xs">{t('runtimeConfig.profiles.share.loadFailedBody', { defaultValue: 'This does not mean there is nothing to share. Try again; if it keeps failing, send us the technical details.' })}</p>
              <Button size="sm" className="mt-2" onClick={() => setRetryNonce((current) => current + 1)}>
                {t('Common.retry', { defaultValue: 'Retry' })}
              </Button>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer font-semibold">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
                <p className="mt-2 break-all font-mono">{loadError}</p>
              </details>
            </InlineAlert>
          ) : null}

          {repairedUses.length > 0 ? (
            <InlineAlert tone="success" data-testid="runtime-profile-share-repaired">
              {t('runtimeConfig.profiles.share.repairedBanner', {
                defaultValue: '{{uses}} can be shared now and joined the list. Your earlier choices and title are unchanged.',
                uses: repairedUses.map(useLabel).join('、'),
              })}
            </InlineAlert>
          ) : null}

          {loading ? <LoadingSkeleton className="h-24 w-full" label={t('Common.loading', { defaultValue: 'Loading…' })} /> : null}

          {inventory && shareableCount === 0 && !loadError ? (
            <Surface tone="card" className="flex flex-col items-center gap-2 p-6 text-center">
              <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                {t('runtimeConfig.profiles.share.emptyTitle', { defaultValue: 'Nothing can be shared yet' })}
              </p>
              <p className="max-w-sm text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
                {t('runtimeConfig.profiles.share.emptyBody', { defaultValue: 'Choose a model for a use in AI Capabilities, or repair one of the setups listed below, and it will appear here.' })}
              </p>
            </Surface>
          ) : null}

          {inventory && shareableCount > 0 ? (
            <Surface tone="card" className="overflow-hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 pb-2">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                    {t('runtimeConfig.profiles.share.includedTitle', { defaultValue: 'Uses that will be shared' })}
                  </h3>
                  <span className="text-xs text-[var(--nimi-text-muted)]">
                    {t('runtimeConfig.profiles.share.useCount', { defaultValue: '{{count}} use(s)', count: shareableCount })}
                  </span>
                </div>
                <span className="text-xs text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.profiles.share.includedHint', { defaultValue: 'The setup in use is included by default' })}
                </span>
              </div>
              {groupUses(inventory.shareable).map(({ group, uses }) => (
                <div key={group}>
                  <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                    {t(`runtimeConfig.capabilities.group.${group}`)}
                  </div>
                  {uses.map((use) => (
                    <ShareableUseRow
                      key={use.capabilityContract}
                      use={use}
                      choice={choices[use.capabilityContract] ?? null}
                      expanded={expandedUse === use.capabilityContract}
                      modelName={modelName}
                      useLabel={useLabel}
                      t={t}
                      onToggleExpanded={() => setExpandedUse((current) => (current === use.capabilityContract ? null : use.capabilityContract))}
                      onChange={(loadoutId) => setChoices((current) => ({ ...current, [use.capabilityContract]: loadoutId }))}
                    />
                  ))}
                </div>
              ))}
            </Surface>
          ) : null}

          {inventory && blockedCount > 0 ? (
            <Surface tone="card" className="overflow-hidden" data-testid="runtime-profile-share-blocked">
              <div className="space-y-1 px-4 pt-4 pb-2">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                    {t('runtimeConfig.profiles.share.blockedTitle', { defaultValue: 'Not shareable yet' })}
                  </h3>
                  <span className="text-xs text-[var(--nimi-text-muted)]">
                    {t('runtimeConfig.profiles.share.useCount', { defaultValue: '{{count}} use(s)', count: blockedCount })}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.profiles.share.blockedHint', { defaultValue: 'Come back after repairing: the list refreshes on its own and your ticked uses stay as they are.' })}
                </p>
              </div>
              {inventory.blocked.map((use) => {
                const candidate = use.candidates[0]!;
                const Icon = capabilityIcon(use.capabilityContract);
                return (
                  <div key={use.capabilityContract} className="flex items-center gap-3 border-t border-[var(--nimi-border-subtle)] px-4 py-3">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]">
                      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                        {useLabel(use.capabilityContract)}
                        <span className="font-normal text-[var(--nimi-text-muted)]"> · {modelName(candidate.loadout)}</span>
                      </div>
                      <BlockReason reason={candidate.block!} t={t} />
                    </div>
                    <Button size="sm" tone="secondary" onClick={() => openRepair(candidate.loadout)}>
                      {t('runtimeConfig.profiles.share.fixThis', { defaultValue: 'Repair this one' })}
                    </Button>
                  </div>
                );
              })}
            </Surface>
          ) : null}

          {inventory ? (
            <p className="px-1 text-xs leading-relaxed text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.profiles.share.notConfiguredNote', { defaultValue: 'Uses without a chosen model are not in the file. To share them, pick a model in AI Capabilities first.' })}
            </p>
          ) : null}
        </div>

        <Surface tone="card" className="space-y-4 p-4 lg:sticky lg:top-4" data-testid="runtime-profile-share-summary">
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-[var(--nimi-text-primary)]" htmlFor="runtime-profile-export-name">
              {t('runtimeConfig.profiles.share.titleLabel', { defaultValue: 'Setup title' })}
            </label>
            <input
              id="runtime-profile-export-name"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder={t('runtimeConfig.profiles.exportNamePlaceholder', { defaultValue: 'e.g. My workstation setup' })}
              className="w-full rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-3 py-2 text-sm text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]"
            />
            <p className="text-xs leading-relaxed text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.profiles.share.titleHelp', { defaultValue: 'Written inside the file; the recipient sees it when importing. The file name is generated by Nimi.' })}
            </p>
          </div>

          <div className="h-px bg-[var(--nimi-border-subtle)]" />

          <div className="space-y-2">
            <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.profiles.share.includesTitle', { defaultValue: 'The file will contain' })}
            </p>
            {included.length === 0 ? (
              <p className="text-xs text-[var(--nimi-text-muted)]">
                {t('runtimeConfig.profiles.share.includesNone', { defaultValue: 'No use is ticked yet.' })}
              </p>
            ) : included.map((loadout) => (
              <SummaryLine key={loadout.loadoutId} included>
                {useLabel(loadout.capabilityContract)} → <strong className="font-semibold text-[var(--nimi-text-primary)]">{modelName(loadout)}</strong>
              </SummaryLine>
            ))}
            <SummaryLine included>
              {t('runtimeConfig.profiles.share.includesModels', { defaultValue: 'Model name, version, and checksum for each use' })}
            </SummaryLine>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.profiles.share.excludesTitle', { defaultValue: 'The file will not contain' })}
            </p>
            <SummaryLine>
              {t('runtimeConfig.profiles.share.excludesModelFiles', { defaultValue: 'The model files themselves; the recipient downloads them' })}
            </SummaryLine>
            <SummaryLine>
              {t('runtimeConfig.profiles.share.excludesSecrets', { defaultValue: 'Local paths, account details, secrets' })}
            </SummaryLine>
          </div>

          <div className="space-y-1 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] px-3 py-2.5">
            <p className="text-xs font-semibold text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.profiles.share.recipientTitle', { defaultValue: 'What the recipient does' })}
            </p>
            <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.profiles.share.recipientBody', { defaultValue: 'Importing saves it to their library. Nothing downloads and nothing they use changes until they choose Use, when Nimi checks their computer and fetches missing models.' })}
            </p>
          </div>

          <div className="space-y-1.5">
            <Button
              tone="primary"
              className="w-full"
              disabled={included.length === 0}
              onClick={exportNow}
              data-testid="runtime-profile-share-export"
            >
              {t('runtimeConfig.profiles.share.exportAction', { defaultValue: 'Export setup file' })}
            </Button>
            <p className="text-center text-xs text-[var(--nimi-text-muted)]">
              {included.length === 0
                ? t('runtimeConfig.profiles.share.exportNeedsOne', { defaultValue: 'At least one shareable use is needed' })
                : t('runtimeConfig.profiles.share.exportHint', { defaultValue: 'Downloads one .ai-profile.json file' })}
            </p>
          </div>

          {exportFailure ? (
            <InlineAlert tone="danger" data-testid="runtime-profile-share-export-failed">
              <p className="font-semibold">{t('runtimeConfig.profiles.exportFailed', { defaultValue: 'The selected Loadouts could not be exported.' })}</p>
              <p className="mt-1 text-xs">{t('runtimeConfig.profiles.share.exportFailedBody', { defaultValue: 'Your choices and title are still here; try again. A setup whose model files were just removed moves back to “Not shareable yet”.' })}</p>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer font-semibold">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[length:var(--nimi-type-caption-size)]">{exportFailure.detail}</pre>
              </details>
            </InlineAlert>
          ) : null}

          {included.length > 0 ? (
            <details className="text-xs text-[var(--nimi-text-muted)]">
              <summary className="cursor-pointer">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
              <div className="mt-2 space-y-1 font-mono">
                {included.map((loadout) => (
                  <div key={loadout.loadoutId}>{loadout.capabilityContract} · {loadout.recipeId}</div>
                ))}
              </div>
            </details>
          ) : null}
        </Surface>
      </div>
    </div>
  );
}

function ShareableUseRow(props: {
  readonly use: RuntimeConfigShareUse;
  readonly choice: string | null;
  readonly expanded: boolean;
  readonly modelName: (loadout: NimiMachineLoadout) => string;
  readonly useLabel: (id: string) => string;
  readonly t: Translate;
  readonly onToggleExpanded: () => void;
  readonly onChange: (loadoutId: string | null) => void;
}) {
  const { use, choice, t } = props;
  const Icon = capabilityIcon(use.capabilityContract);
  const chosen = use.exportable.find((candidate) => candidate.loadout.loadoutId === choice) ?? null;
  const canChange = use.exportable.length > 1;
  const inputId = `runtime-profile-share-${use.capabilityContract}`;
  return (
    <div className="border-t border-[var(--nimi-border-subtle)]" data-testid={`runtime-profile-share-use-${use.capabilityContract}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <input
          id={inputId}
          type="checkbox"
          className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--nimi-action-primary-bg)]"
          checked={chosen !== null}
          aria-label={t('runtimeConfig.profiles.share.includeUse', { defaultValue: 'Include {{use}}', use: props.useLabel(use.capabilityContract) })}
          onChange={(event) => props.onChange(event.currentTarget.checked ? defaultRuntimeConfigShareChoice(use) : null)}
        />
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info)]">
          <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer">
          <span className="block text-sm font-semibold text-[var(--nimi-text-primary)]">{props.useLabel(use.capabilityContract)}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
            {chosen ? (
              <>
                {chosen.current ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--nimi-status-success)]" aria-hidden="true" /> : null}
                {props.modelName(chosen.loadout)}
                {chosen.current ? ` · ${t('runtimeConfig.profiles.share.currentInUse', { defaultValue: 'in use' })}` : ''}
              </>
            ) : t('runtimeConfig.profiles.share.leftOut', { defaultValue: 'Left out of the file' })}
          </span>
        </label>
        {canChange ? (
          <Button size="sm" tone="ghost" aria-expanded={props.expanded} onClick={props.onToggleExpanded}>
            {props.expanded
              ? t('runtimeConfig.profiles.share.collapseAction', { defaultValue: 'Done' })
              : t('runtimeConfig.profiles.share.changeAction', { defaultValue: 'Change' })}
          </Button>
        ) : null}
      </div>
      {canChange && props.expanded ? (
        <fieldset className="m-0 border-0 px-4 pb-4 pl-[4.5rem]">
          <legend className="pb-2 text-xs text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.share.chooseHint', { defaultValue: 'This use has {{count}} different setups; pick the one to write into the file', count: use.exportable.length })}
          </legend>
          <div className="space-y-2">
            {use.exportable.map((candidate) => {
              const selected = candidate.loadout.loadoutId === choice;
              return (
                <label
                  key={candidate.loadout.loadoutId}
                  className={`flex cursor-pointer items-center gap-3 rounded-[var(--nimi-radius-md)] border px-3 py-2.5 ${selected ? 'border-[var(--nimi-action-primary-bg)]' : 'border-[var(--nimi-border-subtle)]'}`}
                >
                  <input
                    type="radio"
                    name={inputId}
                    className="h-4 w-4 accent-[var(--nimi-action-primary-bg)]"
                    checked={selected}
                    onChange={() => props.onChange(candidate.loadout.loadoutId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold text-[var(--nimi-text-primary)]">
                      {props.modelName(candidate.loadout)}
                      {candidate.current ? (
                        <span className="rounded-full bg-[var(--nimi-status-success-soft-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--nimi-status-success)]">
                          {t('runtimeConfig.profiles.share.currentInUse', { defaultValue: 'in use' })}
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-xs text-[var(--nimi-text-muted)]">{candidate.loadout.displayName}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}

function BlockReason(props: { readonly reason: RuntimeConfigShareBlockReason; readonly t: Translate }) {
  const { reason, t } = props;
  const danger = reason.kind !== 'unresolved';
  const text = reason.kind === 'unresolved'
    ? t('runtimeConfig.profiles.share.reasonUnresolved', { defaultValue: 'Setup is not finished' })
    : reason.kind === 'blocked'
      ? t('runtimeConfig.profiles.share.reasonBlocked', { defaultValue: 'Setup is blocked on this computer' })
      : t('runtimeConfig.profiles.share.reasonAssets', { defaultValue: 'No verified model file was found; exporting would fail' });
  return (
    <div className={`mt-0.5 flex items-center gap-1.5 text-xs ${danger ? 'text-[var(--nimi-status-danger)]' : 'text-[var(--nimi-status-warning)]'}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${danger ? 'bg-[var(--nimi-status-danger)]' : 'bg-[var(--nimi-status-warning)]'}`} aria-hidden="true" />
      <span>{text}</span>
      {reason.detail ? (
        <details className="inline text-[var(--nimi-text-muted)]">
          <summary className="inline cursor-pointer">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
          <span className="ml-1 break-all font-mono">{reason.detail}</span>
        </details>
      ) : null}
    </div>
  );
}

function SummaryLine(props: { readonly included?: boolean; readonly children: ReactNode }) {
  return (
    <div className={`flex items-start gap-2 text-xs leading-relaxed ${props.included ? 'text-[var(--nimi-text-secondary)]' : 'text-[var(--nimi-text-muted)]'}`}>
      {props.included
        ? <Check size={14} strokeWidth={2.4} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--nimi-status-success)]" />
        : <X size={14} strokeWidth={2.4} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--nimi-text-muted)]" />}
      <span>{props.children}</span>
    </div>
  );
}

function ShareDonePanel(props: {
  readonly done: ShareExportDone;
  readonly useLabel: (id: string) => string;
  readonly t: Translate;
  readonly onExportAgain: () => void;
}) {
  const { done, t } = props;
  const models = done.included.map((item) => item.model).join('、');
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-4" data-testid="runtime-profile-share-done">
      <div className="flex flex-col items-center gap-2 text-center">
        <CheckCircle2 size={40} strokeWidth={1.6} aria-hidden="true" className="text-[var(--nimi-status-success)]" />
        <h2 className="text-xl font-semibold tracking-tight text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.profiles.share.doneTitle', { defaultValue: 'Setup file exported' })}
        </h2>
        <p className="text-sm leading-relaxed text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.profiles.share.doneLead', { defaultValue: 'Nimi handed the file to your system to save. Send it to a colleague or copy it to another computer and import it there.' })}
        </p>
      </div>

      <Surface tone="card" className="w-full overflow-hidden">
        <div className="space-y-1 px-4 py-4">
          <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {done.title}
            <span className="ml-1 text-xs font-normal text-[var(--nimi-text-muted)]">
              · {t('runtimeConfig.profiles.share.doneTitleTag', { defaultValue: 'title, written inside the file' })}
            </span>
          </p>
          <p className="text-xs text-[var(--nimi-text-muted)]">
            <span className="font-mono">{done.fileName}</span>
            {' · '}
            {t('runtimeConfig.profiles.share.doneFileNameTag', { defaultValue: 'file name generated by Nimi' })}
          </p>
        </div>
        <div className="space-y-2 border-t border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-3">
          <p className="text-xs font-semibold text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.share.doneIncludes', { defaultValue: 'Contains {{count}} use(s)', count: done.included.length })}
          </p>
          {done.included.map((item) => (
            <p key={item.capabilityContract} className="text-sm text-[var(--nimi-text-primary)]">
              {props.useLabel(item.capabilityContract)} → <strong className="font-semibold">{item.model}</strong>
            </p>
          ))}
          <p className="text-xs leading-relaxed text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.profiles.share.doneNoModelFiles', { defaultValue: 'Only the setup is included, not the model files for {{models}}. If they are missing on the other computer, Nimi offers the download when that setup is used.', models })}
          </p>
        </div>
      </Surface>

      <div className="w-full space-y-2">
        <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.profiles.share.nextTitle', { defaultValue: 'What the recipient does next' })}
        </p>
        <ol className="grid gap-2 md:grid-cols-2">
          {(['next1', 'next2', 'next3', 'next4'] as const).map((key, index) => (
            <li key={key} className="flex gap-3 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] text-[11px] font-semibold text-[var(--nimi-action-primary-text)]">{index + 1}</span>
              <span className="text-xs leading-relaxed text-[var(--nimi-text-primary)]">
                {t(`runtimeConfig.profiles.share.${key}`, { defaultValue: NEXT_STEP_DEFAULTS[key], title: done.title, models })}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <Button tone="secondary" onClick={props.onExportAgain} data-testid="runtime-profile-share-export-again">
        {t('runtimeConfig.profiles.share.exportAgain', { defaultValue: 'Export another' })}
      </Button>
    </div>
  );
}

const NEXT_STEP_DEFAULTS = {
  next1: 'Choose “Import setup file” in Nimi. This only saves the setup to their library; nothing downloads and nothing in use changes.',
  next2: 'Find “{{title}}” in the library and choose Use.',
  next3: 'Nimi checks that computer and, if {{models}} is missing, shows the download size and waits for their confirmation.',
  next4: 'Once prepared, they confirm once more and the use switches to this setup.',
} as const;

function groupUses(uses: readonly RuntimeConfigShareUse[]): readonly { group: RuntimeConfigShareUse['group']; uses: readonly RuntimeConfigShareUse[] }[] {
  const groups = new Map<RuntimeConfigShareUse['group'], RuntimeConfigShareUse[]>();
  for (const use of uses) groups.set(use.group, [...(groups.get(use.group) ?? []), use]);
  return [...groups.entries()].map(([group, items]) => ({ group, uses: items }));
}

function exportErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : String(error || 'Unknown profile error');
}
