import { EntityAvatar } from '@renderer/components/entity-avatar';

export type ChatComposerLeadingAvatarProps = {
  name: string;
  imageUrl?: string | null;
  fallbackLabel?: string | null;
  kind: 'agent' | 'human';
};

export function ChatComposerLeadingAvatar(props: ChatComposerLeadingAvatarProps) {
  const resolvedName = props.name.trim() || props.fallbackLabel?.trim() || '?';
  return (
    <div
      data-chat-composer-leading-avatar="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      <EntityAvatar
        imageUrl={props.imageUrl || null}
        name={resolvedName}
        kind={props.kind}
        sizeClassName="h-9 w-9"
        className="shadow-[0_8px_18px_rgba(15,23,42,0.12)]"
        textClassName="text-[11px] font-semibold"
      />
    </div>
  );
}
