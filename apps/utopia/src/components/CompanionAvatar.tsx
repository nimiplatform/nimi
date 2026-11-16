import { useEffect, useState } from 'react';

export type CompanionPresenceTone = 'conversing' | 'shared' | 'active' | 'solitary' | 'resting';

const AVATAR_PALETTE = [
  '#2E6F8E',
  '#4A7C59',
  '#9E6240',
  '#5E548E',
  '#3D5A80',
  '#7F6A4F',
] as const;

function pickAvatarTint(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]!;
}

export function avatarMonogram(displayName: string): string {
  const trimmed = displayName.trim();
  const cps = Array.from(trimmed);
  return cps[0] ?? '伴';
}

export function CompanionAvatar(props: {
  readonly displayName: string;
  readonly agentHandle?: string;
  readonly avatarUrl?: string | null;
  readonly size?: 'xs' | 'sm' | 'md' | 'lg';
  readonly presenceTone?: CompanionPresenceTone;
  readonly className?: string;
}) {
  const {
    displayName,
    agentHandle,
    avatarUrl,
    size = 'sm',
    presenceTone,
    className = '',
  } = props;

  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [avatarUrl]);

  const showImg = Boolean(avatarUrl) && !imgFailed;
  const bg = pickAvatarTint(agentHandle ?? displayName);

  return (
    <span
      className={[
        'utopia-companion-avatar',
        `size-${size}`,
        presenceTone ? `tone-${presenceTone}` : '',
        className,
      ].filter(Boolean).join(' ')}
      style={!showImg ? ({ '--utopia-avatar-tint': bg } as React.CSSProperties) : undefined}
      aria-hidden="true"
    >
      {showImg ? (
        <img
          src={avatarUrl!}
          alt=""
          loading="lazy"
          draggable={false}
          className="utopia-companion-avatar-img"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className="utopia-companion-avatar-initial">{avatarMonogram(displayName)}</span>
      )}
      {presenceTone && <span className={`utopia-presence-dot is-${presenceTone}`} />}
    </span>
  );
}
