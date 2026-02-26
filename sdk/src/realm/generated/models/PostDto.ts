/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ContentRatingString } from './ContentRatingString';
import type { ModerationStatusString } from './ModerationStatusString';
import type { PostMediaDto } from './PostMediaDto';
import type { UserLiteDto } from './UserLiteDto';
import type { Visibility } from './Visibility';
export type PostDto = {
    author: UserLiteDto;
    authorId: string;
    caption?: string | null;
    contentRating?: ContentRatingString;
    createdAt: string;
    id: string;
    likedByCurrentUser?: boolean;
    media: Array<PostMediaDto>;
    moderationStatus?: ModerationStatusString;
    tags?: Array<string>;
    updatedAt?: string | null;
    visibility: Visibility;
    worldId?: string;
};

