import { describe, it, expect, vi } from 'vitest';
import { createNimiElectronAppExitController, NIMI_APP_HOST_RESTART_EXIT_CODE } from '../src/main/app-exit-controller.js';

describe('supervised App exit controller', () => {
  it('leaves business teardown to the App and conveys only self-restart exit intent', () => {
    const app = { quit: vi.fn(), exit: vi.fn() };
    const control = createNimiElectronAppExitController(app, { NIMI_APP_HOST_PROFILE_DIR: '/prepared/profile', NIMI_APP_HOST_RESTART_SUPPORTED: '1' });
    control.requestRestart();
    expect(app.quit).toHaveBeenCalledOnce();
    expect(app.exit).not.toHaveBeenCalled();
    control.exit();
    expect(app.exit).toHaveBeenCalledWith(NIMI_APP_HOST_RESTART_EXIT_CODE);
  });
  it('refuses unsupported launches before quit and preserves real fatal exit codes', () => {
    const app = { quit: vi.fn(), exit: vi.fn() };
    const control = createNimiElectronAppExitController(app, {});
    expect(() => control.requestRestart()).toThrow('cannot request');
    expect(app.quit).not.toHaveBeenCalled();
    control.exit(1);
    expect(app.exit).toHaveBeenCalledWith(1);
  });
  it('an ordinary exit requests no replacement', () => {
    const app = { quit: vi.fn(), exit: vi.fn() };
    createNimiElectronAppExitController(app, {}).exit();
    expect(app.exit).toHaveBeenCalledWith(0);
  });
});
