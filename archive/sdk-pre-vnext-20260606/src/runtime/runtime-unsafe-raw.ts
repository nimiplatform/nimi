import { createNimiError } from '../core/errors.js';
import { ReasonCode } from '../types/index.js';
import type {
  RuntimeCallOptions,
  RuntimeClient,
  RuntimeStreamCallOptions,
  RuntimeUnsafeRawModule,
} from './types.js';
import { RUNTIME_METHOD_LOOKUP } from './runtime-method-lookup.js';
import { createRawModule } from './runtime-modules.js';
import { runtimeRawCall } from './runtime-raw-call.js';

export function createRuntimeUnsafeRawModule(input: {
  assertMethodAvailable: (moduleKey: string, methodKey: string) => void;
  invokeWithClient: <T>(operation: (client: RuntimeClient) => Promise<T>) => Promise<T>;
}): RuntimeUnsafeRawModule {
  const rawCall: RuntimeUnsafeRawModule['call'] = (
    methodId: string,
    inputValue: unknown,
    optionsValue?: RuntimeCallOptions | RuntimeStreamCallOptions,
  ) => runtimeRawCall({
    methodId,
    request: inputValue,
    options: optionsValue,
    methodLookup: RUNTIME_METHOD_LOOKUP,
    assertMethodAvailable: input.assertMethodAvailable,
    invokeWithClient: input.invokeWithClient,
    createMethodNotAllowlistedError: (missingMethodId) => createNimiError({
      message: `runtime method is not allowlisted: ${missingMethodId}`,
      reasonCode: ReasonCode.SDK_RUNTIME_CODEC_MISSING,
      actionHint: 'use_runtime_method_ids',
      source: 'sdk',
    }),
    createMethodNotImplementedError: (moduleKey, methodKey) => createNimiError({
      message: `${moduleKey}.${methodKey} is not implemented`,
      reasonCode: ReasonCode.SDK_RUNTIME_CODEC_MISSING,
      actionHint: 'check_runtime_method_mapping',
      source: 'sdk',
    }),
  });

  return createRawModule({
    rawCall,
    invokeWithClient: input.invokeWithClient,
  });
}
