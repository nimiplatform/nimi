const SEGMENT_SPLIT_RE = /[-:]/;

function toCamelCase(segment: string): string {
  if (!segment) return '';
  return segment[0]!.toUpperCase() + segment.slice(1).toLowerCase();
}

export function activityIdToMotionGroup(activityId: string): string {
  const segments = activityId.split(SEGMENT_SPLIT_RE).filter((s) => s.length > 0);
  return 'Activity_' + segments.map(toCamelCase).join('');
}

export function activityIdToHandlerFilename(activityId: string): string {
  return activityId.replace(/[^a-z0-9_]/g, '_');
}

export function eventNameToHandlerFilename(eventName: string): string {
  return eventName.replace(/\./g, '_');
}

const EVENT_REGISTRY: readonly string[] = [
  'avatar.user.click',
  'avatar.user.double_click',
  'avatar.user.right_click',
  'avatar.user.hover',
  'avatar.user.leave',
  'avatar.user.drag.start',
  'avatar.user.drag.move',
  'avatar.user.drag.end',
  'avatar.app.start',
  'avatar.app.ready',
  'avatar.app.focus.change',
  'avatar.app.visibility.change',
  'avatar.app.shutdown',
  'desktop.chat.message.send',
  'desktop.chat.message.receive',
  'runtime.agent.state.posture_changed',
  'runtime.agent.state.status_text_changed',
  'runtime.agent.state.emotion_changed',
  'runtime.agent.presentation.expression_requested',
  'runtime.agent.hook.running',
  'runtime.agent.hook.completed',
  'system.focus.gained',
  'system.focus.lost',
];

export function handlerFilenameToEventName(filename: string): string | null {
  const stem = filename.replace(/\.js$/, '');
  for (const event of EVENT_REGISTRY) {
    if (eventNameToHandlerFilename(event) === stem) {
      return event;
    }
  }
  return null;
}

export { EVENT_REGISTRY };
