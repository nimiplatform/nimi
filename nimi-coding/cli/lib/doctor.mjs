import { inspectDoctorBootstrapSurface } from "./internal/doctor-bootstrap-surface.mjs";
import { inspectDoctorDelegatedSurface } from "./internal/doctor-delegated-surface.mjs";
import { finalizeDoctorState } from "./internal/doctor-finalize.mjs";
import { formatDoctorResult as formatDoctorResultInternal } from "./internal/doctor-format.mjs";

export async function inspectDoctorState(projectRoot) {
  const bootstrapSurface = await inspectDoctorBootstrapSurface(projectRoot);
  if (bootstrapSurface.done) {
    return bootstrapSurface.result;
  }

  const delegatedSurface = await inspectDoctorDelegatedSurface(projectRoot, bootstrapSurface);
  return finalizeDoctorState(projectRoot, bootstrapSurface, delegatedSurface);
}

export function formatDoctorResult(result, options = {}) {
  return formatDoctorResultInternal(result, options);
}
