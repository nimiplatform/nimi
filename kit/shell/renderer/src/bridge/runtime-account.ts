import { invokeChecked } from './invoke.js';
import { assertRecord, parseOptionalString, parseRequiredString, type JsonObject } from './types.js';

const DESKTOP_ACCOUNT_SESSION_STATUS_COMMAND = 'runtime_account_session_status';

export type DesktopAccountSessionState =
  | 'anonymous'
  | 'login-pending'
  | 'authenticated'
  | 'refresh-pending'
  | 'expired'
  | 'reauth-required'
  | 'switching'
  | 'logging-out'
  | 'unavailable';

export type DesktopAccountProjection = {
  accountId: string;
  displayName: string;
  realmEnvironmentId: string;
};

export type DesktopAccountSessionStatus = {
  state: DesktopAccountSessionState;
  accountProjection?: DesktopAccountProjection;
};

const ACCOUNT_STATES = new Set<DesktopAccountSessionState>([
  'anonymous',
  'login-pending',
  'authenticated',
  'refresh-pending',
  'expired',
  'reauth-required',
  'switching',
  'logging-out',
  'unavailable',
]);

function assertExactKeys(record: JsonObject, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains forbidden fields: ${unexpected.join(', ')}`);
  }
}

export function parseDesktopAccountSessionStatus(value: unknown): DesktopAccountSessionStatus {
  const record = assertRecord(value, 'runtime_account_session_status returned invalid payload');
  assertExactKeys(record, ['state', 'accountProjection'], 'runtime_account_session_status');
  const state = parseRequiredString(
    record.state,
    'state',
    'runtime_account_session_status',
  ) as DesktopAccountSessionState;
  if (!ACCOUNT_STATES.has(state)) {
    throw new Error(`runtime_account_session_status returned unsupported state: ${state}`);
  }
  let accountProjection: DesktopAccountProjection | undefined;
  if (record.accountProjection !== undefined && record.accountProjection !== null) {
    const projection = assertRecord(
      record.accountProjection,
      'runtime_account_session_status accountProjection is invalid',
    );
    assertExactKeys(
      projection,
      ['accountId', 'displayName', 'realmEnvironmentId'],
      'runtime_account_session_status accountProjection',
    );
    accountProjection = {
      accountId: parseRequiredString(
        projection.accountId,
        'accountProjection.accountId',
        'runtime_account_session_status',
      ),
      displayName: parseOptionalString(projection.displayName) ?? '',
      realmEnvironmentId: parseOptionalString(projection.realmEnvironmentId) ?? '',
    };
  }
  if (state === 'authenticated' && !accountProjection) {
    throw new Error('runtime_account_session_status authenticated state requires accountProjection');
  }
  return {
    state,
    ...(accountProjection ? { accountProjection } : {}),
  };
}

export async function getRuntimeAccountSessionStatus(): Promise<DesktopAccountSessionStatus> {
  return invokeChecked(
    DESKTOP_ACCOUNT_SESSION_STATUS_COMMAND,
    {},
    parseDesktopAccountSessionStatus,
  );
}
