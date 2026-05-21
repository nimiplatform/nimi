// First-Run Wizard Icons — small inline SVG glyphs for the onboarding UI.
//
// These are local presentation glyphs for the first-run takeover only. They
// are deliberately minimal stroke icons that match the kit visual language
// (currentColor stroke, 1.5 width, rounded caps) without pulling an icon
// dependency into the bootstrap-critical first-run path.

import type { ReactElement, SVGProps } from 'react';

type GlyphProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: GlyphProps & { children: React.ReactNode }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export function FolderIcon(props: GlyphProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17z" />
    </Svg>
  );
}

export function ChipIcon(props: GlyphProps): ReactElement {
  return (
    <Svg {...props}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3" />
    </Svg>
  );
}

export function SparklesIcon(props: GlyphProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M12 4.5 13.4 9 18 10.4 13.4 11.8 12 16.3 10.6 11.8 6 10.4 10.6 9z" />
      <path d="M17.5 15.5 18.2 17.5 20 18.2 18.2 18.9 17.5 21 16.8 18.9 15 18.2 16.8 17.5z" />
    </Svg>
  );
}

export function CheckCircleIcon(props: GlyphProps): ReactElement {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </Svg>
  );
}

/** A solid filled check-circle, used for completed/selected affordances. */
export function CheckCircleFilledIcon(props: GlyphProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path
        d="m8 12.2 2.6 2.6 5.4-6"
        stroke="var(--nimi-surface-card, #fff)"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EmptyCircleIcon(props: GlyphProps): ReactElement {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
    </Svg>
  );
}

export function CheckIcon(props: GlyphProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="m5 12.5 4.5 4.5L19 6.5" />
    </Svg>
  );
}

export function WrenchIcon(props: GlyphProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M15.5 6.5a4 4 0 0 0-5.2 5.2L4 18l2 2 6.3-6.3a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.5-.7-.7-2.5z" />
    </Svg>
  );
}

export function AlertIcon(props: GlyphProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M12 4 2.5 20h19z" />
      <path d="M12 10v4M12 17.2v.1" />
    </Svg>
  );
}

/** An animated spinner ring for the in-progress checklist step. */
export function SpinnerIcon(props: GlyphProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2} strokeOpacity={0.25} />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        className="nimi-first-run-spin"
      />
    </svg>
  );
}
