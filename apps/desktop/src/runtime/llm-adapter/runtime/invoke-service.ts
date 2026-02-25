import type {
  CapabilityRequest,
  InvokeRequest,
  RoutingDecision,
} from '../types';
import { RotationManager } from '../rotation-manager';
import { type RouteOptions, RoutingService } from './routing-service';
import { UsageService } from './usage-service';
import { invokeStreamWithFallback } from './invoke/stream';
import { invokeText, invokeTextWithFallback } from './invoke/text';
import type { InvokeServiceContext, InvokeWithFallbackOptions } from './invoke/types';

export type { InvokeWithFallbackOptions } from './invoke/types';

type InvokeServiceConstructorContext = {
  routingService: RoutingService;
  rotationManager: RotationManager;
  usageService: UsageService;
};

export class InvokeService {
  private readonly context: InvokeServiceContext;

  constructor(context: InvokeServiceConstructorContext) {
    this.context = context;
  }

  invoke(
    decision: RoutingDecision,
    request: InvokeRequest,
    options?: { signal?: AbortSignal; caller?: string },
  ) {
    return invokeText(this.context, decision, request, options);
  }

  invokeWithFallback(
    capabilityRequest: CapabilityRequest,
    invokeRequest: InvokeRequest,
    options?: InvokeWithFallbackOptions,
  ) {
    return invokeTextWithFallback(this.context, capabilityRequest, invokeRequest, options);
  }

  invokeStreamWithFallback(
    capabilityRequest: CapabilityRequest,
    invokeRequest: InvokeRequest,
    options?: InvokeWithFallbackOptions,
  ) {
    return invokeStreamWithFallback(this.context, capabilityRequest, invokeRequest, options);
  }
}

export type { RouteOptions };
