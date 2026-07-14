export type ActionFamily = 'observe' | 'engage' | 'support' | 'assist' | 'reflect' | 'rest';
export type InterruptMode = 'welcome' | 'cautious' | 'focused';
export type ExecutionState = 'IDLE' | 'CHAT_ACTIVE' | 'LIFE_PENDING' | 'LIFE_RUNNING' | 'SUSPENDED';
export type ActivityCategory = 'emotion' | 'interaction' | 'state';
export type ActivityIntensity = 'weak' | 'moderate' | 'strong';
export type ActivitySource = 'apml_output' | 'direct_api' | 'mock';
export type CurrentEmotion =
  | 'happy'
  | 'sad'
  | 'shy'
  | 'angry'
  | 'surprised'
  | 'confused'
  | 'excited'
  | 'worried'
  | 'embarrassed'
  | 'neutral'
  | 'ext:apologetic'
  | 'ext:proud'
  | 'ext:lonely'
  | 'ext:grateful';

export type RuntimePresentationAdmissionEvidence = {
  runtimeAdmissionRef: string;
  gatewayVerdictRef: string;
  firewallVerdictRef: string;
  auditRef: string;
  credentialVerdictRef: string;
};

export type PostureSnapshot = {
  posture_class: string;
  action_family: ActionFamily;
  interrupt_mode: InterruptMode;
  transition_reason: string;
  truth_basis_ids: string[];
};

export type AgentBundleHistory = {
  last_activity: { name: string; at: string } | null;
  last_motion: { group: string; at: string } | null;
  last_expression: { name: string; at: string } | null;
};

export type AppContext = {
  namespace: string;
  surface_id: string;
  visible: boolean;
  focused: boolean;
  window: { x: number; y: number; width: number; height: number };
  cursor_x: number;
  cursor_y: number;
};

export type RuntimeContext = {
  now: string;
  session_id: string;
  locale: string;
};

export type AgentDataBundle = {
  activity?: {
    name: string;
    category: ActivityCategory;
    intensity: ActivityIntensity | null;
    source: ActivitySource;
    admission?: RuntimePresentationAdmissionEvidence;
  };
  emotion?: {
    current: CurrentEmotion;
    previous: CurrentEmotion | null;
    source: string;
  };
  posture: PostureSnapshot;
  status_text: string;
  execution_state: ExecutionState;
  active_world_id: string;
  active_user_id: string;
  history?: AgentBundleHistory;
  event?: {
    event_name: string;
    event_id: string;
    timestamp: string;
    detail: Record<string, unknown>;
  };
  app: AppContext;
  runtime: RuntimeContext;
  custom?: Record<string, unknown>;
};

export type AgentEvent = {
  event_id: string;
  name: string;
  timestamp: string;
  detail: Record<string, unknown>;
};

export type AppOriginEvent = {
  name: string;
  detail: Record<string, unknown>;
};

export type DriverStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface AgentDataDriver {
  readonly kind: 'mock' | 'sdk';
  readonly status: DriverStatus;
  getLastError?(): string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  getBundle(): AgentDataBundle;
  onEvent(handler: (event: AgentEvent) => void): () => void;
  onBundleChange(handler: (bundle: AgentDataBundle) => void): () => void;
  onStatusChange(handler: (status: DriverStatus) => void): () => void;
  emit(event: AppOriginEvent): void;
  emitCancelable?(event: AppOriginEvent): AgentEvent;
}
