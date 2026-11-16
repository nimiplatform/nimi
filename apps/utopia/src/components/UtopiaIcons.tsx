import type { SVGProps } from 'react';
import type { HabitatDaypart, HabitatPlaceArchetype, HabitatSceneryKind } from '@nimiplatform/sdk/app';

type IconProps = SVGProps<SVGSVGElement> & {
  readonly size?: number;
};

function BaseSvg({ size = 15, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function DaypartIcon({ daypart, size = 14 }: { readonly daypart: HabitatDaypart; readonly size?: number }) {
  switch (daypart) {
    case 'morning':
      return (
        <BaseSvg size={size}>
          <path d="M12 3v3" />
          <path d="m5.6 7.6 2.1 2.1" />
          <path d="m18.4 7.6-2.1 2.1" />
          <path d="M4 17h16" />
          <path d="M7 17a5 5 0 0 1 10 0" />
          <path d="M3 20h18" />
        </BaseSvg>
      );
    case 'day':
      return (
        <BaseSvg size={size}>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.3M12 19.2v2.3M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.5 12h2.3M19.2 12h2.3M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
        </BaseSvg>
      );
    case 'dusk':
      return (
        <BaseSvg size={size}>
          <path d="M12 10V4" />
          <path d="m9.5 7.5 2.5 2.5 2.5-2.5" />
          <path d="M4 17h16" />
          <path d="M7 17a5 5 0 0 1 10 0" />
          <path d="M6 20h12" />
        </BaseSvg>
      );
    case 'night':
      return (
        <BaseSvg size={size}>
          <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z" />
          <path d="M17 4v3M15.5 5.5h3" />
        </BaseSvg>
      );
  }
}

export function VolumeOnIcon({ size = 15 }: IconProps) {
  return (
    <BaseSvg size={size}>
      <path d="M11 5 6.5 8.8H3.5v6.4h3L11 19V5Z" />
      <path d="M15.2 8.8a4.6 4.6 0 0 1 0 6.4" />
      <path d="M18.2 6.2a8.2 8.2 0 0 1 0 11.6" />
    </BaseSvg>
  );
}

export function VolumeMutedIcon({ size = 15 }: IconProps) {
  return (
    <BaseSvg size={size}>
      <path d="M11 5 6.5 8.8H3.5v6.4h3L11 19V5Z" />
      <path d="m16 9.5 4.5 5" />
      <path d="m20.5 9.5-4.5 5" />
    </BaseSvg>
  );
}

export function SlidersIcon({ size = 15 }: IconProps) {
  return (
    <BaseSvg size={size}>
      <path d="M4 7h9M17 7h3" />
      <circle cx="15" cy="7" r="2" />
      <path d="M4 12h3M11 12h9" />
      <circle cx="9" cy="12" r="2" />
      <path d="M4 17h11M19 17h1" />
      <circle cx="17" cy="17" r="2" />
    </BaseSvg>
  );
}

export function ScrollMapIcon({ size = 15 }: IconProps) {
  return (
    <BaseSvg size={size}>
      <path d="M6 4h11a2 2 0 0 1 2 2v11a3 3 0 0 1-3 3H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <path d="M8 9h7M8 13h5" />
      <path d="M16 20v-3a1 1 0 0 1 1-1h2" />
    </BaseSvg>
  );
}

export function ExpandStageIcon({ size = 15 }: IconProps) {
  return (
    <BaseSvg size={size}>
      <path d="M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6" />
    </BaseSvg>
  );
}

export function CollapseStageIcon({ size = 15 }: IconProps) {
  return (
    <BaseSvg size={size}>
      <path d="M4 14h6v6M20 10h-6V4M10 14l-6 6M14 10l6-6" />
    </BaseSvg>
  );
}

export function LockClosedIcon({ size = 13 }: IconProps) {
  return (
    <BaseSvg size={size}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7.8a4 4 0 0 1 8 0V11" />
    </BaseSvg>
  );
}

export function LinkDuoIcon({ size = 13 }: IconProps) {
  return (
    <BaseSvg size={size}>
      <path d="M9.5 14.5a3.5 3.5 0 0 1 0-5l2-2a3.5 3.5 0 0 1 5 5l-1 1" />
      <path d="M14.5 9.5a3.5 3.5 0 0 1 0 5l-2 2a3.5 3.5 0 0 1-5-5l1-1" />
    </BaseSvg>
  );
}

export function SparkleStarIcon({ size = 13 }: IconProps) {
  return (
    <BaseSvg size={size}>
      <path d="M12 3.2 14.2 9.8 20.8 12l-6.6 2.2L12 20.8 9.8 14.2 3.2 12l6.6-2.2L12 3.2Z" />
    </BaseSvg>
  );
}

export function ChatBubbleIcon({ size = 14 }: IconProps) {
  return (
    <BaseSvg size={size}>
      <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5c-1.4 0-2.7-.3-3.9-.9L4 19.5l1.3-3.7A7.3 7.3 0 0 1 4 11.5a8 8 0 0 1 16 0Z" />
    </BaseSvg>
  );
}

export function CompassRoseIcon({ size = 16 }: IconProps) {
  return (
    <BaseSvg size={size}>
      <circle cx="12" cy="12" r="9" />
      <polygon points="16.2,7.8 13.8,13.8 7.8,16.2 10.2,10.2" />
    </BaseSvg>
  );
}

export function PlayWaveIcon({ size = 13 }: IconProps) {
  return (
    <BaseSvg size={size}>
      <polygon points="6,5 18,12 6,19" />
    </BaseSvg>
  );
}

export function PauseWaveIcon({ size = 13 }: IconProps) {
  return (
    <BaseSvg size={size}>
      <path d="M8 5v14M16 5v14" />
    </BaseSvg>
  );
}

export function UploadArchiveIcon({ size = 18 }: IconProps) {
  return (
    <BaseSvg size={size}>
      <path d="M12 15V4" />
      <path d="m8 8 4-4 4 4" />
      <path d="M4 16.5v1.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" />
    </BaseSvg>
  );
}

export function ArchetypeIcon(props: {
  readonly archetype: HabitatPlaceArchetype | 'personal-quarter';
  readonly size?: number;
}) {
  const { archetype, size = 14 } = props;
  switch (archetype) {
    case 'personal-quarter':
    case 'shelter':
      return (
        <BaseSvg size={size}>
          <path d="M3.5 11 12 4l8.5 7" />
          <path d="M6 9.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5" />
          <path d="M10 20v-5h4v5" />
        </BaseSvg>
      );
    case 'lookout':
      return (
        <BaseSvg size={size}>
          <path d="m3 16 11-6 3 5-11 4-3-3Z" />
          <path d="m14 10 5-3 2 3.5-5 2.5" />
          <path d="M10 16.5 8 21M12.5 15.5 15 21" />
        </BaseSvg>
      );
    case 'waterside':
      return (
        <BaseSvg size={size}>
          <path d="M3 10c2.2-1.8 4.5-1.8 6.7 0 2.2 1.8 4.4 1.8 6.6 0 1.5-1.2 3.1-1.6 4.7-.9" />
          <path d="M3 15.5c2.2-1.8 4.5-1.8 6.7 0 2.2 1.8 4.4 1.8 6.6 0 1.5-1.2 3.1-1.6 4.7-.9" />
        </BaseSvg>
      );
    case 'garden':
      return (
        <BaseSvg size={size}>
          <path d="M12 20v-9" />
          <path d="M12 13C7.5 13 5 9.8 5 6c3.8 0 7 2.5 7 7Z" />
          <path d="M12 11c0-4 2.8-6.5 7-6.5 0 3.8-2.6 6.5-7 6.5Z" />
        </BaseSvg>
      );
    case 'workshop':
      return (
        <BaseSvg size={size}>
          <path d="m14.5 6.5 3 3" />
          <path d="M5 19 14.5 9.5a3.5 3.5 0 0 0 4.5-4.5l-2.2 2.2-2-2 2.2-2.2A3.5 3.5 0 0 0 12.5 7.5L3 17l2 2Z" />
        </BaseSvg>
      );
    case 'hearth':
      return (
        <BaseSvg size={size}>
          <path d="M12 3c1.5 3 4.8 4.8 4.8 9a4.8 4.8 0 0 1-9.6 0c0-2.5 1.4-4.6 3-6.2.2 1.8 1.2 2.6 2 3-.2-2 .1-4.1-.2-5.8Z" />
          <path d="M6 20h12" />
        </BaseSvg>
      );
    case 'library':
      return (
        <BaseSvg size={size}>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z" />
          <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v16h5.5a2.5 2.5 0 0 1 2.5 2V5.5Z" />
        </BaseSvg>
      );
    case 'courtyard':
      return (
        <BaseSvg size={size}>
          <path d="M9 4h6" />
          <rect x="7" y="7" width="10" height="10" rx="3" />
          <path d="M12 4v3M12 17v3M9.5 20h5" />
        </BaseSvg>
      );
  }
}

export function SceneryGlyph({ kind, size = 13 }: { readonly kind: HabitatSceneryKind; readonly size?: number }) {
  switch (kind) {
    case 'meteor-shower':
    case 'aurora':
    case 'clear-sky':
      return <SparkleStarIcon size={size} />;
    case 'tide-pooling':
    case 'rain':
      return <ArchetypeIcon archetype="waterside" size={size} />;
    case 'blossom':
    case 'harvest':
      return <ArchetypeIcon archetype="garden" size={size} />;
    case 'hearth-lit':
      return <ArchetypeIcon archetype="hearth" size={size} />;
    default:
      return <SparkleStarIcon size={size} />;
  }
}
