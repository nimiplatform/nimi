/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type PermissionCheckResponseDto = {
    /**
     * Action type
     */
    action?: PermissionCheckResponseDto.action;
    /**
     * Whether the action is allowed
     */
    allowed: boolean;
    /**
     * Creator ID
     */
    creatorId?: string;
    /**
     * Reason if not allowed
     */
    reason?: string;
    /**
     * World ID
     */
    worldId?: string;
};
export namespace PermissionCheckResponseDto {
    /**
     * Action type
     */
    export enum action {
        INJECT_EVENT = 'INJECT_EVENT',
        DEFINE_RULES = 'DEFINE_RULES',
        UPDATE_SETTINGS = 'UPDATE_SETTINGS',
        PUBLISH_WORLD = 'PUBLISH_WORLD',
        ARCHIVE_WORLD = 'ARCHIVE_WORLD',
        CONTROL_AGENT = 'CONTROL_AGENT',
        CONTROL_USER = 'CONTROL_USER',
        FORCE_AGENT_BEHAVIOR = 'FORCE_AGENT_BEHAVIOR',
        MODIFY_AGENT_IDENTITY = 'MODIFY_AGENT_IDENTITY',
    }
}

