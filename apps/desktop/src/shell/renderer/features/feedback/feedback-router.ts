export type FeedbackIntent =
  | 'fatal_error'
  | 'cross_surface_error'
  | 'contextual_error'
  | 'contextual_success'
  | 'persistent_state'
  | 'background_event'
  | 'long_task_status';

export type FeedbackTrigger = 'user_action' | 'bootstrap' | 'background' | 'passive_state';

export type FeedbackChannel =
  | 'global_banner'
  | 'top_strip'
  | 'page_inline'
  | 'control_inline'
  | 'local_toast'
  | 'job_toast'
  | 'silent';

export function routeFeedback(input: {
  intent: FeedbackIntent;
  trigger: FeedbackTrigger;
  preferredChannel?: Exclude<FeedbackChannel, 'silent'>;
}): FeedbackChannel {
  const { intent, trigger, preferredChannel } = input;

  if (intent === 'fatal_error') {
    return preferredChannel === 'top_strip' ? 'top_strip' : 'global_banner';
  }

  if (intent === 'persistent_state') {
    return preferredChannel === 'global_banner' ? 'global_banner' : 'top_strip';
  }

  if (intent === 'long_task_status') {
    if (preferredChannel === 'local_toast') {
      return 'local_toast';
    }
    return 'job_toast';
  }

  if (intent === 'background_event') {
    return trigger === 'background' || trigger === 'passive_state'
      ? 'silent'
      : (preferredChannel || 'page_inline');
  }

  if (intent === 'contextual_success') {
    if (trigger === 'background' || trigger === 'passive_state') {
      return 'silent';
    }
    return preferredChannel === 'page_inline' ? 'page_inline' : 'control_inline';
  }

  if (intent === 'contextual_error') {
    if (trigger === 'bootstrap' || trigger === 'background') {
      return preferredChannel === 'global_banner' ? 'global_banner' : 'page_inline';
    }
    return preferredChannel || 'page_inline';
  }

  if (intent === 'cross_surface_error') {
    return preferredChannel || 'global_banner';
  }

  return preferredChannel || 'page_inline';
}
