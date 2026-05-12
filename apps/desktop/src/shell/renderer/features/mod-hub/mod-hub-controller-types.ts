import type { StatusBanner } from '@renderer/app-shell/providers/app-store';
import type { ModHubMod, ModHubPendingActionType, ModHubSection } from './mod-hub-model';

export type ModHubPendingAction = {
  modId: string;
  action: ModHubPendingActionType;
} | null;

export type ModHubPageModel = {
  loading: boolean;
  searchQuery: string;
  filteredMods: ModHubMod[];
  dockMods: ModHubMod[];
  managementSections: ModHubSection[];
  pendingAction: ModHubPendingAction;
  selectedModId: string | null;
  installedModsDir: string;
  visibleModCount: number;
  installedModsCount: number;
  isSearchFocused: boolean;
  feedback: StatusBanner | null;
  issueSummary: {
    failureCount: number;
    fusedCount: number;
    message: string;
  } | null;
  dismissFeedback: () => void;
  onSearchQueryChange: (value: string) => void;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
  onActivateDockMod: (modId: string) => void;
  onOpenMod: (modId: string) => void;
  onInstallMod: (modId: string) => void;
  onUpdateMod: (modId: string) => void;
  onUninstallMod: (modId: string) => void;
  onEnableMod: (modId: string) => void;
  onDisableMod: (modId: string) => void;
  onRetryMod: (modId: string) => void;
  onOpenModFolder: (modId: string) => void;
  onOpenModSettings: (modId: string) => void;
  onOpenModsFolder: () => void;
  onSelectMod: (modId: string | null) => void;
};
