export type DesktopChatRouteRequestDto = {
  /**
   * Required for AGENT
   */
  agentId?: string;
  /**
   * Required for CONTACT/FRIEND
   */
  targetAccountId?: string;
  targetType: DesktopChatRouteRequestDto.targetType;
};

export namespace DesktopChatRouteRequestDto {
  export enum targetType {
    CONTACT = 'CONTACT',
    FRIEND = 'FRIEND',
    AGENT = 'AGENT',
  }
}

export type DesktopChatRouteResultDto = {
  channel: DesktopChatRouteResultDto.channel;
  providerSelectable: boolean;
  reason: string;
  sessionClass: DesktopChatRouteResultDto.sessionClass;
};

export namespace DesktopChatRouteResultDto {
  export enum channel {
    CLOUD = 'CLOUD',
    LOCAL = 'LOCAL',
  }

  export enum sessionClass {
    HUMAN_DIRECT = 'HUMAN_DIRECT',
    AGENT_LOCAL = 'AGENT_LOCAL',
  }
}

export function normalizeDesktopChatRouteTargetType(
  value: unknown,
): DesktopChatRouteRequestDto.targetType {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === DesktopChatRouteRequestDto.targetType.CONTACT) {
    return DesktopChatRouteRequestDto.targetType.CONTACT;
  }
  if (normalized === DesktopChatRouteRequestDto.targetType.FRIEND) {
    return DesktopChatRouteRequestDto.targetType.FRIEND;
  }
  return DesktopChatRouteRequestDto.targetType.AGENT;
}

export function isDesktopChatRouteTargetType(
  value: unknown,
): value is DesktopChatRouteRequestDto.targetType {
  return (
    value === DesktopChatRouteRequestDto.targetType.CONTACT ||
    value === DesktopChatRouteRequestDto.targetType.FRIEND ||
    value === DesktopChatRouteRequestDto.targetType.AGENT
  );
}

export function isDesktopChatRouteChannel(
  value: unknown,
): value is DesktopChatRouteResultDto.channel {
  return (
    value === DesktopChatRouteResultDto.channel.CLOUD ||
    value === DesktopChatRouteResultDto.channel.LOCAL
  );
}

export function normalizeDesktopChatRouteChannel(
  value: unknown,
): DesktopChatRouteResultDto.channel {
  return value === DesktopChatRouteResultDto.channel.LOCAL
    ? DesktopChatRouteResultDto.channel.LOCAL
    : DesktopChatRouteResultDto.channel.CLOUD;
}

export function isDesktopChatRouteSessionClass(
  value: unknown,
): value is DesktopChatRouteResultDto.sessionClass {
  return (
    value === DesktopChatRouteResultDto.sessionClass.HUMAN_DIRECT ||
    value === DesktopChatRouteResultDto.sessionClass.AGENT_LOCAL
  );
}

export function isDesktopChatRouteResultLike(
  value: unknown,
): value is DesktopChatRouteResultDto {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!isDesktopChatRouteChannel(record.channel)) {
    return false;
  }
  if (typeof record.providerSelectable !== 'boolean') {
    return false;
  }
  if (typeof record.reason !== 'string') {
    return false;
  }
  if (!isDesktopChatRouteSessionClass(record.sessionClass)) {
    return false;
  }
  return true;
}
