export type PollingEvent =
  | {
      type: 'started';
      key: string;
      intervalMs: number;
      activeCount: number;
      replaced: boolean;
    }
  | {
      type: 'stopped';
      key: string;
      activeCount: number;
    }
  | {
      type: 'stopped-all';
      activeCount: number;
    };

