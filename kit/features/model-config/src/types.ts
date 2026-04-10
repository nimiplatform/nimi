import type { RouteModelPickerDataProvider } from '@nimiplatform/nimi-kit/features/model-picker';
import type { ReactNode } from 'react';

export type ModelConfigRouteBinding = {
  source: 'local' | 'cloud';
  connectorId: string;
  model: string;
  modelId?: string;
  modelLabel?: string;
  localModelId?: string;
  provider?: string;
  engine?: string;
  adapter?: string;
  endpoint?: string;
  goRuntimeLocalModelId?: string;
  goRuntimeStatus?: string;
  providerHints?: Record<string, unknown>;
};

export type ModelConfigCapabilityStatusTone = 'ready' | 'attention' | 'neutral';

export type ModelConfigCapabilityStatus = {
  supported: boolean;
  tone?: ModelConfigCapabilityStatusTone;
  badgeLabel?: string;
  title?: string;
  detail?: string | null;
};

export type ModelConfigCapabilityItem = {
  capabilityId: string;
  routeCapability: string;
  label: string;
  detail?: string;
  binding: ModelConfigRouteBinding | null;
  provider: RouteModelPickerDataProvider | null;
  onBindingChange: (binding: ModelConfigRouteBinding | null) => void;
  status?: ModelConfigCapabilityStatus | null;
  editor?: ReactNode;
  showEditorWhen?: 'always' | 'local';
  showClearButton?: boolean;
  placeholder?: string;
  disabled?: boolean;
  runtimeNotReadyLabel?: string;
  clearSelectionLabel?: string;
};

export type ModelConfigSection = {
  id: string;
  title: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  items?: ModelConfigCapabilityItem[];
  content?: ReactNode;
  hidden?: boolean;
};

export type ModelConfigProfileOption = {
  profileId: string;
  title: string;
  description?: string;
};

export type ModelConfigProfileCopy = {
  sectionTitle: string;
  summaryLabel: string;
  emptySummaryLabel: string;
  applyButtonLabel: string;
  changeButtonLabel: string;
  manageButtonTitle: string;
  modalTitle: string;
  modalHint: string;
  loadingLabel: string;
  emptyLabel: string;
  currentBadgeLabel: string;
  cancelLabel: string;
  confirmLabel: string;
  applyingLabel: string;
  reloadLabel?: string;
};

export type ModelConfigProfileController = {
  currentOrigin: {
    profileId: string;
    title?: string | null;
  } | null;
  profiles: ModelConfigProfileOption[];
  selectedProfileId: string | null;
  isLoading?: boolean;
  isReloading?: boolean;
  error?: string | null;
  applying?: boolean;
  copy: ModelConfigProfileCopy;
  onSelectedProfileChange: (profileId: string | null) => void;
  onApply: (profileId: string) => void;
  onManage?: () => void;
  onReload?: () => void;
};

export type ImageParamsState = {
  size: string;
  responseFormat: string;
  seed: string;
  timeoutMs: string;
  steps: string;
  cfgScale: string;
  sampler: string;
  scheduler: string;
  optionsText: string;
};

export type VideoParamsState = {
  mode: string;
  ratio: string;
  durationSec: string;
  resolution: string;
  fps: string;
  seed: string;
  timeoutMs: string;
  negativePrompt: string;
  cameraFixed: boolean;
  generateAudio: boolean;
};

export type CompanionSlotDef = {
  slot: string;
  label: string;
  kind: string;
};

export type LocalAssetEntry = {
  localAssetId: string;
  assetId: string;
  kind: number;
  engine: string;
  status: number;
};

export type CapabilityModelCardProps = {
  item: ModelConfigCapabilityItem;
};

export type ModelConfigPanelProps = {
  profile?: ModelConfigProfileController;
  sections: ModelConfigSection[];
  className?: string;
};
