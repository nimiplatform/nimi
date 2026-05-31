export type CoreMethodKind = 'unary' | 'server_stream' | 'client_stream' | 'bidi_stream';

export interface CoreMetadata {
  readonly [key: string]: string;
}

export interface CoreUnaryRequest<Body = unknown> {
  readonly methodId: string;
  readonly metadata?: CoreMetadata;
  readonly body: Body;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface CoreStreamRequest<Body = unknown> {
  readonly methodId: string;
  readonly metadata?: CoreMetadata;
  readonly body: Body;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface CoreErrorShape {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

