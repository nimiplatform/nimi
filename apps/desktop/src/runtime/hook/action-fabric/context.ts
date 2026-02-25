export type ActionExecutionPhase = 'dry-run' | 'verify' | 'commit';

export type ActionPipelineStop<TResult> = {
  stop: true;
  result: TResult;
};

export type ActionPipelineNext = {
  stop: false;
};

export type ActionPipelineStepResult<TResult> = ActionPipelineStop<TResult> | ActionPipelineNext;

export function pipelineStop<TResult>(result: TResult): ActionPipelineStop<TResult> {
  return {
    stop: true,
    result,
  };
}

export const pipelineNext: ActionPipelineNext = { stop: false };
