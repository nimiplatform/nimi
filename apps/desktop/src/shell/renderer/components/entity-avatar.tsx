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

function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export function EntityAvatar(props: EntityAvatarProps) {
  const sizeClassName = props.sizeClassName || 'h-10 w-10';
  const radiusClassName = props.radiusClassName || (props.kind === 'agent' ? 'rounded-[12px]' : 'rounded-full');
  const innerRadiusClassName = props.innerRadiusClassName || (props.kind === 'agent' ? 'rounded-[10px]' : 'rounded-full');

  if (props.kind === 'agent') {
    return (
      <div
        className={`${sizeClassName} ${radiusClassName} overflow-hidden p-[2px] ${props.className || ''}`.trim()}
        style={{
          background: 'linear-gradient(135deg, #c084fc 0%, #a855f7 45%, #7c3aed 100%)',
          boxShadow: '0 0 0 1px rgba(192,132,252,0.55), 0 0 10px rgba(168,85,247,0.35), 0 0 18px rgba(124,58,237,0.22)',
        }}
      >
        {props.imageUrl ? (
          <img
            src={props.imageUrl}
            alt={props.name}
            className={`h-full w-full object-cover ${innerRadiusClassName} ${props.imageClassName || ''}`.trim()}
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center ${innerRadiusClassName} bg-gradient-to-br from-[#7c3aed] via-[#9333ea] to-[#c084fc] font-semibold text-white ${props.fallbackClassName || ''} ${props.textClassName || ''}`.trim()}
          >
            {getInitial(props.name)}
          </div>
        )}
      </div>
    );
  }

  return props.imageUrl ? (
    <img
      src={props.imageUrl}
      alt={props.name}
      className={`${sizeClassName} ${radiusClassName} object-cover ${props.className || ''} ${props.imageClassName || ''}`.trim()}
    />
  ) : (
    <div
      className={`flex items-center justify-center ${sizeClassName} ${radiusClassName} bg-gradient-to-br from-gray-100 to-gray-200 font-semibold text-gray-600 ${props.className || ''} ${props.fallbackClassName || ''} ${props.textClassName || ''}`.trim()}
    >
      {getInitial(props.name)}
    </div>
  );
}
