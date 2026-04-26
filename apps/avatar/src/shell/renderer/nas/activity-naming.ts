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

const CORE_ACTIVITY_IDS = [
  'happy',
  'sad',
  'shy',
  'angry',
  'surprised',
  'confused',
  'excited',
  'worried',
  'embarrassed',
  'neutral',
  'greet',
  'farewell',
  'agree',
  'disagree',
  'listening',
  'thinking',
  'idle',
  'celebrating',
  'sleeping',
  'focused',
] as const;

const EXTENDED_ACTIVITY_IDS = [
  'ext:apologetic',
  'ext:proud',
  'ext:lonely',
  'ext:grateful',
  'ext:acknowledging',
  'ext:encouraging',
  'ext:teasing',
  'ext:resting',
  'ext:playing',
  'ext:eating',
] as const;

const KNOWN_ACTIVITY_IDS = [
  ...CORE_ACTIVITY_IDS,
  ...EXTENDED_ACTIVITY_IDS,
] as const;

export function activityHandlerKey(activityId: string): string {
  return activityIdToHandlerFilename(activityId);
}

export function handlerFilenameToActivityId(filename: string): string | null {
  const stem = filename.replace(/\.js$/, '');
  for (const activityId of KNOWN_ACTIVITY_IDS) {
    if (activityIdToHandlerFilename(activityId) === stem) {
      return activityId;
    }
  }
  if (/^mod_[a-z0-9_]+_[a-z0-9_]+$/.test(stem)) {
    return stem;
  }
  if (/^[a-z0-9_]+$/.test(stem)) {
    return stem;
  }
  return null;
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
  'avatar.model.load',
  'avatar.model.switch',
  'avatar.activity.start',
  'avatar.activity.end',
  'avatar.activity.cancel',
  'avatar.motion.play',
  'avatar.motion.complete',
  'avatar.expression.change',
  'avatar.pose.set',
  'avatar.pose.clear',
  'avatar.lookat.set',
  'avatar.lipsync.frame',
  'avatar.speak.start',
  'avatar.speak.chunk',
  'avatar.speak.end',
  'avatar.speak.interrupt',
  'desktop.chat.message.send',
  'desktop.chat.message.receive',
  'runtime.agent.turn.accepted',
  'runtime.agent.turn.started',
  'runtime.agent.turn.reasoning_delta',
  'runtime.agent.turn.text_delta',
  'runtime.agent.turn.structured',
  'runtime.agent.turn.message_committed',
  'runtime.agent.turn.post_turn',
  'runtime.agent.turn.completed',
  'runtime.agent.turn.failed',
  'runtime.agent.turn.interrupted',
  'runtime.agent.turn.interrupt_ack',
  'runtime.agent.session.snapshot',
  'runtime.agent.presentation.activity_requested',
  'runtime.agent.presentation.motion_requested',
  'runtime.agent.presentation.expression_requested',
  'runtime.agent.presentation.pose_requested',
  'runtime.agent.presentation.pose_cleared',
  'runtime.agent.presentation.lookat_requested',
  'runtime.agent.state.posture_changed',
  'runtime.agent.state.status_text_changed',
  'runtime.agent.state.emotion_changed',
  'runtime.agent.state.execution_state_changed',
  'runtime.agent.hook.intent_proposed',
  'runtime.agent.hook.pending',
  'runtime.agent.hook.rejected',
  'runtime.agent.hook.running',
  'runtime.agent.hook.completed',
  'runtime.agent.hook.failed',
  'runtime.agent.hook.canceled',
  'runtime.agent.hook.rescheduled',
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

export { EVENT_REGISTRY, KNOWN_ACTIVITY_IDS };
