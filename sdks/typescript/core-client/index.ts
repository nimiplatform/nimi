import type {
  CoreResponseMetadataObserver,
  CoreStreamRequest,
  CoreUnaryRequest,
} from '../types';

export interface CoreTransport {
  unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response>;
  serverStream<Response = unknown, Body = unknown>(request: CoreStreamRequest<Body>): AsyncIterable<Response>;
}

export interface CoreClientOptions {
  readonly transport: CoreTransport;
  readonly authMetadata?: () => CoreMetadataInput | Promise<CoreMetadataInput>;
  readonly responseMetadataObserver?: CoreResponseMetadataObserver;
}

export type CoreMetadataInput = Readonly<Record<string, string>>;

export class NimiCoreTransportRequiredError extends Error {
  readonly code = 'SDK_CORE_TRANSPORT_REQUIRED';

  constructor() {
    super('CoreClient requires an explicit transport with unary and serverStream methods');
    this.name = 'NimiCoreTransportRequiredError';
  }
}

export class CoreClient {
  readonly #transport: CoreTransport;
  readonly #authMetadata?: () => CoreMetadataInput | Promise<CoreMetadataInput>;
  readonly #responseMetadataObserver?: CoreResponseMetadataObserver;

  constructor(options: CoreClientOptions) {
    if (!isCoreTransport(options?.transport)) {
      throw new NimiCoreTransportRequiredError();
    }
    this.#transport = options.transport;
    this.#authMetadata = options.authMetadata;
    this.#responseMetadataObserver = options.responseMetadataObserver;
  }

  async unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
    return this.#transport.unary<Response, Body>({
      ...request,
      metadata: await this.#metadata(request.metadata),
      responseMetadataObserver: combineResponseMetadataObservers(
        this.#responseMetadataObserver,
        request.responseMetadataObserver,
      ),
    });
  }

  async *serverStream<Response = unknown, Body = unknown>(request: CoreStreamRequest<Body>): AsyncIterable<Response> {
    yield* this.#transport.serverStream<Response, Body>({
      ...request,
      metadata: await this.#metadata(request.metadata),
      responseMetadataObserver: combineResponseMetadataObservers(
        this.#responseMetadataObserver,
        request.responseMetadataObserver,
      ),
    });
  }

  unsafeRaw(): CoreTransport {
    return this.#transport;
  }

  async #metadata(metadata: CoreMetadataInput | undefined): Promise<CoreMetadataInput> {
    return {
      ...(this.#authMetadata ? await this.#authMetadata() : {}),
      ...(metadata ?? {}),
    };
  }
}

function combineResponseMetadataObservers(
  first: CoreResponseMetadataObserver | undefined,
  second: CoreResponseMetadataObserver | undefined,
): CoreResponseMetadataObserver | undefined {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return (metadata) => {
    first(metadata);
    second(metadata);
  };
}

function isCoreTransport(value: unknown): value is CoreTransport {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  return typeof candidate.unary === 'function' && typeof candidate.serverStream === 'function';
}
