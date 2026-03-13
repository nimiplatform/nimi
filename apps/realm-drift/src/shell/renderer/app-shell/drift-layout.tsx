import { Outlet } from 'react-router-dom';

export function DriftLayout() {
  return (
    <div className="flex h-screen w-screen bg-neutral-950 text-white overflow-hidden">
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
