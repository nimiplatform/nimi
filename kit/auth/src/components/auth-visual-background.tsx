import { lazy, Suspense, useEffect, useState } from 'react';
import { allowsParticleMotion } from './particle-background-policy.js';

const ParticleBackground = lazy(() =>
  import('./desktop-particle-background-light.js').then((module) => ({
    default: module.DesktopParticleBackgroundLight,
  })),
);

export function AuthVisualBackground(props: {
  isLogoHovered: boolean;
  profile: 'desktop' | 'web';
}) {
  const [enabled, setEnabled] = useState(() => typeof window !== 'undefined' && allowsParticleMotion(window));
  useEffect(() => {
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    const update = () => setEnabled(allowsParticleMotion(window));
    motion?.addEventListener('change', update);
    connection?.addEventListener('change', update);
    update();
    return () => {
      motion?.removeEventListener('change', update);
      connection?.removeEventListener('change', update);
    };
  }, []);
  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
      <ParticleBackground
        isLogoHovered={props.isLogoHovered}
        profile={props.profile}
      />
    </Suspense>
  );
}
