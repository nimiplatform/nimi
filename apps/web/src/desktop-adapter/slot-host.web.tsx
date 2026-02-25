import type { ReactNode } from 'react';
import type { UiExtensionContext, UiSlotId } from '@renderer/mod-ui/contracts';

type SlotHostProps = {
  slot: UiSlotId;
  base: ReactNode;
  context: UiExtensionContext;
};

export function SlotHost(props: SlotHostProps) {
  return <>{props.base}</>;
}
