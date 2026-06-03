import { createNimiError } from '../core/errors.js';
import { ReasonCode } from '../types/index.js';
import type {
  RuntimeOptions,
  RuntimeResponseMetadataObserver,
  RuntimeTransportConfig,
} from './types.js';
import { normalizeText } from './runtime-value-utils.js';

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process?.versions?.node);
}

function readNodeEnv(name: string): string {
  if (!isNodeRuntime()) {
    return '';
  }
  return normalizeText(process.env?.[name]);
}

function resolveRuntimeAppId(options: RuntimeOptions): string {
  const appIdInput = hasOwn(options, 'appId')
    ? options.appId
    : readNodeEnv('NIMI_APP_ID') || 'nimi.app';
  const appId = normalizeText(appIdInput);
  if (!appId) {
    throw createNimiError({
      message: 'appId is required',
      reasonCode: ReasonCode.SDK_APP_ID_REQUIRED,
      actionHint: 'set_app_id',
      source: 'sdk',
    });
  }
  return appId;
}

function resolveRuntimeTransportInput(options: RuntimeOptions): RuntimeTransportConfig {
  const transportInput = options.transport || (isNodeRuntime()
    ? {
      type: 'node-grpc' as const,
      endpoint: readNodeEnv('NIMI_RUNTIME_ENDPOINT') || '127.0.0.1:46371',
    }
    : undefined);
  if (!transportInput) {
    throw createNimiError({
      message: 'transport is required outside Node.js. App-level consumers should use createPlatformClient(); direct Runtime construction only auto-configures transport in Node.js. Otherwise pass transport explicitly (for example node-grpc or tauri-ipc).',
      reasonCode: ReasonCode.SDK_TRANSPORT_INVALID,
      actionHint: 'set_transport',
      source: 'sdk',
    });
  }
  return transportInput;
}

export function resolveRuntimeConstructorOptions(input: {
  options: RuntimeOptions;
  responseMetadataObserver: RuntimeResponseMetadataObserver;
}): {
  appId: string;
  transport: RuntimeTransportConfig;
  options: RuntimeOptions;
} {
  const appId = resolveRuntimeAppId(input.options);
  const transportInput = resolveRuntimeTransportInput(input.options);
  const transportWithObserver = {
    ...transportInput,
    _responseMetadataObserver: input.responseMetadataObserver,
  };

  return {
    appId,
    transport: transportInput,
    options: {
      ...input.options,
      appId,
      transport: transportWithObserver,
      connection: {
        waitForReadyTimeoutMs: input.options.connection?.waitForReadyTimeoutMs,
      },
    },
  };
}
