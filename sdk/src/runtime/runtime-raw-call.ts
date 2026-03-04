import type {
  RuntimeCallOptions,
  RuntimeClient,
  RuntimeStreamCallOptions,
} from './types.js';

type RuntimeMethodBinding = {
  moduleKey: string;
  methodKey: string;
  stream: boolean;
};

export async function runtimeRawCall<TReq, TRes>(input: {
  methodId: string;
  request: TReq;
  options?: RuntimeCallOptions | RuntimeStreamCallOptions;
  methodLookup: Record<string, RuntimeMethodBinding>;
  assertMethodAvailable: (moduleKey: string, methodKey: string) => void;
  invokeWithClient: <T>(operation: (client: RuntimeClient) => Promise<T>) => Promise<T>;
  createMethodNotAllowlistedError: (methodId: string) => Error;
  createMethodNotImplementedError: (moduleKey: string, methodKey: string) => Error;
}): Promise<TRes> {
  const binding = input.methodLookup[input.methodId];
  if (!binding) {
    throw input.createMethodNotAllowlistedError(input.methodId);
  }

  input.assertMethodAvailable(binding.moduleKey, binding.methodKey);

  return input.invokeWithClient(async (client) => {
    const module = (client as unknown as Record<string, unknown>)[binding.moduleKey] as Record<string, unknown>;
    const method = module[binding.methodKey];
    if (typeof method !== 'function') {
      throw input.createMethodNotImplementedError(binding.moduleKey, binding.methodKey);
    }

    if (binding.stream) {
      return (method as (
        request: TReq,
        callOptions?: RuntimeStreamCallOptions,
      ) => Promise<TRes>)(input.request, input.options as RuntimeStreamCallOptions | undefined);
    }

    return (method as (
      request: TReq,
      callOptions?: RuntimeCallOptions,
    ) => Promise<TRes>)(input.request, input.options as RuntimeCallOptions | undefined);
  });
}
