import { createElement, type ComponentPropsWithoutRef, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { cn, type AmbientVariant } from '../design-tokens.js';

/**
 * AmbientBackground — governed primitive for the first-class ambient surface
 * declared by P-DESIGN-023.
 *
 * Renders an absolute-positioned ambient layer beneath `children` and acts as
 * the positioning container itself (relative + isolation). When
 * `variant="none"` it returns `children` inside a transparent passthrough
 * container with no ambient markup.
 *
 * Variants:
 * - `mesh`    — radial aurora gradient + three blurred color halos; halos
 *               use Tailwind's `animate-pulse` utility and downgrade to
 *               static via `motion-reduce:animate-none`.
 * - `minimal` — base linear gradient only, no halos.
 * - `none`    — no ambient decoration; transparent passthrough.
 *
 * Color slots resolve through `--nimi-ambient-mesh-*` tokens declared in
 * `nimi-ui-tokens.yaml` and themed in `nimi-ui-themes.yaml`. Accent packs
 * may override any slot without changing the composition.
 *
 * Gradient values are applied via React inline `style`, not via CSS rule
 * bodies in `kit/ui/src/styles.css`. Primitive class names declared in
 * `nimi-ui-primitives.yaml` (e.g. `nimi-ambient-mesh`, `nimi-ambient-halo`)
 * act as documentary markers on the rendered DOM; they do not receive
 * styling from a stylesheet. See preflight-w2.md §Scope Amendment
 * 2026-04-17 for the rationale.
 *
 * W6 follow-on closed the remaining fallback gap by pairing primitive marker
 * classes with non-generator data attributes that authored CSS can target for
 * reduced-transparency and no-backdrop downgrade behavior.
 */
type AmbientBackgroundProps<T extends ElementType = 'div'> = {
  as?: T;
  variant?: AmbientVariant;
  children?: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>;

const ROOT_STYLE: CSSProperties = {
  position: 'relative',
  isolation: 'isolate',
};

const MESH_LAYER_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  zIndex: 0,
  background: [
    'radial-gradient(ellipse at 0% 0%, var(--nimi-ambient-mesh-color-1) 0%, transparent 50%)',
    'radial-gradient(ellipse at 100% 0%, var(--nimi-ambient-mesh-color-2) 0%, transparent 50%)',
    'radial-gradient(ellipse at 100% 100%, var(--nimi-ambient-mesh-color-3) 0%, transparent 50%)',
    'radial-gradient(ellipse at 0% 100%, var(--nimi-ambient-mesh-color-4) 0%, transparent 50%)',
    'linear-gradient(135deg, var(--nimi-ambient-mesh-base-start) 0%, var(--nimi-ambient-mesh-base-end) 100%)',
  ].join(', '),
};

const MINIMAL_LAYER_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  zIndex: 0,
  background: 'linear-gradient(135deg, var(--nimi-ambient-mesh-base-start) 0%, var(--nimi-ambient-mesh-base-end) 100%)',
};

const HALO_BASE_STYLE: CSSProperties = {
  position: 'absolute',
  borderRadius: '50%',
  filter: 'blur(120px)',
  opacity: 0.5,
  pointerEvents: 'none',
  zIndex: 0,
};

const VARIANT_CLASS: Record<AmbientVariant, string> = {
  mesh: 'nimi-ambient-variant-mesh',
  minimal: 'nimi-ambient-variant-minimal',
  none: 'nimi-ambient-variant-none',
};

export function AmbientBackground<T extends ElementType = 'div'>(
  props: AmbientBackgroundProps<T>,
) {
  const { as, variant = 'none', children, className, style: userStyle, ...rest } = props;
  const Component = (as || 'div') as ElementType;

  // Primitive contract (P-DESIGN-023): root slot `nimi-ambient-root` and one
  // variant marker class are applied for every variant, including `none`.
  // Consumer `style` is merged first; ROOT_STYLE wins so the positioning
  // container (`position: relative; isolation: isolate`) is never dropped —
  // the mesh / halo layers rely on this parent for absolute anchoring.
  const rootClass = cn('nimi-ambient-root', VARIANT_CLASS[variant], className);
  const mergedRootStyle = { ...(userStyle as CSSProperties | undefined), ...ROOT_STYLE };

  let layers: ReactNode = null;
  if (variant === 'mesh') {
    layers = (
      <>
        <div
          aria-hidden="true"
          className="nimi-ambient-mesh"
          data-nimi-ambient-layer="mesh"
          style={MESH_LAYER_STYLE}
        />
        <div
          aria-hidden="true"
          className="nimi-ambient-halo animate-pulse motion-reduce:animate-none"
          data-nimi-ambient-layer="halo"
          style={{
            ...HALO_BASE_STYLE,
            width: 500,
            height: 500,
            top: -100,
            left: -100,
            background: 'var(--nimi-ambient-mesh-color-1)',
          }}
        />
        <div
          aria-hidden="true"
          className="nimi-ambient-halo animate-pulse motion-reduce:animate-none"
          data-nimi-ambient-layer="halo"
          style={{
            ...HALO_BASE_STYLE,
            width: 600,
            height: 600,
            bottom: -100,
            right: '5%',
            background: 'var(--nimi-ambient-mesh-color-3)',
            animationDelay: '-5s',
          }}
        />
        <div
          aria-hidden="true"
          className="nimi-ambient-halo animate-pulse motion-reduce:animate-none"
          data-nimi-ambient-layer="halo"
          style={{
            ...HALO_BASE_STYLE,
            width: 400,
            height: 400,
            top: '20%',
            left: '30%',
            background: 'var(--nimi-ambient-mesh-color-2)',
            animationDelay: '-10s',
          }}
        />
      </>
    );
  } else if (variant === 'minimal') {
    layers = (
      <div
        aria-hidden="true"
        className="nimi-ambient-minimal"
        data-nimi-ambient-layer="minimal"
        style={MINIMAL_LAYER_STYLE}
      />
    );
  }

  return createElement(
    Component,
    {
      ...rest,
      className: rootClass,
      style: mergedRootStyle,
      'data-nimi-ambient-variant': variant,
    },
    layers,
    children,
  );
}
