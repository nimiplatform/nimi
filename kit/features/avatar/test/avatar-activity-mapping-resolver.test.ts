import { describe, expect, it } from 'vitest';
import {
  __KNOWN_ROUTING_ACTIVITY_IDS__,
  createActivityMappingResolver,
} from '../src/avatar-activity-mapping-resolver.js';

describe('avatar activity mapping resolver', () => {
  it('exposes dual backend routes for every admitted core activity', () => {
    const resolver = createActivityMappingResolver();

    expect(__KNOWN_ROUTING_ACTIVITY_IDS__).toHaveLength(20);
    for (const activityId of __KNOWN_ROUTING_ACTIVITY_IDS__) {
      expect(resolver.resolveLive2DRoute(activityId), activityId).not.toBeNull();
      expect(resolver.resolveVrmRoute(activityId), activityId).not.toBeNull();
    }
  });

  it('resolves concrete backend route details from the admitted table', () => {
    const resolver = createActivityMappingResolver();

    expect(resolver.resolveLive2DRoute('greet')).toEqual({
      motionGroup: 'tap_body',
      fallbackMotionGroup: 'tap_head',
    });
    expect(resolver.resolveVrmRoute('greet')).toEqual({
      motion: 'greet_wave',
      emotion: 'happy',
      fade: 0.25,
    });
    expect(resolver.resolveVrmRoute('listening')).toEqual({
      motion: 'listen_lean',
      fade: 0.3,
    });
  });

  it('fails closed for passthrough and unknown activities', () => {
    const resolver = createActivityMappingResolver();

    expect(resolver.isPassthrough('ext:custom-wave')).toBe(true);
    expect(resolver.isPassthrough('mod-pack:custom-wave')).toBe(true);
    expect(resolver.resolveLive2DRoute('ext:custom-wave')).toBeNull();
    expect(resolver.resolveVrmRoute('mod-pack:custom-wave')).toBeNull();
    expect(resolver.resolveLive2DRoute('unknown')).toBeNull();
    expect(resolver.resolveVrmRoute('unknown')).toBeNull();
  });
});
