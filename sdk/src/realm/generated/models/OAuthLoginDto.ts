/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OAuthProvider } from './OAuthProvider';
export type OAuthLoginDto = {
    accessToken?: string;
    code?: string;
    codeVerifier?: string;
    idToken?: string;
    provider: OAuthProvider;
    redirectUri?: string;
};

