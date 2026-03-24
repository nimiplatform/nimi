export type GenerationRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'canceled'
  | (string & {});

export type GenerationRunItem = {
  runId: string;
  status: GenerationRunStatus;
  label: string;
  error?: string;
  progressValue?: number;
  progressLabel?: string;
};

export interface GenerationPanelAdapter<TInput> {
  submit: (input: TInput) => Promise<void> | void;
}
