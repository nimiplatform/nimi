import React from 'react';
import { i18n } from '@renderer/i18n';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import type { ContactRequestRecord } from './contacts-model.js';

// 单个好友请求详情组件
export function FriendRequestDetail({
  request,
  isAccepted,
  onAccept,
  onReject,
  onCancel
}: {
  request: ContactRequestRecord;
  isAccepted: boolean;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-white">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm p-8">
        <div className="flex flex-col items-center">
          <EntityAvatar
            imageUrl={request.avatarUrl}
            name={request.displayName}
            kind={request.isAgent ? 'agent' : 'human'}
            sizeClassName="h-20 w-20"
            radiusClassName={request.isAgent ? 'rounded-[10px]' : undefined}
            innerRadiusClassName={request.isAgent ? 'rounded-[8px]' : undefined}
            textClassName="text-2xl font-medium"
          />
          <h2 className="mt-4 text-xl font-semibold text-gray-900">{request.displayName}</h2>
          {request.handle && (
            <p className="text-sm text-gray-500">{request.handle}</p>
          )}
          <span className={`mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
            request.direction === 'received'
              ? 'bg-blue-50 text-blue-600'
              : 'bg-amber-50 text-amber-600'
          }`}>
            {request.direction === 'received'
              ? i18n.t('Contacts.requestReceived', { defaultValue: 'Received' })
              : i18n.t('Contacts.requestSent', { defaultValue: 'Sent' })}
          </span>
        </div>

        <div className="mt-6 p-4 bg-gray-50 rounded-xl">
          <p className="text-sm text-gray-600">
            {request.requestMessage || request.bio || i18n.t('Contacts.requestFallbackBio', { defaultValue: 'Wants to add you as a friend' })}
          </p>
        </div>

        <div className="mt-6 flex gap-3">
          {request.direction === 'received' ? (
            isAccepted ? (
              <div className="w-full py-3 rounded-full bg-green-100 text-green-700 text-[15px] font-medium text-center">
                {i18n.t('Contacts.added', { defaultValue: 'Added' })}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onAccept}
                  className="flex-1 py-3 rounded-full bg-[#0066CC] text-white text-[15px] font-medium hover:bg-[#0052A3] transition-colors"
                >
                  {i18n.t('Contacts.accept', { defaultValue: 'Accept' })}
                </button>
                <button
                  type="button"
                  onClick={onReject}
                  className="flex-1 py-3 rounded-full bg-gray-100 text-gray-700 text-[15px] font-medium hover:bg-gray-200 transition-colors"
                >
                  {i18n.t('Contacts.reject', { defaultValue: 'Reject' })}
                </button>
              </>
            )
          ) : (
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-3 rounded-full bg-gray-100 text-gray-700 text-[15px] font-medium hover:bg-gray-200 transition-colors"
            >
              {i18n.t('Contacts.withdrawRequest', { defaultValue: 'Withdraw Request' })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// 好友请求列表组件 - 类似微信"新的朋友"样式
export function FriendRequestsList({
  requests,
  acceptedRequests,
  rejectedRequests,
  onAccept,
  onReject
}: {
  requests: ContactRequestRecord[];
  acceptedRequests: Set<string>;
  rejectedRequests: Set<string>;
  onAccept: (req: ContactRequestRecord) => void;
  onReject: (req: ContactRequestRecord) => void;
}) {
  // 按时间排序（最新的在前）
  const sortedRequests = [...requests].sort((a, b) => {
    const timeA = a.requestedAt ? new Date(a.requestedAt).getTime() : 0;
    const timeB = b.requestedAt ? new Date(b.requestedAt).getTime() : 0;
    return timeB - timeA;
  });

  const pendingCount = sortedRequests.filter(r => !acceptedRequests.has(r.userId) && !rejectedRequests.has(r.userId)).length;

  return (
      <ScrollShell
        className="flex-1 bg-[#F0F4F8]"
        viewportClassName="bg-[#F0F4F8]"
        contentClassName="mx-auto max-w-6xl px-6 py-6"
      >
        <div className="flex gap-6">
          {/* 请求列表 - 全宽显示 */}
          <div className="flex-1 min-w-0 w-full">
            <div className="rounded-3xl border border-white/60 bg-white/40 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
              <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-[#4ECCA3]/5 pointer-events-none rounded-3xl" />

              <div className="relative">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">
                  {i18n.t('Contacts.friendRequestsCount', {
                    count: pendingCount,
                    defaultValue: 'Friend Requests ({{count}})',
                  })}
                </h3>

                {/* 请求列表 */}
                <div className="space-y-3">
                  {sortedRequests.map((request) => {
                    const isAccepted = acceptedRequests.has(request.userId);
                    const isRejected = rejectedRequests.has(request.userId);
                    return (
                      <div
                        key={`${request.direction}:${request.userId}`}
                        className="flex items-center gap-4 p-4 rounded-2xl bg-white/60 border border-white/60 transition-all hover:bg-white/80"
                      >
                        {/* 头像 */}
                        <EntityAvatar
                          imageUrl={request.avatarUrl}
                          name={request.displayName}
                          kind={request.isAgent ? 'agent' : 'human'}
                          sizeClassName="h-14 w-14"
                          radiusClassName={request.isAgent ? 'rounded-[10px]' : undefined}
                          innerRadiusClassName={request.isAgent ? 'rounded-[8px]' : undefined}
                          textClassName="text-lg font-medium"
                        />

                        {/* 名字和留言 */}
                        <div className="flex-1 min-w-0">
                          <div className="text-[15px] font-semibold text-gray-900">{request.displayName}</div>
                          <p className="text-[13px] text-gray-500 truncate mt-0.5">
                            {request.requestMessage || request.bio || i18n.t('Contacts.requestFallbackBio', { defaultValue: 'Wants to add you as a friend' })}
                          </p>
                        </div>

                        {/* 操作按钮 - 右侧 */}
                        <div className="shrink-0 flex items-center gap-2">
                          {isAccepted ? (
                            // 已接受 - 显示 "Added"
                            <span className="px-3 py-1.5 text-sm font-medium text-green-600 bg-green-50 rounded-lg">
                              {i18n.t('Contacts.added', { defaultValue: 'Added' })}
                            </span>
                          ) : isRejected ? (
                            // 已拒绝 - 显示 "Rejected"
                            <span className="px-3 py-1.5 text-sm font-medium text-gray-400 bg-gray-100 rounded-lg">
                              {i18n.t('Contacts.rejected', { defaultValue: 'Rejected' })}
                            </span>
                          ) : (
                            // 待处理 - 显示 Accept 和 Reject 按钮
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAccept(request);
                                }}
                                className="px-4 py-2 text-sm font-medium bg-[#4ECCA3] text-white rounded-xl hover:bg-[#3DBA92] transition-all shadow-[0_4px_14px_rgba(78,204,163,0.35)] hover:shadow-[0_6px_20px_rgba(78,204,163,0.45)] active:scale-95"
                              >
                                {i18n.t('Contacts.accept', { defaultValue: 'Accept' })}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onReject(request);
                                }}
                                className="px-4 py-2 text-sm font-medium bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-colors"
                              >
                                {i18n.t('Contacts.reject', { defaultValue: 'Reject' })}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 空状态 */}
                {sortedRequests.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-50">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    </svg>
                    <p className="text-sm">
                      {i18n.t('Contacts.noFriendRequests', { defaultValue: 'No friend requests' })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </ScrollShell>
  );
}
