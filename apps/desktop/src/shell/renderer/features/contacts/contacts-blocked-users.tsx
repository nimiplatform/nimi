import React from 'react';
import type { ContactRecord } from './contacts-model.js';
import { getContactInitial } from './contacts-model.js';

// ---------- Blocked users list (inside category accordion) ----------

export function BlockedUsersList({
  contacts,
  currentContactId,
  onSelect,
  onUnblock,
}: {
  contacts: ContactRecord[];
  currentContactId: string | null;
  onSelect: (contact: ContactRecord) => void;
  onUnblock: (contact: ContactRecord) => void;
}) {
  if (contacts.length === 0) {
    return <div className="px-4 py-3 text-sm text-gray-400">No blocked contacts</div>;
  }

  return (
    <>
      {contacts.map((contact) => (
        <button
          key={contact.id}
          type="button"
          onClick={() => onSelect(contact)}
          className={`flex w-full items-center gap-3 px-3 py-2.5 mx-1 text-left rounded-lg transition-all duration-150 ${
            currentContactId === contact.id
              ? 'bg-green-100 text-green-800'
              : 'hover:bg-green-50/50 text-gray-700'
          }`}
        >
          {contact.avatarUrl ? (
            <img
              src={contact.avatarUrl}
              alt={contact.displayName}
              className="h-10 w-10 rounded-lg object-cover"
              style={contact.isAgent ? {
                boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4)'
              } : undefined}
            />
          ) : (
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium ${
                contact.isAgent
                  ? 'bg-gradient-to-br from-[#4ECCA3] to-[#3DBB94] text-white'
                  : 'bg-gradient-to-br from-green-400 to-green-500 text-white'
              }`}
              style={contact.isAgent ? {
                boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4)'
              } : undefined}
            >
              {getContactInitial(contact.displayName)}
            </div>
          )}
          <div className="flex-1 min-w-0 text-left">
            <div className="text-[15px] text-gray-900 truncate">{contact.displayName}</div>
          </div>
          {/* 恢复按钮 */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUnblock(contact);
            }}
            className="px-3 py-1.5 text-xs font-medium bg-[#4ECCA3] text-white rounded-lg hover:bg-[#3DBA92] transition-colors"
          >
            Restore
          </button>
        </button>
      ))}
    </>
  );
}

// ---------- Block confirmation dialog ----------

export function BlockConfirmDialog({
  contact,
  onConfirm,
  onCancel,
}: {
  contact: ContactRecord;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Block Contact</h3>
        <p className="text-sm text-gray-500 mb-6">
          Are you sure you want to block <span className="font-medium text-gray-700">{contact.displayName}</span>? They will be moved to Blocks.
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2 rounded-full text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-5 py-2 rounded-full text-sm font-medium bg-gray-700 text-white hover:bg-gray-800 transition-colors"
          >
            Block
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Unblock / restore confirmation dialog ----------

export function UnblockConfirmDialog({
  contact,
  onConfirm,
  onCancel,
}: {
  contact: ContactRecord;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Restore Contact</h3>
        <p className="text-sm text-gray-500 mb-6">
          Restore <span className="font-medium text-gray-700">{contact.displayName}</span> to their previous category?
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2 rounded-full text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-[#4ECCA3] text-white hover:bg-[#3DBA92] transition-colors"
          >
            Restore
          </button>
        </div>
      </div>
    </div>
  );
}
