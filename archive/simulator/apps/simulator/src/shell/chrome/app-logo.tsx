import { simulatorSelectedModuleLogos } from '../../../.generated/app-logos.ts';

export function AppLogo({
  moduleId,
  size,
}: {
  readonly moduleId: string;
  readonly size: 'home' | 'window' | 'rail' | 'card';
}) {
  const src = (simulatorSelectedModuleLogos as Readonly<Record<string, string>>)[moduleId];
  if (!src) {
    return (
      <span className={`spine-glyph spine-glyph-${moduleId}`} aria-hidden>
        <i />
        <i />
        <i />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="simulator-app-logo"
      data-logo-module={moduleId}
      data-logo-size={size}
    />
  );
}
