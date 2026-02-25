/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Visibility } from './Visibility';
export type UpdateAgentVisibilityDto = {
    /**
     * Account discoverability visibility
     */
    accountVisibility?: Visibility;
    /**
     * Default post visibility for new posts
     */
    defaultPostVisibility?: Visibility;
    /**
     * Direct message visibility
     */
    dmVisibility?: Visibility;
    /**
     * Profile information visibility
     */
    profileVisibility?: Visibility;
};

