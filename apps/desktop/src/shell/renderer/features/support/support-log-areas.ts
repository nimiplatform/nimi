/**
 * Desktop log areas, mirroring `.nimi/spec/desktop/kernel/tables/log-areas.yaml`
 * (`desktop_log_areas` closed enum, owner: desktop).
 *
 * The Support `logs` sub-area (`D-SUP-006`) projects this fixed product
 * enumeration so the user can see which log areas exist. The list is a closed
 * enum — desktop kernel owns it; this constant is the renderer projection of
 * the committed kernel table, not a new source of truth.
 */

export type DesktopLogArea =
  | 'runtime'
  | 'renderer-bootstrap'
  | 'bridge'
  | 'datasync'
  | 'local-ai'
  | 'external-agent'
  | 'auth'
  | 'net';

/** The closed `desktop_log_areas` enum, in kernel-table order. */
export const DESKTOP_LOG_AREAS: readonly DesktopLogArea[] = [
  'runtime',
  'renderer-bootstrap',
  'bridge',
  'datasync',
  'local-ai',
  'external-agent',
  'auth',
  'net',
] as const;

/** i18n key for each log-area description shown in the Support logs view. */
export const DESKTOP_LOG_AREA_LABEL_KEY: Record<DesktopLogArea, string> = {
  runtime: 'Support.logAreaRuntime',
  'renderer-bootstrap': 'Support.logAreaRendererBootstrap',
  bridge: 'Support.logAreaBridge',
  datasync: 'Support.logAreaDatasync',
  'local-ai': 'Support.logAreaLocalAi',
  'external-agent': 'Support.logAreaExternalAgent',
  auth: 'Support.logAreaAuth',
  net: 'Support.logAreaNet',
};
