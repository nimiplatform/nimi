import type { DesktopChatRouteResultDto } from '@runtime/chat';

export type TurnExecutionContext = {
  route: DesktopChatRouteResultDto | null;
  requestId: string;
  sessionId: string;
};

