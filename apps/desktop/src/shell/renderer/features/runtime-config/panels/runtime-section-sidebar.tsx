import type { RuntimeDependencyTargetDescriptor } from '../runtime-config-panel-types';

type RuntimeSectionSidebarProps = {
  dependencyTargets: RuntimeDependencyTargetDescriptor[];
  activeTargetId: string;
  onSelectRuntime: () => void;
  onSelectEaa: () => void;
  onSelectDependencyMod: (modId: string) => void;
};

export function RuntimeSectionSidebar({
  dependencyTargets,
  activeTargetId,
  onSelectRuntime,
  onSelectEaa,
  onSelectDependencyMod,
}: RuntimeSectionSidebarProps) {
  const runtimeActive = activeTargetId === 'runtime';
  const eaaActive = activeTargetId === 'eaa';

  return (
    <nav className="flex flex-col px-3 pt-4">
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={onSelectRuntime}
          className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm transition-colors ${
            runtimeActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <div className="flex-1 min-w-0">
            <span className="block">Runtime</span>
            <span className={`block text-[11px] ${runtimeActive ? 'text-brand-600/70' : 'text-gray-400'}`}>
              Global AI configuration
            </span>
          </div>
        </button>
        <button
          type="button"
          onClick={onSelectEaa}
          className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm transition-colors ${
            eaaActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <div className="flex-1 min-w-0">
            <span className="block">EAA</span>
            <span className={`block text-[11px] ${eaaActive ? 'text-brand-600/70' : 'text-gray-400'}`}>
              External Agent Access
            </span>
          </div>
        </button>
        {dependencyTargets.map((target) => {
          const active = activeTargetId === target.modId;
          return (
            <button
              key={target.modId}
              type="button"
              onClick={() => onSelectDependencyMod(target.modId)}
              className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm transition-colors ${
                active ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <div className="flex-1 min-w-0">
                <span className="block truncate">{target.modName}</span>
                <span className={`block text-[11px] ${active ? 'text-brand-600/70' : 'text-gray-400'}`}>
                  {target.consumeCapabilities.join('/')}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
