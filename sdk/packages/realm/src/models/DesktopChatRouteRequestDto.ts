/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
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

