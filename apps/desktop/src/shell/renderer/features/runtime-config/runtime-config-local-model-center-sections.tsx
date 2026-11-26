import { useDesktopI18nResource } from '../../i18n/i18n-context';
import type { RefObject } from 'react';

import { ActionMenu, Popover, PopoverContent, PopoverTrigger, Tooltip, cn, type NimiMenuItem } from '@nimiplatform/kit/ui';
import { Button } from './runtime-config-primitives';
import {
  DownloadIcon,
  FolderOpenIcon,
  RefreshIcon,
} from './runtime-config-local-model-center-helpers';
export { LocalModelCenterInProgressSection } from './runtime-config-local-model-center-progress-sections';

type ToolbarProps = {
  refreshing: boolean;
  importMenuRef: RefObject<HTMLDivElement | null>;
  showImportMenu: boolean;
  runtimeWritesDisabled: boolean;
  onRefresh: () => void;
  onOpenModelsFolder: () => void;
  onToggleImportMenu: () => void;
  onImportFile: () => Promise<unknown>;
  onImportDirectory: () => Promise<unknown>;
};

export function LocalModelCenterToolbar(props: ToolbarProps) {
  const i18n = useDesktopI18nResource().instance;
  const iconBtnClass = 'flex h-8 w-8 items-center justify-center rounded-lg text-[var(--nimi-text-muted)] hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)] hover:text-[var(--nimi-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)] enabled:active:scale-[var(--nimi-motion-pressed-scale)] disabled:opacity-50 transition-colors';
  const closeImportMenu = () => {
    if (props.showImportMenu) {
      props.onToggleImportMenu();
    }
  };
  const importMenuItems: NimiMenuItem[] = [
    {
      id: 'import-file',
      disabled: props.runtimeWritesDisabled,
      label: (
        <span className="block py-1">
          <span className="block text-xs font-medium text-[var(--nimi-text-primary)]">
            {i18n.t('runtimeConfig.localModelCenter.importModelFile', { defaultValue: 'Import Model File' })}
          </span>
          <span className="mt-0.5 block whitespace-normal text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.importModelFileDescription')}
          </span>
        </span>
      ),
      onSelect: () => {
        void props.onImportFile().catch(() => undefined);
      },
    },
    {
      id: 'import-directory',
      disabled: props.runtimeWritesDisabled,
      label: (
        <span className="block py-1">
          <span className="block text-xs font-medium text-[var(--nimi-text-primary)]">
            {i18n.t('runtimeConfig.localModelCenter.importModelDirectory', { defaultValue: 'Import Model Folder' })}
          </span>
          <span className="mt-0.5 block whitespace-normal text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.importModelDirectoryDescription')}
          </span>
        </span>
      ),
      onSelect: () => {
        void props.onImportDirectory().catch(() => undefined);
      },
    },
  ];

  return (
    <div className="ml-auto flex items-center justify-end gap-2">
      <div className="flex items-center gap-0.5">
        <Tooltip
          content={props.refreshing
            ? i18n.t('runtimeConfig.localModelCenter.refreshing', { defaultValue: 'Refreshing...' })
            : i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
          placement="top"
        >
          <button
            type="button"
            onClick={props.onRefresh}
            disabled={props.refreshing}
            aria-label={i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
            className={iconBtnClass}
          >
            <RefreshIcon className={cn('h-4 w-4', props.refreshing ? 'animate-spin motion-reduce:animate-none' : undefined)} />
          </button>
        </Tooltip>
        <Tooltip content={i18n.t('runtimeConfig.localModelCenter.openModelsFolder', { defaultValue: 'Open Folder' })} placement="top">
          <button
            type="button"
            onClick={props.onOpenModelsFolder}
            aria-label={i18n.t('runtimeConfig.localModelCenter.openModelsFolder', { defaultValue: 'Open Folder' })}
            className={iconBtnClass}
          >
            <FolderOpenIcon className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>
      <div className="h-5 w-px bg-[var(--nimi-border-subtle)]" aria-hidden="true" />
      <div className="relative" ref={props.importMenuRef}>
        <Popover
          open={props.showImportMenu}
          onOpenChange={(nextOpen) => {
            if (nextOpen !== props.showImportMenu) {
              props.onToggleImportMenu();
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              disabled={props.runtimeWritesDisabled}
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              {i18n.t('runtimeConfig.localModelCenter.import', { defaultValue: 'Import' })}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-60 p-1">
            <ActionMenu
              ariaLabel={i18n.t('runtimeConfig.localModelCenter.import', { defaultValue: 'Import' })}
              items={importMenuItems}
              onRequestClose={closeImportMenu}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
