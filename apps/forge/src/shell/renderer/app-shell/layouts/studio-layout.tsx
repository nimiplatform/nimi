import { Outlet } from 'react-router-dom';
import { Sidebar } from './sidebar.js';

export function StudioLayout() {
  return (
    <div className="flex h-screen w-screen bg-neutral-950 text-white overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
