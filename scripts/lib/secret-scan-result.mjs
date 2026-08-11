export function shouldApplySecretBaselineUpdate(result, updateMode) {
  return Boolean(updateMode && result?.status === 3 && result?.baselineUpdated);
}
