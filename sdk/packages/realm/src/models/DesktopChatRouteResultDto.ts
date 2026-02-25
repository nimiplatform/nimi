/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DesktopChatRouteResultDto = {
    channel: DesktopChatRouteResultDto.channel;
    providerSelectable: boolean;
    reason: string;
    sessionClass: DesktopChatRouteResultDto.sessionClass;
};
export namespace DesktopChatRouteResultDto {
    export enum channel {
        CLOUD = 'CLOUD',
        PRIVATE = 'PRIVATE',
    }
    export enum sessionClass {
        HUMAN_DIRECT = 'HUMAN_DIRECT',
        AGENT_LOCAL = 'AGENT_LOCAL',
    }
}

