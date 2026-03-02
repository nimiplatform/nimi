import React from 'react';
import type { ContactRequestRecord } from './contacts-model.js';
import { getContactInitial } from './contacts-model.js';

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
          {request.avatarUrl ? (
            <img src={request.avatarUrl} alt={request.displayName} className="h-20 w-20 rounded-xl object-cover" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-blue-500 text-2xl font-medium text-white">
              {getContactInitial(request.displayName)}
            </div>
          )}
          <h2 className="mt-4 text-xl font-semibold text-gray-900">{request.displayName}</h2>
          {request.handle && (
            <p className="text-sm text-gray-500">{request.handle}</p>
          )}
          <span className={`mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
            request.direction === 'received'
              ? 'bg-blue-50 text-blue-600'
              : 'bg-amber-50 text-amber-600'
          }`}>
            {request.direction === 'received' ? 'Received' : 'Sent'}
          </span>
        </div>

        <div className="mt-6 p-4 bg-gray-50 rounded-xl">
          <p className="text-sm text-gray-600">{request.bio || 'Wants to add you as a friend'}</p>
        </div>

        <div className="mt-6 flex gap-3">
          {request.direction === 'received' ? (
            isAccepted ? (
              <div className="w-full py-3 rounded-full bg-green-100 text-green-700 text-[15px] font-medium text-center">
                Added
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onAccept}
                  className="flex-1 py-3 rounded-full bg-[#0066CC] text-white text-[15px] font-medium hover:bg-[#0052A3] transition-colors"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={onReject}
                  className="flex-1 py-3 rounded-full bg-gray-100 text-gray-700 text-[15px] font-medium hover:bg-gray-200 transition-colors"
                >
                  Reject
                </button>
              </>
            )
          ) : (
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-3 rounded-full bg-gray-100 text-gray-700 text-[15px] font-medium hover:bg-gray-200 transition-colors"
            >
              Withdraw Request
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
    <div className="flex-1 bg-[#F0F4F8] overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex gap-6">
          {/* 请求列表 - 全宽显示 */}
          <div className="flex-1 min-w-0 w-full">
            <div className="rounded-3xl border border-white/60 bg-white/40 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
              <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-[#4ECCA3]/5 pointer-events-none rounded-3xl" />

              <div className="relative">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">
                  Friend Requests ({pendingCount})
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
                        {request.avatarUrl ? (
                          <img
                            src={request.avatarUrl}
                            alt={request.displayName}
                            className="h-14 w-14 rounded-2xl object-cover bg-gray-100"
                          />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-400 to-blue-500 text-lg font-medium text-white">
                            {getContactInitial(request.displayName)}
                          </div>
                        )}

                        {/* 名字和留言 */}
                        <div className="flex-1 min-w-0">
                          <div className="text-[15px] font-semibold text-gray-900">{request.displayName}</div>
                          <p className="text-[13px] text-gray-500 truncate mt-0.5">
                            {request.bio || 'Wants to add you as a friend'}
                          </p>
                        </div>

                        {/* 操作按钮 - 右侧 */}
                        <div className="shrink-0 flex items-center gap-2">
                          {isAccepted ? (
                            // 已接受 - 显示 "Added"
                            <span className="px-3 py-1.5 text-sm font-medium text-green-600 bg-green-50 rounded-lg">Added</span>
                          ) : isRejected ? (
                            // 已拒绝 - 显示 "Rejected"
                            <span className="px-3 py-1.5 text-sm font-medium text-gray-400 bg-gray-100 rounded-lg">Rejected</span>
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
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onReject(request);
                                }}
                                className="px-4 py-2 text-sm font-medium bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-colors"
                              >
                                Reject
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
                    <p className="text-sm">No friend requests</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
