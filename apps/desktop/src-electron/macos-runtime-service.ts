type RegistrationOperation = 'status' | 'register' | 'reregister' | 'unregister' | 'open-settings';
type CommandNames = { readonly status: string; readonly start: string; readonly restart: string };
type LifecycleHost = { invoke(command: string, names: CommandNames): Promise<unknown> };

export type MacOSRuntimeServicePorts = {
  readonly registration: (operation: RegistrationOperation) => Promise<number>;
  readonly socketExists: () => boolean;
  readonly showApproval: () => Promise<boolean>;
  readonly runtimeEndpoint: string;
};

// @nimi-authority: rule.nimi.runtime.protected-session.r006
// Home's installed host owns registration and repair choices. Kit only carries
// the exact native operation and protected Runtime status/restart requests.
export function createDesktopMacOSRuntimeServiceHost(base: LifecycleHost, ports: MacOSRuntimeServicePorts) {
  let registrationInFlight: Promise<number> | undefined;
  const registerAfterUnregister = async () => {
    await ports.registration('unregister');
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await ports.registration('register');
      } catch (error) {
        // BTM can report NotRegistered before its cached disposition accepts
        // re-registration. Retry only this observed post-unregister state;
        // approval requirements and persistent failures still reach the UI.
        if (attempt >= 9 || !(error instanceof Error)
          || error.message !== 'runtime-service-unavailable'
          || await ports.registration('status') !== 0) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
    }
  };
  const prepare = () => {
    registrationInFlight ??= (async () => {
      const before = await ports.registration('status');
      // A fresh bundle can have no Background Task Management record yet.
      // Let registration validate the fixed embedded service for either
      // absent state; status alone must not strand first installation.
      if (before === 0 || before === 3) return ports.registration('register');
      if (before === 1 && !ports.socketExists()) return registerAfterUnregister();
      return before;
    })().finally(() => { registrationInFlight = undefined; });
    return registrationInFlight;
  };
  const pending = (registration: number) => ({
    running: false,
    managed: true,
    launchMode: 'RELEASE',
    grpcAddr: ports.runtimeEndpoint,
    lastError: registration === 2
      ? 'runtime-service-approval-required'
      : registration === 3 ? 'runtime-service-repair-required' : 'runtime-service-unavailable',
  });
  return {
    async prepare(): Promise<boolean> {
      const registration = await prepare();
      if (registration === 1) return true;
      if (registration !== 2) throw new Error(pending(registration).lastError);
      if (await ports.showApproval()) await ports.registration('open-settings');
      // Home must stop bootstrap until the administrator approves. Continuing
      // into renderer auto-start would immediately repeat a dismissed prompt.
      return false;
    },
    async unregister(): Promise<void> {
      if (await ports.registration('unregister') !== 0) {
        throw new Error('Nimi Runtime could not be unregistered. The application was retained.');
      }
    },
    async invoke(command: string, names: CommandNames): Promise<unknown> {
      const registration = command === names.start ? await prepare() : await ports.registration('status');
      if (registration !== 1) {
        if (registration === 2 && command === names.start && await ports.showApproval()) {
          await ports.registration('open-settings');
        }
        return pending(registration);
      }
      return base.invoke(command, names);
    },
  };
}
