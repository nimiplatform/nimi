import type {
  AppLaunchReadiness,
  NimiAppClient,
  NimiAppRow,
  NimiAppStatus,
} from '@nimiplatform/sdk/app';

export const DESKTOP_APPS_CARD_STATES = [
  'not_installed_installable',
  'installing',
  'installed_ready',
  'update_available',
  'update_required',
  'permission_required',
  'repair_required',
  'unsupported_on_this_device',
  'blocked_by_policy',
  'install_failed',
  'uninstalling',
  'status_unavailable',
] as const;

export type DesktopAppsCardState = typeof DESKTOP_APPS_CARD_STATES[number];

export interface DesktopAppsEntry {
  readonly app: NimiAppRow;
  readonly status?: NimiAppStatus;
  readonly cardState: DesktopAppsCardState;
  readonly detail?: string;
}

export type DesktopAppsPanelProjection =
  | { readonly status: 'loaded'; readonly entries: readonly DesktopAppsEntry[] }
  | { readonly status: 'error'; readonly detail: string };

export async function projectAppsPanel(client: NimiAppClient): Promise<DesktopAppsPanelProjection> {
  if (!client) {
    return { status: 'error', detail: 'projectAppsPanel: nimiAppClient is required' };
  }

  let rows: readonly NimiAppRow[];
  try {
    rows = await client.list();
  } catch (error) {
    return { status: 'error', detail: `list failed: ${errorMessage(error)}` };
  }

  const entries: DesktopAppsEntry[] = [];
  for (const app of rows) {
    try {
      const status = await client.status(app.appId);
      entries.push({
        app,
        status,
        cardState: mapLaunchReadinessToAppsCardState(status.launchReadiness),
        detail: status.detail,
      });
    } catch (error) {
      entries.push({
        app,
        cardState: 'status_unavailable',
        detail: `status failed: ${errorMessage(error)}`,
      });
    }
  }

  return { status: 'loaded', entries };
}

export function mapLaunchReadinessToAppsCardState(readiness: AppLaunchReadiness): DesktopAppsCardState {
  switch (readiness) {
    case 'ready':
      return 'installed_ready';
    case 'install-required':
      return 'not_installed_installable';
    case 'update-required':
      return 'update_required';
    case 'repair-required':
      return 'repair_required';
    case 'permission-required':
      return 'permission_required';
    case 'blocked-by-master-gate':
      return 'blocked_by_policy';
    case 'unsupported':
      return 'unsupported_on_this_device';
  }
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown error';
  }
  const cause = (error as { readonly cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) {
    return `${error.message}: ${cause.message}`;
  }
  return error.message;
}
