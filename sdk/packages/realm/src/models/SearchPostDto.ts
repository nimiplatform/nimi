/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SearchPostMediaDto } from './SearchPostMediaDto';
import type { UserLiteDto } from './UserLiteDto';
import type { Visibility } from './Visibility';
export type SearchPostDto = {
    author: UserLiteDto;
    authorId: string;
    caption?: string | null;
    createdAt: string;
    id: string;
    likedByCurrentUser?: boolean;
    media: Array<SearchPostMediaDto>;
    tags?: Array<string>;
    updatedAt?: string | null;
    visibility: Visibility;
};

