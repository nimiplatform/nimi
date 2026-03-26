import { Avatar } from '@nimiplatform/nimi-kit/ui';

type EntityAvatarProps = {
  imageUrl?: string | null;
  name: string;
  kind: 'agent' | 'human';
  sizeClassName?: string;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
  radiusClassName?: string;
  innerRadiusClassName?: string;
  textClassName?: string;
};

const AGENT_BORDER_STYLE = {
  background: 'linear-gradient(135deg, #c084fc 0%, #a855f7 45%, #7c3aed 100%)',
  boxShadow:
    '0 0 0 1px rgba(192,132,252,0.55), 0 0 10px rgba(168,85,247,0.35), 0 0 18px rgba(124,58,237,0.22)',
} as const;

export function EntityAvatar(props: EntityAvatarProps) {
  const sizeClassName = props.sizeClassName || 'h-10 w-10';
  const radiusClassName =
    props.radiusClassName || (props.kind === 'agent' ? 'rounded-[12px]' : 'rounded-full');
  const innerRadiusClassName =
    props.innerRadiusClassName || (props.kind === 'agent' ? 'rounded-[10px]' : 'rounded-full');

  if (props.kind === 'agent') {
    return (
      <div
        className={`${sizeClassName} ${radiusClassName} overflow-hidden p-[2px] ${props.className || ''}`.trim()}
        style={AGENT_BORDER_STYLE}
      >
        <Avatar
          src={props.imageUrl}
          alt={props.name}
          shape="rounded"
          tone="accent"
          className={`h-full w-full ${innerRadiusClassName} ${props.imageClassName || ''}`.trim()}
          fallbackClassName={`${props.fallbackClassName || ''} ${props.textClassName || ''}`.trim() || undefined}
        />
      </div>
    );
  }

  return (
    <Avatar
      src={props.imageUrl}
      alt={props.name}
      shape="circle"
      tone="neutral"
      className={`${sizeClassName} ${radiusClassName} ${props.className || ''} ${props.imageClassName || ''}`.trim()}
      fallbackClassName={`${props.fallbackClassName || ''} ${props.textClassName || ''}`.trim() || undefined}
    />
  );
}
