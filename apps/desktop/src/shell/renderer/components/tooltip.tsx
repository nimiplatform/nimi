import type { ReactNode } from 'react';
import {
  Tooltip as NimiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@nimiplatform/nimi-kit/ui';

export type SharedTooltipProps = {
  children: ReactNode;
  content: ReactNode;
  placement?: 'top' | 'bottom';
  className?: string;
  contentClassName?: string;
};

export function Tooltip(props: SharedTooltipProps) {
  return <NimiTooltip {...props} />;
}

export { TooltipContent, TooltipProvider, TooltipTrigger };
