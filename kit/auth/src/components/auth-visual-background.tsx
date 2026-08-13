import { lazy, Suspense } from 'react';

const ParticleBackground = lazy(() =>
  import('./desktop-particle-background-light.js').then((module) => ({
    default: module.DesktopParticleBackgroundLight,
  })),
);

export function AuthVisualBackground(props: {
  isLogoHovered: boolean;
  profile: 'desktop' | 'web';
}) {
  return (
    <Suspense fallback={null}>
      <ParticleBackground
        isLogoHovered={props.isLogoHovered}
        profile={props.profile}
      />
    </Suspense>
  );
}
