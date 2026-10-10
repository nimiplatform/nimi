/**
 * Friendly naming for a runtime component. Known ids map to product names
 * and a plain-language state; unknown ids fall back to the raw identifier so
 * nothing is hidden, and the raw ids stay available under technical details.
 */
export function componentPresentation(
  item: { readonly dependencyFamily: string; readonly dependencyId: string; readonly state: string },
  t: (key: string, options?: Record<string, unknown>) => string,
): {
  readonly name: string;
  readonly family: string;
  readonly purpose: string;
  readonly state: string;
  readonly tone: 'success' | 'warning' | 'info' | 'neutral';
} {
  // Exact ids that carry a digest (a Python environment or package set) are
  // named by their family; the raw id stays under technical details.
  const familyName = t(`runtimeConfig.setupTask.componentFamilyName.${item.dependencyFamily}`, { defaultValue: '' });
  const name = t(`runtimeConfig.setupTask.component.${item.dependencyId}`, { defaultValue: familyName || item.dependencyId });
  const family = t(`runtimeConfig.setupTask.componentFamily.${item.dependencyFamily}`, { defaultValue: '' });
  const purpose = t(`runtimeConfig.setupTask.componentPurpose.${item.dependencyFamily}`, { defaultValue: '' });
  const state = t(`runtimeConfig.setupTask.componentState.${item.state}`, {
    defaultValue: t(`runtimeConfig.downloads.environment.${item.state}`, { defaultValue: item.state }),
  });
  const tone = item.state === 'ready_managed' || item.state === 'ready_system' || item.state === 'ready' || item.state === 'already_satisfied'
    ? 'success'
    : item.state === 'failed' || item.state === 'repair_required' || item.state === 'unsupported'
      ? 'warning'
      : 'info';
  return { name, family, purpose, state, tone };
}
