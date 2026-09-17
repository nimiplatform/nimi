/** Closed stream-method catalog admission. */

import { simulatorError } from './errors.ts';
import { SimulatorIntegrityAbort, type SimulatorStreamMethodDeclaration } from './engine-types.ts';
import type { EngineContext } from './engine-context.ts';

export function registerStreamMethod(
  context: EngineContext,
  declaration: SimulatorStreamMethodDeclaration,
): void {
  const owner = context.moduleCatalogs.get(declaration.ownerModuleId);
  const sourcePrefix = `${declaration.ownerModuleId}.`;
  const sourceEvent = declaration.sourceEventType.startsWith(sourcePrefix)
    ? declaration.sourceEventType
    : '';
  const terminalEvent = declaration.terminalEventType?.startsWith(sourcePrefix)
    ? declaration.terminalEventType
    : null;
  if (
    context.phase !== 'open'
    || context.committed.revision !== 0
    || context.queue.length > 0
    || context.streamMethods.has(declaration.methodId)
    || !owner
    || !sourceEvent
    || !Object.hasOwn(owner.eventSchemas, sourceEvent)
    || (declaration.terminalEventType !== null && (
      !terminalEvent || !Object.hasOwn(owner.eventSchemas, terminalEvent)
    ))
  ) {
    throw new SimulatorIntegrityAbort(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
      moduleId: declaration.ownerModuleId,
    }));
  }
  context.streamMethods.set(declaration.methodId, Object.freeze({ ...declaration }));
}
