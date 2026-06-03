
import {
  ScenarioJobEventType,
  type ScenarioJobEvent,
} from './generated/runtime/v1/ai';
import {
  WorkflowEventType,
  type WorkflowEvent,
} from './generated/runtime/v1/workflow';

export const MEDIA_JOB_TERMINAL_EVENT_TYPES: ReadonlySet<ScenarioJobEventType> = new Set([
  ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
  ScenarioJobEventType.SCENARIO_JOB_EVENT_FAILED,
  ScenarioJobEventType.SCENARIO_JOB_EVENT_CANCELED,
  ScenarioJobEventType.SCENARIO_JOB_EVENT_TIMEOUT,
]);

export const WORKFLOW_TERMINAL_EVENT_TYPES: ReadonlySet<WorkflowEventType> = new Set([
  WorkflowEventType.WORKFLOW_EVENT_COMPLETED,
  WorkflowEventType.WORKFLOW_EVENT_FAILED,
  WorkflowEventType.WORKFLOW_EVENT_CANCELED,
]);

export function wrapModeBMediaStream(source: AsyncIterable<ScenarioJobEvent>): AsyncIterable<ScenarioJobEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of source) {
        yield event;
        if (MEDIA_JOB_TERMINAL_EVENT_TYPES.has(event.eventType)) {
          return;
        }
      }
    },
  };
}

export function wrapModeBWorkflowStream(source: AsyncIterable<WorkflowEvent>): AsyncIterable<WorkflowEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of source) {
        yield event;
        if (WORKFLOW_TERMINAL_EVENT_TYPES.has(event.eventType)) {
          return;
        }
      }
    },
  };
}
