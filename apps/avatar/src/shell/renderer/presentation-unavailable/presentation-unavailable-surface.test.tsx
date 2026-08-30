import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PresentationUnavailableSurface } from './presentation-unavailable-surface.js';

const restartAvatarMock = vi.fn();
const closeAvatarWindowMock = vi.fn();

vi.mock('../app-shell/avatar-window-commands.js', () => ({
  closeAvatarWindow: () => closeAvatarWindowMock(),
}));

beforeEach(() => {
  restartAvatarMock.mockReset();
  closeAvatarWindowMock.mockReset();
});

describe('PresentationUnavailableSurface', () => {
  it('offers restart and close without exposing a renderer state machine', () => {
    render(
      <PresentationUnavailableSurface
        reason="context_lost_recovery_failed"
        onRestart={restartAvatarMock}
      />,
    );

    expect(screen.getByText("The avatar can't be displayed")).toBeTruthy();
    expect(screen.getByText('context_lost_recovery_failed')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Restart avatar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close avatar' }));

    expect(restartAvatarMock).toHaveBeenCalledTimes(1);
    expect(closeAvatarWindowMock).toHaveBeenCalledTimes(1);
  });
});
