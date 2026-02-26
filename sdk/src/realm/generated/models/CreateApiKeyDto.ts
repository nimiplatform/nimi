/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiKeyType } from './ApiKeyType';
export type CreateApiKeyDto = {
    /**
     * Friendly label for the API Key
     */
    label: string;
    /**
     * List of scopes (e.g. agent:provision)
     */
    scopes?: Array<string>;
    type?: ApiKeyType;
};

