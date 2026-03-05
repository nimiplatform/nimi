import { useState } from 'react';
import type { LocalAiDependencyResolutionPlan } from '@runtime/local-ai-runtime';
import type { RuntimeDependencyTargetDescriptor } from '../../runtime-config-panel-types';
import { CAPABILITY_OPTIONS, type CapabilityOption } from './model-center-utils';

// Icons
function RefreshIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PackageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

// Button Component
function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  icon,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  const variantClass = variant === 'primary'
    ? 'bg-mint-500 text-white hover:bg-mint-600 disabled:bg-gray-300'
    : variant === 'secondary'
      ? 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:bg-gray-100'
      : 'text-gray-600 hover:bg-gray-50 disabled:text-gray-300';

  const sizeClass = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all disabled:cursor-not-allowed hover:shadow-sm ${variantClass} ${sizeClass}`}
    >
      {icon}
      {children}
    </button>
  );
}

export type ModelCenterDependencySectionProps = {
  isModMode: boolean;
  loadingDependencyPlan: boolean;
  selectedDependencyModId: string;
  dependencySelectionLocked: boolean;
  selectedDependencyTarget: RuntimeDependencyTargetDescriptor | null;
  selectedDependencyCapability: 'auto' | CapabilityOption;
  dependencyPlanPreview: LocalAiDependencyResolutionPlan | null;
  runtimeDependencyTargets: RuntimeDependencyTargetDescriptor[];
  onSetSelectedDependencyModId: (modId: string) => void;
  onSetSelectedDependencyCapability: (value: 'auto' | CapabilityOption) => void;
  onResolveDependencyPlanPreview: () => void;
  onApplyDependencies: (modId: string, capability?: string) => Promise<void>;
};

export function ModelCenterDependencySection(props: ModelCenterDependencySectionProps) {
  const [applyingDependencies, setApplyingDependencies] = useState(false);
  const [dependencyApplySummary, setDependencyApplySummary] = useState('');
  const dependencyDisplayKey = (dep: LocalAiDependencyResolutionPlan['dependencies'][number]): string => (
    String(dep.modelId || '').trim()
    || String(dep.dependencyId || '').trim()
    || 'dependency'
  );

  return (
    <div className="rounded-xl border border-sky-100 bg-sky-50/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PackageIcon className="h-4 w-4 text-sky-600" />
          <p className="text-sm font-semibold text-gray-900">
            {props.isModMode ? 'Model Dependencies' : 'Mod Dependencies'}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={props.loadingDependencyPlan || !props.selectedDependencyModId}
          onClick={() => void props.onResolveDependencyPlanPreview()}
          icon={<RefreshIcon />}
        >
          {props.loadingDependencyPlan ? 'Resolving...' : 'Resolve Plan'}
        </Button>
      </div>

      {props.runtimeDependencyTargets.length <= 0 ? (
        <p className="text-xs text-gray-500">No dependency-enabled runtime mod found.</p>
      ) : (
        <>
          <div className={`grid grid-cols-1 gap-3 ${props.dependencySelectionLocked ? '' : 'md:grid-cols-2'}`}>
            {props.dependencySelectionLocked ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Runtime Mod</label>
                <div className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 flex items-center">
                  {props.selectedDependencyTarget?.modName || props.selectedDependencyModId || 'Unknown runtime mod'}
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Runtime Mod</label>
                <select
                  value={props.selectedDependencyModId}
                  onChange={(event) => props.onSetSelectedDependencyModId(event.target.value)}
                  className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-mint-400 focus:ring-2 focus:ring-mint-100"
                >
                  {props.runtimeDependencyTargets.map((target) => (
                    <option key={`runtime-dep-${target.modId}`} value={target.modId}>{target.modName}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Capability</label>
              <select
                value={props.selectedDependencyCapability}
                onChange={(event) => props.onSetSelectedDependencyCapability((event.target.value || 'auto') as 'auto' | CapabilityOption)}
                className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-mint-400 focus:ring-2 focus:ring-mint-100"
              >
                <option value="auto">Auto Detect</option>
                {CAPABILITY_OPTIONS.map((capability) => (
                  <option key={`runtime-dep-capability-${capability}`} value={capability}>{capability}</option>
                ))}
              </select>
            </div>
          </div>

          {props.selectedDependencyTarget ? (
            <div className="flex flex-wrap gap-1.5">
              {(props.selectedDependencyTarget.consumeCapabilities || ['chat']).map((cap) => (
                <span key={cap} className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                  {cap}
                </span>
              ))}
            </div>
          ) : null}

          {props.dependencySelectionLocked && !props.selectedDependencyTarget ? (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Selected mod has no dependency declaration.</p>
          ) : null}

          {props.loadingDependencyPlan ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <RefreshIcon className="h-4 w-4 animate-spin" />
              Resolving dependency plan...
            </div>
          ) : props.dependencyPlanPreview ? (
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-600">
                  <CheckIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Plan ID: {props.dependencyPlanPreview.planId}</p>
                  <p className="text-xs text-gray-500">
                    {props.dependencyPlanPreview.dependencies.length} dependencies
                    {' · '}
                    {props.dependencyPlanPreview.dependencies.filter((item) => item.selected).length} selected
                    {' · '}
                    {props.dependencyPlanPreview.dependencies.filter((item) => item.required).length} required
                  </p>
                </div>
              </div>

              {props.dependencyPlanPreview.dependencies.length > 0 && (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {props.dependencyPlanPreview.dependencies.map((dep) => (
                    <div key={dependencyDisplayKey(dep)} className="flex items-center justify-between text-xs py-1">
                      <span className="text-gray-700">{dependencyDisplayKey(dep)}</span>
                      <div className="flex gap-1">
                        {dep.selected && (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                            Selected
                          </span>
                        )}
                        {dep.required && (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                            Required
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Button
                variant="primary"
                size="sm"
                disabled={applyingDependencies}
                onClick={() => {
                  void (async () => {
                    setApplyingDependencies(true);
                    try {
                      await props.onApplyDependencies(
                        props.selectedDependencyModId,
                        props.selectedDependencyCapability === 'auto'
                          ? undefined
                          : props.selectedDependencyCapability,
                      );
                      setDependencyApplySummary('Dependencies applied successfully.');
                    } catch (e) {
                      setDependencyApplySummary(e instanceof Error ? e.message : 'Failed to apply dependencies.');
                    } finally {
                      setApplyingDependencies(false);
                    }
                  })();
                }}
                icon={<CheckIcon />}
              >
                {applyingDependencies ? 'Applying...' : 'Apply Dependencies'}
              </Button>

              {dependencyApplySummary ? (
                <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{dependencyApplySummary}</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
