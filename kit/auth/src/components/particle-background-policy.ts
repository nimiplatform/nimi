export type ParticleMotionEnvironment = {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: {
    hardwareConcurrency?: number;
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
};

// Check before importing the renderer so static presentations do not download Three.js.
export function allowsParticleMotion(env: ParticleMotionEnvironment): boolean {
  const device = env.navigator;
  return !env.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    && !device?.connection?.saveData
    && !(typeof device?.hardwareConcurrency === 'number' && device.hardwareConcurrency <= 2)
    && !(typeof device?.deviceMemory === 'number' && device.deviceMemory <= 2);
}
