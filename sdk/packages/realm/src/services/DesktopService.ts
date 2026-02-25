/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesktopChatRouteRequestDto } from '../models/DesktopChatRouteRequestDto';
import type { DesktopChatRouteResultDto } from '../models/DesktopChatRouteResultDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class DesktopService {
    /**
     * Resolve desktop chat route
     * Returns CLOUD for human direct chats and PRIVATE for agent local chats.
     * @param requestBody
     * @returns DesktopChatRouteResultDto
     * @throws ApiError
     */
    public static desktopControllerResolveChatRoute(
        requestBody: DesktopChatRouteRequestDto,
    ): CancelablePromise<DesktopChatRouteResultDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/desktop/chat/route',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
