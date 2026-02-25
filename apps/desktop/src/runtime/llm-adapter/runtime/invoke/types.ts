import { RotationManager } from '../../rotation-manager';
import type {
  RoutingDecision,
} from '../../types';
import { type RouteOptions, RoutingService } from '../routing-service';
import { UsageService } from '../usage-service';

export type InvokeWithFallbackOptions = RouteOptions & {
  candidates?: RoutingDecision[];
  signal?: AbortSignal;
  preflightHealth?: boolean;
};

export type InvokeServiceContext = {
  routingService: RoutingService;
  rotationManager: RotationManager;
  usageService: UsageService;
};
