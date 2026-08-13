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

// @nimi-authority: definition.nimi.sdks.client-core.transport-plane
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

  serverStream<Response = unknown, Body = unknown>(request: CoreStreamRequest<Body>): AsyncIterable<Response> {
    return forwardCoreServerStream(async () => this.#transport.serverStream<Response, Body>({
      ...request,
      metadata: await this.#metadata(request.metadata),
      responseMetadataObserver: combineResponseMetadataObservers(
        this.#responseMetadataObserver,
        request.responseMetadataObserver,
      ),
    }));
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

function forwardCoreServerStream<Response>(
  open: () => Promise<AsyncIterable<Response>>,
): AsyncIterable<Response> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Response> {
      let closed = false;
      let source: Promise<AsyncIterable<Response>> | undefined;
      let sourceIterator: AsyncIterator<Response> | undefined;

      const ensureIterator = async (): Promise<AsyncIterator<Response>> => {
        source ??= open();
        const stream = await source;
        sourceIterator ??= stream[Symbol.asyncIterator]();
        return sourceIterator;
      };

      const closeSource = () => {
        const closeIterator = (iterator: AsyncIterator<Response>) => {
          if (typeof iterator.return === 'function') {
            void Promise.resolve(iterator.return()).catch(() => undefined);
          }
        };
        if (sourceIterator) {
          closeIterator(sourceIterator);
          return;
        }
        if (source) {
          void source.then((stream) => {
            sourceIterator ??= stream[Symbol.asyncIterator]();
            closeIterator(sourceIterator);
          }).catch(() => undefined);
        }
      };

      return {
        next: async (): Promise<IteratorResult<Response>> => {
          if (closed) {
            return { done: true, value: undefined };
          }
          try {
            const iterator = await ensureIterator();
            if (closed) {
              return { done: true, value: undefined };
            }
            const result = await iterator.next();
            if (closed) {
              return { done: true, value: undefined };
            }
            return result;
          } catch (error) {
            if (closed) {
              return { done: true, value: undefined };
            }
            throw error;
          }
        },
        return: async (): Promise<IteratorResult<Response>> => {
          if (!closed) {
            closed = true;
            closeSource();
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
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
