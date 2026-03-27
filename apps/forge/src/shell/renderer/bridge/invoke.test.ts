import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────

const mockHasTauriInvoke = vi.fn<() => boolean>();

vi.mock('./env.js', () => ({
  hasTauriInvoke: (...args: unknown[]) => mockHasTauriInvoke(...(args as [])),
}));

const { BridgeError, invoke, invokeChecked } = await import('./invoke.js');

// ── Tests ──────────────────────────────────────────────────

describe('BridgeError', () => {
  it('has correct name and command property', () => {
    const error = new BridgeError('something broke', 'test_cmd');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('BridgeError');
    expect(error.message).toBe('something broke');
    expect(error.command).toBe('test_cmd');
  });
});

describe('invoke', () => {
  const mockTauriInvoke = vi.fn<(cmd: string, payload?: unknown) => Promise<unknown>>();
  const tauriWindow = window as unknown as Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    tauriWindow.__NIMI_TAURI_TEST__ = undefined;
  });

  it('throws BridgeError when hasTauriInvoke returns false', async () => {
    mockHasTauriInvoke.mockReturnValue(false);

    await expect(invoke('my_command', { key: 'val' })).rejects.toThrow(BridgeError);
    await expect(invoke('my_command')).rejects.toSatisfy((err: InstanceType<typeof BridgeError>) => {
      return err.command === 'my_command' && err.message === 'Tauri runtime is not available';
    });
  });

  it('calls scoped tauri invoke when available', async () => {
    mockHasTauriInvoke.mockReturnValue(true);
    mockTauriInvoke.mockResolvedValue({ success: true });

    tauriWindow.__NIMI_TAURI_TEST__ = {
      invoke: mockTauriInvoke,
    };

    const result = await invoke('get_data', { id: 42 });

    expect(mockTauriInvoke).toHaveBeenCalledWith('get_data', { id: 42 });
    expect(result).toEqual({ success: true });
  });

  it('wraps native errors into BridgeError', async () => {
    mockHasTauriInvoke.mockReturnValue(true);
    mockTauriInvoke.mockRejectedValue(new Error('network timeout'));

    tauriWindow.__NIMI_TAURI_TEST__ = {
      invoke: mockTauriInvoke,
    };

    await expect(invoke('fetch_user')).rejects.toSatisfy(
      (err: InstanceType<typeof BridgeError>) => {
        return (
          err instanceof BridgeError &&
          err.command === 'fetch_user' &&
          err.message === 'network timeout'
        );
      },
    );
  });

  it('wraps non-Error rejections into BridgeError', async () => {
    mockHasTauriInvoke.mockReturnValue(true);
    mockTauriInvoke.mockRejectedValue('string rejection');

    tauriWindow.__NIMI_TAURI_TEST__ = {
      invoke: mockTauriInvoke,
    };

    await expect(invoke('some_cmd')).rejects.toSatisfy(
      (err: InstanceType<typeof BridgeError>) => {
        return (
          err instanceof BridgeError &&
          err.command === 'some_cmd' &&
          err.message === 'string rejection'
        );
      },
    );
  });
});

describe('invokeChecked', () => {
  const mockTauriInvoke = vi.fn<(cmd: string, payload?: unknown) => Promise<unknown>>();
  const tauriWindow = window as unknown as Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    tauriWindow.__NIMI_TAURI_TEST__ = undefined;
  });

  it('calls parseResult on the invoke result', async () => {
    mockHasTauriInvoke.mockReturnValue(true);
    mockTauriInvoke.mockResolvedValue({ value: 123 });

    tauriWindow.__NIMI_TAURI_TEST__ = {
      invoke: mockTauriInvoke,
    };

    const parseResult = vi.fn((raw: unknown) => {
      const record = raw as { value?: number };
      return (record.value ?? 0) * 2;
    });

    const result = await invokeChecked('compute', { input: 'x' }, parseResult);

    expect(mockTauriInvoke).toHaveBeenCalledWith('compute', { input: 'x' });
    expect(parseResult).toHaveBeenCalledWith({ value: 123 });
    expect(result).toBe(246);
  });
});
