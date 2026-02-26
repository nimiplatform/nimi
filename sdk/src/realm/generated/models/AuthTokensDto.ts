/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UserPrivateDto } from './UserPrivateDto';
export type AuthTokensDto = {
    accessToken: string;
    expiresIn: number;
    refreshToken?: string | null;
    tokenType: string;
    user?: UserPrivateDto;
};

