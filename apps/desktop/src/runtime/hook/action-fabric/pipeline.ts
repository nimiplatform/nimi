import type { ActionPipelineStepResult } from './context.js';

export type ActionPipelineStage<TContext, TResult> = (context: TContext) => Promise<ActionPipelineStepResult<TResult>> | ActionPipelineStepResult<TResult>;

type NamedStage<TContext, TResult> = {
  name: string;
  run: ActionPipelineStage<TContext, TResult>;
};

export class ActionPipeline<TContext, TResult> {
  private readonly stages: NamedStage<TContext, TResult>[] = [];

  use(name: string, stage: ActionPipelineStage<TContext, TResult>): this {
    this.stages.push({ name: String(name || '').trim() || 'unnamed-stage', run: stage });
    return this;
  }

  stageNames(): string[] {
    return this.stages.map((item) => item.name);
  }

  async run(context: TContext): Promise<TResult | null> {
    for (const stage of this.stages) {
      const outcome = await stage.run(context);
      if (outcome.stop) {
        return outcome.result;
      }
    }
    return null;
  }
}
