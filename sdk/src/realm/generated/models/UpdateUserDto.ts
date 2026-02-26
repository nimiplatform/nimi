/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Gender } from './Gender';
export type UpdateUserDto = {
    /**
     * Avatar URL
     */
    avatarUrl?: string;
    /**
     * User biography
     */
    bio?: string;
    /**
     * Birth year
     */
    birthYear?: number;
    /**
     * City name
     */
    city?: string;
    /**
     * Country code (ISO 3166-1 alpha-2)
     */
    countryCode?: string;
    /**
     * Display name of the user
     */
    displayName?: string;
    /**
     * Gender
     */
    gender?: Gender;
    /**
     * Spoken languages
     */
    languages?: Array<string>;
    /**
     * User tags/interests
     */
    tags?: Array<string>;
};

