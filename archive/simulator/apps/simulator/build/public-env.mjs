import { SimulatorConformanceError } from '@nimiplatform/app-tools/simulator-conformance';

export const SIMULATOR_PUBLIC_ENV_KEYS = Object.freeze([
  'NIMI_SIMULATOR_PUBLIC_ORIGIN',
]);

function fail(message) {
  throw new SimulatorConformanceError('SIM_PUBLIC_ENV', message);
}

export function readSimulatorPublicEnvironment(source = process.env) {
  const rawOrigin = source.NIMI_SIMULATOR_PUBLIC_ORIGIN;
  if (rawOrigin === undefined || rawOrigin === '') {
    return Object.freeze({ publicOrigin: null });
  }
  let origin;
  try {
    const parsed = new URL(rawOrigin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
      fail('NIMI_SIMULATOR_PUBLIC_ORIGIN must be a credential-free HTTPS origin');
    }
    origin = parsed.origin;
  } catch (error) {
    if (error instanceof SimulatorConformanceError) throw error;
    fail('NIMI_SIMULATOR_PUBLIC_ORIGIN must be a valid HTTPS origin');
  }
  return Object.freeze({ publicOrigin: origin });
}
