import { Outlet } from 'react-router-dom';
import { Sidebar } from './sidebar.js';

export function StudioLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]">
      <Sidebar />
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
