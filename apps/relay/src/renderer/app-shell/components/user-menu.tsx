// User avatar dropdown menu with logout

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../providers/app-store.js';
import { getBridge } from '../../bridge/electron-bridge.js';

export function UserMenu() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.currentUser);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleLogout = async () => {
    setOpen(false);
    try {
      const bridge = getBridge();
      await bridge.auth.logout();
    } catch {
      // Auth state change will be pushed by main process via onStatus
    }
    useAppStore.getState().setCurrentUser(null);
    useAppStore.getState().setAuthState('pending');
  };

  const displayName = user?.displayName ?? '?';
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full hover:bg-gray-800 transition-colors p-0.5"
        title={displayName}
      >
        {user?.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={displayName}
            className="w-7 h-7 rounded-full object-cover"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-300">
            {initials}
          </div>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-52 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
          {/* User info section */}
          <div className="px-3 py-2.5 border-b border-gray-700">
            <div className="text-sm font-medium text-white truncate">{displayName}</div>
            {user?.handle && (
              <div className="text-xs text-gray-400 truncate">@{user.handle}</div>
            )}
            {user?.email && !user.handle && (
              <div className="text-xs text-gray-400 truncate">{user.email}</div>
            )}
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-gray-800 transition-colors"
          >
            {t('user.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
