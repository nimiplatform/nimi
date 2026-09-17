export const SIMULATOR_PUBLIC_ENV_KEYS: readonly ['NIMI_SIMULATOR_PUBLIC_ORIGIN'];

export function readSimulatorPublicEnvironment(source?: NodeJS.ProcessEnv): Readonly<{
  publicOrigin: string | null;
}>;
