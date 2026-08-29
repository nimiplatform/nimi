import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export type ZhiyuResourcePackEffectiveSource = 'default' | 'preview' | 'selected' | 'last-safe';

export type ZhiyuResourcePackSurfaceProps = Omit<ComponentPropsWithoutRef<'section'>, 'children'> & {
  readonly children: ReactNode;
  readonly effectiveSource: ZhiyuResourcePackEffectiveSource;
  readonly phase?: string;
  readonly scopedCssText?: string | null;
};

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r018
export function ZhiyuResourcePackSurface({
  children,
  effectiveSource,
  phase,
  scopedCssText,
  ...sectionProps
}: ZhiyuResourcePackSurfaceProps) {
  return (
    <section
      {...sectionProps}
      data-zhiyu-resource-pack-surface="true"
      data-zhiyu-resource-pack-effective-source={effectiveSource}
      data-zhiyu-resource-pack-phase={phase ?? effectiveSource}
    >
      {scopedCssText ? (
        <style data-zhiyu-resource-pack-style={effectiveSource}>{scopedCssText}</style>
      ) : null}
      <div
        aria-hidden="true"
        className="zhiyu-resource-pack-surface__visual"
        data-nimi-pack-zone="surface"
        data-zhiyu-resource-pack-guard="decorative-only"
      />
      {children}
    </section>
  );
}
