/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PostMediaType } from './PostMediaType';
import type { PostTrimDto } from './PostTrimDto';
export type CreatePostMediaDto = {
    duration?: number;
    id: string;
    thumbnail?: string;
    trim?: PostTrimDto;
    type: PostMediaType;
};

