import { useDesktopI18nResource } from '../../i18n/i18n-context';
import type { RefObject } from 'react';

import { cn } from '@nimiplatform/kit/ui';
import { Button } from './runtime-config-primitives';
import {
  DownloadIcon,
  FolderOpenIcon,
  RefreshIcon,
} from './runtime-config-local-model-center-helpers';
export {
  LocalModelCenterInProgressSection,
  LocalModelCenterQuickPicksSection,
  LocalModelCenterVerifiedAssetsSection,
} from './runtime-config-local-model-center-catalog-sections';

type ToolbarProps = {
  refreshing: boolean;
  importMenuRef: RefObject<HTMLDivElement | null>;
  showImportMenu: boolean;
  runtimeWritesDisabled: boolean;
  showCatalogOverridesAction: boolean;
  onRefresh: () => void;
  onOpenModelsFolder: () => void;
  onOpenCatalogOverrides: () => void;
  onToggleImportMenu: () => void;
  onImportFile: () => Promise<unknown>;
  onImportDirectory: () => Promise<unknown>;
};

export function LocalModelCenterToolbar(props: ToolbarProps) {
  const i18n = useDesktopI18nResource().instance;
  const iconBtnClass = 'flex h-8 w-8 items-center justify-center rounded-lg text-[var(--nimi-text-muted)] hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)] hover:text-[var(--nimi-text-secondary)] disabled:opacity-50 transition-colors';

  return (
    <div className="flex items-center justify-end gap-2">
      {props.showCatalogOverridesAction ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={props.onOpenCatalogOverrides}
          disabled={props.runtimeWritesDisabled}
        >
          {i18n.t('runtimeConfig.catalogOverrides.manage', { defaultValue: 'Manage custom models' })}
        </Button>
      ) : null}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.refreshing}
          title={props.refreshing
            ? i18n.t('runtimeConfig.localModelCenter.refreshing', { defaultValue: 'Refreshing...' })
            : i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
          aria-label={i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
          className={iconBtnClass}
        >
          <RefreshIcon className={cn('h-4 w-4', props.refreshing ? 'animate-spin' : undefined)} />
        </button>
        <button
          type="button"
          onClick={props.onOpenModelsFolder}
          title={i18n.t('runtimeConfig.localModelCenter.openModelsFolder', { defaultValue: 'Open Folder' })}
          aria-label={i18n.t('runtimeConfig.localModelCenter.openModelsFolder', { defaultValue: 'Open Folder' })}
          className={iconBtnClass}
        >
          <FolderOpenIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="h-5 w-px bg-[var(--nimi-border-subtle)]" aria-hidden="true" />
      <div className="relative" ref={props.importMenuRef}>
        <Button
          size="sm"
          variant="secondary"
          onClick={props.onToggleImportMenu}
          disabled={props.runtimeWritesDisabled}
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          {i18n.t('runtimeConfig.localModelCenter.import', { defaultValue: 'Import' })}
        </Button>
          {props.showImportMenu ? (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] shadow-[var(--nimi-elevation-floating)]">
              <button type="button" disabled={props.runtimeWritesDisabled} onClick={() => { void props.onImportFile().catch(() => undefined); }} className="w-full px-3 py-2.5 text-left text-xs transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)] disabled:opacity-50">
                <div className="font-medium text-[var(--nimi-text-primary)]">
                  {i18n.t('runtimeConfig.localModelCenter.importModelFile', { defaultValue: 'Import Model File' })}
                </div>
                <div className="mt-0.5 text-[var(--nimi-text-muted)]">
                  {i18n.t('runtimeConfig.localModelCenter.importModelFileDescription', { defaultValue: 'Import model content without choosing a type or engine.' })}
                </div>
              </button>
              <button type="button" disabled={props.runtimeWritesDisabled} onClick={() => { void props.onImportDirectory().catch(() => undefined); }} className="w-full border-t border-[var(--nimi-border-subtle)] px-3 py-2.5 text-left text-xs transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)] disabled:opacity-50">
                <div className="font-medium text-[var(--nimi-text-primary)]">
                  {i18n.t('runtimeConfig.localModelCenter.importModelDirectory', { defaultValue: 'Import Model Directory' })}
                </div>
                <div className="mt-0.5 text-[var(--nimi-text-muted)]">
                  {i18n.t('runtimeConfig.localModelCenter.importModelDirectoryDescription', { defaultValue: 'Import the model files in a directory as a whole.' })}
                </div>
              </button>
            </div>
          ) : null}
      </div>
    </div>
  );
}
