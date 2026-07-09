const runtimeNodeGrpcLocalFirstPartyAuthorities = new WeakMap<object, unknown>();

export function installRuntimeNodeGrpcLocalFirstPartyAuthority(
  transportOptions: object,
  authority: unknown,
): void {
  runtimeNodeGrpcLocalFirstPartyAuthorities.set(transportOptions, authority);
}

export function readRuntimeNodeGrpcLocalFirstPartyAuthority(
  transportOptions: object,
): unknown {
  return runtimeNodeGrpcLocalFirstPartyAuthorities.get(transportOptions);
}
