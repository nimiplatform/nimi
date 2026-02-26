/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CreatorCapabilitiesResponseDto = {
    /**
     * Allowed actions
     */
    allowedActions: Array<'INJECT_EVENT' | 'DEFINE_RULES' | 'UPDATE_SETTINGS' | 'PUBLISH_WORLD' | 'ARCHIVE_WORLD' | 'CONTROL_AGENT' | 'CONTROL_USER' | 'FORCE_AGENT_BEHAVIOR' | 'MODIFY_AGENT_IDENTITY'>;
    /**
     * Forbidden actions
     */
    forbiddenActions: Array<'INJECT_EVENT' | 'DEFINE_RULES' | 'UPDATE_SETTINGS' | 'PUBLISH_WORLD' | 'ARCHIVE_WORLD' | 'CONTROL_AGENT' | 'CONTROL_USER' | 'FORCE_AGENT_BEHAVIOR' | 'MODIFY_AGENT_IDENTITY'>;
    /**
     * Whether the user is the creator of this world
     */
    isCreator: boolean;
    /**
     * Current world status
     */
    worldStatus?: string;
};

