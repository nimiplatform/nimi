import type { CSSProperties } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { computeAgeMonths, type ChildProfile } from '../app-shell/app-store.js';
import female03 from './assets/default-avatars/female-0-3.png';
import female1218 from './assets/default-avatars/female-12-18.png';
import female36 from './assets/default-avatars/female-3-6.png';
import female612 from './assets/default-avatars/female-6-12.png';
import male03 from './assets/default-avatars/male-0-3.png';
import male1218 from './assets/default-avatars/male-12-18.png';
import male36 from './assets/default-avatars/male-3-6.png';
import male612 from './assets/default-avatars/male-6-12.png';

export type ChildAvatarLike = Pick<ChildProfile, 'avatarPath' | 'birthDate' | 'gender'>;

type DefaultAvatarTuning = {
  scale: number;
  translateY: string;
};

const DEFAULT_AVATAR_TUNING: Record<
  'male-0-3' | 'female-0-3' | 'male-3-6' | 'female-3-6' | 'male-6-12' | 'female-6-12' | 'male-12-18' | 'female-12-18',
  DefaultAvatarTuning
> = {
  'male-0-3': { scale: 1, translateY: '0%' },
  'female-0-3': { scale: 1, translateY: '0%' },
  'male-3-6': { scale: 1, translateY: '0%' },
  'female-3-6': { scale: 1, translateY: '0%' },
  'male-6-12': { scale: 1, translateY: '0%' },
  'female-6-12': { scale: 1, translateY: '0%' },
  'male-12-18': { scale: 1, translateY: '0%' },
  'female-12-18': { scale: 1, translateY: '0%' },
};

function normalizeAgeMonths(ageMonths: number): number {
  return Number.isFinite(ageMonths) && ageMonths >= 0 ? ageMonths : 0;
}

function resolveDefaultAvatarBucket(
  gender: ChildProfile['gender'],
  ageMonths: number,
): keyof typeof DEFAULT_AVATAR_TUNING {
  const normalizedAgeMonths = normalizeAgeMonths(ageMonths);
  if (gender === 'female') {
    if (normalizedAgeMonths < 36) return 'female-0-3';
    if (normalizedAgeMonths < 72) return 'female-3-6';
    if (normalizedAgeMonths < 144) return 'female-6-12';
    return 'female-12-18';
  }
  if (normalizedAgeMonths < 36) return 'male-0-3';
  if (normalizedAgeMonths < 72) return 'male-3-6';
  if (normalizedAgeMonths < 144) return 'male-6-12';
  return 'male-12-18';
}

export function resolveDefaultChildAvatarSrc(
  gender: ChildProfile['gender'],
  ageMonths: number,
): string {
  switch (resolveDefaultAvatarBucket(gender, ageMonths)) {
    case 'female-0-3':
      return female03;
    case 'female-3-6':
      return female36;
    case 'female-6-12':
      return female612;
    case 'female-12-18':
      return female1218;
    case 'male-0-3':
      return male03;
    case 'male-3-6':
      return male36;
    case 'male-6-12':
      return male612;
    case 'male-12-18':
    default:
      return male1218;
  }
}

export function resolveChildAvatarSrc(
  child: ChildAvatarLike,
  ageMonths = computeAgeMonths(child.birthDate),
): string {
  if (child.avatarPath) {
    try {
      return convertFileSrc(child.avatarPath);
    } catch {
      return child.avatarPath;
    }
  }
  return resolveDefaultChildAvatarSrc(child.gender, ageMonths);
}

function resolveChildAvatarPresentation(
  child: ChildAvatarLike,
  ageMonths = computeAgeMonths(child.birthDate),
): { src: string; isDefault: boolean; tuning: DefaultAvatarTuning | null } {
  if (child.avatarPath) {
    return { src: resolveChildAvatarSrc(child, ageMonths), isDefault: false, tuning: null };
  }
  const bucket = resolveDefaultAvatarBucket(child.gender, ageMonths);
  return {
    src: resolveDefaultChildAvatarSrc(child.gender, ageMonths),
    isDefault: true,
    tuning: DEFAULT_AVATAR_TUNING[bucket],
  };
}

export function ChildAvatar({
  child,
  ageMonths,
  alt = '',
  className,
  style,
}: {
  child: ChildAvatarLike;
  ageMonths?: number;
  alt?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const presentation = resolveChildAvatarPresentation(child, ageMonths);
  return (
    <span
      className={className}
      style={{
        ...style,
        display: 'block',
        overflow: 'hidden',
        borderRadius: '9999px',
      }}
    >
      <img
        src={presentation.src}
        alt={alt}
        className="h-full w-full object-cover"
        style={{
          transform: presentation.isDefault && presentation.tuning
            ? `translateY(${presentation.tuning.translateY}) scale(${presentation.tuning.scale})`
            : undefined,
          transformOrigin: 'center center',
        }}
      />
    </span>
  );
}
