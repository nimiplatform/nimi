import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { invokeChecked } from './invoke.js';
import { assertRecord, parseRequiredString, type JsonObject, type JsonValue } from './types.js';

export type ShellPlatformProjectionPayload = {
  readonly projectionId: string;
  readonly updatedAt?: string;
  readonly packages?: readonly JsonObject[];
};

export type ShellPlatformProjectionResult = {
  readonly projectionId: string;
  readonly record: JsonValue;
};

export async function getShellPlatformProjection(
  payload: ShellPlatformProjectionPayload,
): Promise<ShellPlatformProjectionResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get'];
  return invokeChecked(
    command,
    { payload: payload as unknown as JsonObject },
    (value) => parseShellPlatformProjectionResult(value, command),
  );
}

function parseShellPlatformProjectionResult(
  value: unknown,
  command: string,
): ShellPlatformProjectionResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  return {
    projectionId: parseRequiredString(record.projectionId, 'projectionId', command),
    record: record.record,
  };
}
