import { TurnInput } from './turn-input';

type HumanConversationComposerProps = {
  onOpenGift?: () => void;
};

export function HumanConversationComposer(props: HumanConversationComposerProps) {
  return (
    <TurnInput
      className="h-full"
      showTopBorder={false}
      onOpenGift={props.onOpenGift}
    />
  );
}
