export type RuntimeConfigBanner = {
  kind: 'success' | 'warning' | 'error' | 'info';
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export type SetRuntimeConfigBanner = (value: RuntimeConfigBanner | null) => void;
