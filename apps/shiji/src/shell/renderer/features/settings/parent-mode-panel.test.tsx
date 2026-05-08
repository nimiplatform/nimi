/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ParentModePanel } from './parent-mode-panel.js';

const hasParentPinMock = vi.fn();
const setParentPinMock = vi.fn();
const verifyParentPinMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@renderer/hooks/use-profiles.js', () => ({
  useProfiles: () => ({
    profiles: [],
    activeProfile: null,
    createProfile: vi.fn(),
    updateProfile: vi.fn(),
    switchProfile: vi.fn(),
  }),
}));

vi.mock('@renderer/bridge/parent-pin.js', () => ({
  hasParentPin: () => hasParentPinMock(),
  setParentPin: (pin: string) => setParentPinMock(pin),
  verifyParentPin: (pin: string) => verifyParentPinMock(pin),
}));

vi.mock('./profile-list.js', () => ({
  ProfileList: () => <div data-testid="profile-list" />,
}));

vi.mock('./profile-editor.js', () => ({
  ProfileEditor: () => <div data-testid="profile-editor" />,
}));

describe('ParentModePanel', () => {
  beforeEach(() => {
    hasParentPinMock.mockReset();
    setParentPinMock.mockReset();
    verifyParentPinMock.mockReset();
    localStorage.clear();
  });

  it('fails closed when secure PIN storage is unavailable', async () => {
    hasParentPinMock.mockRejectedValueOnce(new Error('keyring unavailable'));

    render(<ParentModePanel />);

    expect(await screen.findByText('settings.parentMode.pinStorageUnavailable')).toBeTruthy();
    expect(screen.queryByText('settings.parentMode.setPin')).toBeNull();
    expect(screen.queryByText('settings.parentMode.unlock')).toBeNull();
  });

  it('sets a new PIN through the secure bridge without localStorage writes', async () => {
    hasParentPinMock.mockResolvedValueOnce(false);
    setParentPinMock.mockResolvedValueOnce(undefined);

    render(<ParentModePanel />);

    fireEvent.change(await screen.findByPlaceholderText('settings.parentMode.pinPlaceholder'), {
      target: { value: '1234' },
    });
    fireEvent.change(screen.getByPlaceholderText('settings.parentMode.pinConfirmPlaceholder'), {
      target: { value: '1234' },
    });
    fireEvent.click(screen.getByText('settings.parentMode.setPin'));

    await waitFor(() => expect(setParentPinMock).toHaveBeenCalledWith('1234'));
    expect(await screen.findByTestId('profile-list')).toBeTruthy();
    expect(localStorage.length).toBe(0);
  });

  it('does not unlock when secure bridge verification fails', async () => {
    hasParentPinMock.mockResolvedValueOnce(true);
    verifyParentPinMock.mockResolvedValueOnce(false);

    render(<ParentModePanel />);

    fireEvent.change(await screen.findByPlaceholderText('••••'), {
      target: { value: '9999' },
    });
    fireEvent.click(screen.getByText('settings.parentMode.unlock'));

    await waitFor(() => expect(verifyParentPinMock).toHaveBeenCalledWith('9999'));
    expect(await screen.findByText('settings.parentMode.wrongPin')).toBeTruthy();
    expect(screen.queryByTestId('profile-list')).toBeNull();
  });
});
