import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliver, dismissDelivery, type SystemDeliveryStatus } from '../src/nimiday/platform/notifier.js';

vi.mock('@nimiplatform/kit/ui', () => ({ nimiToast: { show: vi.fn() } }));

// Unit coverage of browser callbacks, not evidence of OS notification delivery.
class NotificationCallbacks {
  static permission = 'granted';
  static latest: NotificationCallbacks;
  onshow?: () => void;
  onerror?: () => void;
  onclose?: () => void;
  onclick?: () => void;
  constructor() { NotificationCallbacks.latest = this; }
  close() { this.onclose?.(); }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('system notification feedback', () => {
  it('reports unconfirmed when the OS silently suppresses a notification, and accepts a later display report', () => {
    vi.useFakeTimers();
    vi.stubGlobal('Notification', NotificationCallbacks);
    const statuses: SystemDeliveryStatus[] = [];
    deliver({ title: 'Test', body: 'Test', tag: 'silent-test', system: true, onSystemStatus: value => statuses.push(value) });
    vi.advanceTimersByTime(8_000);
    expect(statuses).toEqual(['submitted', 'unconfirmed']);
    NotificationCallbacks.latest.onshow?.();
    expect(statuses.at(-1)).toBe('shown');
  });

  it('cancels waiting feedback when a notification is replaced or dismissed', () => {
    vi.useFakeTimers();
    vi.stubGlobal('Notification', NotificationCallbacks);
    const first = vi.fn();
    const second = vi.fn();
    deliver({ title: 'Test', body: 'Test', tag: 'replace-test', system: true, onSystemStatus: first });
    deliver({ title: 'Test', body: 'Test', tag: 'replace-test', system: true, onSystemStatus: second });
    dismissDelivery('replace-test');
    vi.advanceTimersByTime(8_000);
    expect(first).toHaveBeenCalledExactlyOnceWith('submitted');
    expect(second).toHaveBeenCalledExactlyOnceWith('submitted');
  });
  it('does not construct a notification when permission is denied', () => {
    const construct = vi.fn();
    vi.stubGlobal('Notification', class { static permission = 'denied'; constructor() { construct(); } });
    const status = vi.fn();
    expect(deliver({ title: 'Test', body: 'Test', tag: 'denied-test', system: true, onSystemStatus: status })).toEqual({ system: false });
    expect(construct).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith('unavailable');
  });
  it('distinguishes submission from the browser reporting display or failure', () => {
    vi.stubGlobal('Notification', NotificationCallbacks);
    const statuses: SystemDeliveryStatus[] = [];
    deliver({ title: 'Test', body: 'Test', tag: 'callback-test', system: true, onSystemStatus: value => statuses.push(value) });
    expect(statuses).toEqual(['submitted']);
    NotificationCallbacks.latest.onshow?.();
    expect(statuses).toEqual(['submitted', 'shown']);
    NotificationCallbacks.latest.onerror?.();
    expect(statuses.at(-1)).toBe('failed');
  });

  it('reports unsupported environments without claiming successful delivery', () => {
    vi.stubGlobal('Notification', undefined);
    const status = vi.fn();
    expect(deliver({ title: 'Test', body: 'Test', tag: 'unsupported-test', system: true, onSystemStatus: status })).toEqual({ system: false });
    expect(status).toHaveBeenCalledWith('unavailable');
  });

  it('reports synchronous system rejection as failure', () => {
    vi.stubGlobal('Notification', class { static permission = 'granted'; constructor() { throw new Error('OS rejected notification'); } });
    const status = vi.fn();
    expect(deliver({ title: 'Test', body: 'Test', tag: 'rejected-test', system: true, onSystemStatus: status })).toEqual({ system: false });
    expect(status).toHaveBeenCalledWith('failed');
  });
});
