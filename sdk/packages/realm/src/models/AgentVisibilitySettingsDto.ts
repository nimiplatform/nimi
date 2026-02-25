/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Visibility } from './Visibility';
export type AgentVisibilitySettingsDto = {
    /**
     * Account discoverability visibility
     */
    accountVisibility: Visibility;
    /**
     * Default post visibility for new posts
     */
    defaultPostVisibility: Visibility;
    /**
     * Direct message visibility
     */
    dmVisibility: Visibility;
    /**
     * Legacy: is agent public (deprecated, use accountVisibility instead)
     */
    isPublicLegacy: boolean;
    /**
     * Profile information visibility
     */
    profileVisibility: Visibility;
};

