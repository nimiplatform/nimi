import { useState } from 'react';
import type { LocalAiDependencyResolutionPlan } from '@runtime/local-ai-runtime';
import type { RuntimeDependencyTargetDescriptor } from '../../runtime-config-panel-types';
import { Button } from '../primitives';
import { CAPABILITY_OPTIONS, type CapabilityOption } from './model-center-utils';

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

  return (
    <div className="space-y-3 rounded-[10px] border border-sky-100 bg-sky-50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-sky-900">
          {props.isModMode ? 'Model Dependencies (Resolve + Apply)' : 'Mod Dependencies (Resolve + Apply)'}
        </p>
        <Button
          variant="secondary"
          size="sm"
          disabled={props.loadingDependencyPlan || !props.selectedDependencyModId}
          onClick={() => void props.onResolveDependencyPlanPreview()}
        >
          {props.loadingDependencyPlan ? 'Resolving...' : 'Resolve Plan'}
        </Button>
      </div>
      {props.runtimeDependencyTargets.length <= 0 ? (
        <p className="text-[11px] text-sky-800">No dependency-enabled runtime mod found.</p>
      ) : (
        <>
          <div className={`grid grid-cols-1 gap-2 ${props.dependencySelectionLocked ? '' : 'md:grid-cols-2'}`}>
            {props.dependencySelectionLocked ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-sky-900">Runtime Mod</label>
                <div className="h-[46px] w-full rounded-[10px] border border-sky-200 bg-white px-3 text-sm text-sky-900 flex items-center">
                  {props.selectedDependencyTarget?.modName || props.selectedDependencyModId || 'Unknown runtime mod'}
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-sky-900">Runtime Mod</label>
                <select
                  value={props.selectedDependencyModId}
                  onChange={(event) => props.onSetSelectedDependencyModId(event.target.value)}
                  className="h-[46px] w-full rounded-[10px] border border-sky-200 bg-white px-3 text-sm text-sky-900 outline-none"
                >
                  {props.runtimeDependencyTargets.map((target) => (
                    <option key={`runtime-dep-${target.modId}`} value={target.modId}>{target.modName}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-sky-900">Capability</label>
              <select
                value={props.selectedDependencyCapability}
                onChange={(event) => props.onSetSelectedDependencyCapability((event.target.value || 'auto') as 'auto' | CapabilityOption)}
                className="h-[46px] w-full rounded-[10px] border border-sky-200 bg-white px-3 text-sm text-sky-900 outline-none"
              >
                <option value="auto">auto</option>
                {CAPABILITY_OPTIONS.map((capability) => (
                  <option key={`runtime-dep-capability-${capability}`} value={capability}>{capability}</option>
                ))}
              </select>
            </div>
          </div>
          {props.selectedDependencyTarget ? (
            <p className="text-[11px] text-sky-800">
              consume={props.selectedDependencyTarget.consumeCapabilities.join(', ') || 'chat'}
            </p>
          ) : null}
          {props.dependencySelectionLocked && !props.selectedDependencyTarget ? (
            <p className="text-[11px] text-amber-700">Selected mod has no dependency declaration.</p>
          ) : null}
          {props.loadingDependencyPlan ? (
            <p className="text-[11px] text-sky-800">Resolving dependency plan...</p>
          ) : props.dependencyPlanPreview ? (
            <div className="space-y-2 rounded-md border border-sky-200 bg-white p-2">
              <p className="text-[11px] text-sky-900">
                planId={props.dependencyPlanPreview.planId} · dependencies={props.dependencyPlanPreview.dependencies.length}
              </p>
              <p className="text-[11px] text-sky-800">
                selected={props.dependencyPlanPreview.dependencies.filter((item) => item.selected).length}
                {' · '}
                required={props.dependencyPlanPreview.dependencies.filter((item) => item.required).length}
              </p>
              {props.dependencyPlanPreview.warnings.length > 0 ? (
                <p className="text-[11px] text-amber-700">{props.dependencyPlanPreview.warnings.join(' ; ')}</p>
              ) : null}
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={applyingDependencies || !props.selectedDependencyModId}
                  onClick={() => {
                    if (!props.selectedDependencyModId) return;
                    void (async () => {
                      setApplyingDependencies(true);
                      setDependencyApplySummary('');
                      try {
                        await props.onApplyDependencies(
                          props.selectedDependencyModId,
                          props.selectedDependencyCapability === 'auto' ? undefined : props.selectedDependencyCapability,
                        );
                        setDependencyApplySummary('Dependency apply completed.');
                      } catch (error) {
                        setDependencyApplySummary(
                          `Dependency apply failed: ${error instanceof Error ? error.message : String(error || '')}`,
                        );
                      } finally {
                        setApplyingDependencies(false);
                        void props.onResolveDependencyPlanPreview();
                      }
                    })();
                  }}
                >
                  {applyingDependencies ? 'Applying...' : 'Apply Dependencies'}
                </Button>
                {dependencyApplySummary ? (
                  <p className="text-[11px] text-sky-800">{dependencyApplySummary}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-sky-800">No dependency plan available for selected mod.</p>
          )}
        </>
      )}
    </div>
  );
}
