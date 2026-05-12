// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let ulidCounter = 0;
vi.mock('../../bridge/ulid.js', () => ({
  isoNow: () => '2026-05-12T00:00:00.000Z',
  ulid: () => {
    ulidCounter += 1;
    return `ulid-${ulidCounter}`;
  },
}));

vi.mock('../../bridge/sqlite-bridge.js', async () => {
  const { PhotoAngleAlreadyExistsError } = await vi.importActual<
    typeof import('../../bridge/sqlite-bridge-orthodontic-photos.js')
  >('../../bridge/sqlite-bridge-orthodontic-photos.js');
  return {
    insertOrthodonticPhotoSession: vi.fn(),
    attachOrthodonticPhoto: vi.fn(),
    deleteOrthodonticPhotoSession: vi.fn(),
    canonicalizePhotoMime: (raw: string | null | undefined) => {
      if (!raw) return null;
      const t = raw.trim().toLowerCase();
      if (t === 'image/jpeg' || t === 'image/jpg') return 'image/jpeg';
      if (t === 'image/png') return 'image/png';
      if (t === 'image/webp') return 'image/webp';
      return null;
    },
    MAX_PHOTO_BASE64_PAYLOAD_BYTES: 20 * 1024 * 1024,
    PhotoAngleAlreadyExistsError,
  };
});

import {
  attachOrthodonticPhoto,
  deleteOrthodonticPhotoSession,
  insertOrthodonticPhotoSession,
  type OrthodonticApplianceRow,
} from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { OrthodonticPhotoCaptureModal } from './orthodontic-photo-capture-modal.js';

vi.mock('../../infra/telemetry/catch-log.js', () => ({
  catchLog: vi.fn(() => vi.fn()),
}));

const mockedInsertSession = vi.mocked(insertOrthodonticPhotoSession);
const mockedAttach = vi.mocked(attachOrthodonticPhoto);
const mockedDeleteSession = vi.mocked(deleteOrthodonticPhotoSession);
const mockedCatchLog = vi.mocked(catchLog);

function makeAppliance(
  overrides: Partial<OrthodonticApplianceRow> = {},
): OrthodonticApplianceRow {
  return {
    applianceId: 'appl-1',
    caseId: 'case-1',
    childId: 'child-1',
    applianceType: 'clear-aligner',
    status: 'active',
    startedAt: '2026-04-01',
    endedAt: null,
    prescribedHoursPerDay: 22,
    prescribedActivations: null,
    completedActivations: 0,
    totalAligners: 30,
    daysPerAligner: 14,
    reviewIntervalDays: 56,
    lastReviewAt: null,
    nextReviewDate: null,
    pauseReason: null,
    notes: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeImageFile(name: string, mime = 'image/jpeg'): File {
  // 1×1 JPEG-ish bytes — content doesn't matter because the mocked bridge
  // never decodes. The FileReader inside the modal just needs a result.
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  return new File([bytes], name, { type: mime });
}

async function pickFrontAndSide(container: HTMLElement) {
  const inputs = container.querySelectorAll('input[type="file"]');
  expect(inputs.length).toBe(2);
  const frontInput = inputs[0] as HTMLInputElement;
  const sideInput = inputs[1] as HTMLInputElement;

  const frontFile = makeImageFile('front.jpg');
  const sideFile = makeImageFile('side.jpg');

  await act(async () => {
    fireEvent.change(frontInput, { target: { files: [frontFile] } });
  });
  await act(async () => {
    fireEvent.change(sideInput, { target: { files: [sideFile] } });
  });

  // The slot's `handleFile` awaits a FileReader; jsdom resolves microtasks
  // synchronously but base64 is plumbed through state, so let React flush.
  await waitFor(() => {
    expect(screen.getByText('front.jpg')).toBeTruthy();
    expect(screen.getByText('side.jpg')).toBeTruthy();
  });
}

describe('OrthodonticPhotoCaptureModal', () => {
  beforeEach(() => {
    ulidCounter = 0;
    mockedInsertSession.mockReset();
    mockedAttach.mockReset();
    mockedDeleteSession.mockReset();
    mockedCatchLog.mockClear();
  });

  it('rolls back the half-built session when the second attach fails (W-D-2)', async () => {
    mockedInsertSession.mockResolvedValueOnce({
      sessionId: 'ulid-1',
      childId: 'child-1',
      caseId: 'case-1',
      applianceId: 'appl-1',
      trayIndex: null,
      sessionDate: '2026-05-12',
      note: null,
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z',
    });
    mockedAttach
      .mockResolvedValueOnce({
        attachmentId: 'att-front',
        childId: 'child-1',
        sessionId: 'ulid-1',
        angle: 'front',
        filePath: '/tmp/ulid-1/front.jpg',
        fileName: 'front.jpg',
        mimeType: 'image/jpeg',
        createdAt: '2026-05-12T00:00:00.000Z',
      })
      // Second attach (side) trips the codec / DB layer — simulating any
      // failure mode that lands renderer-side after the session row has
      // already committed.
      .mockRejectedValueOnce('photo decode failed: synthetic test failure');
    mockedDeleteSession.mockResolvedValueOnce(undefined);

    const onSaved = vi.fn(async () => undefined);
    const onError = vi.fn();

    const { container } = render(
      <OrthodonticPhotoCaptureModal
        childId="child-1"
        caseId="case-1"
        appliance={makeAppliance()}
        onClose={() => undefined}
        onSaved={onSaved}
        onError={onError}
      />,
    );

    await pickFrontAndSide(container);

    const submit = screen.getByRole('button', { name: '保存' });
    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(mockedDeleteSession).toHaveBeenCalledTimes(1);
    });

    // The rollback MUST target the same sessionId the insert used, and the
    // childId MUST round-trip — that's what the v18 cascade trigger keys on.
    expect(mockedDeleteSession).toHaveBeenCalledWith({
      sessionId: 'ulid-1',
      childId: 'child-1',
    });

    // onSaved must NOT fire — the parent's reload loop runs only on a
    // successful capture. The localError banner surfaces the failure.
    expect(onSaved).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });

  it('does not call rollback when the session insert itself fails', async () => {
    // Failure happens BEFORE any DB write commits — there is nothing on
    // the server side to clean up, so deleteOrthodonticPhotoSession must
    // stay quiet. (Otherwise we'd be telling Rust to delete a row that
    // never existed, surfacing a confusing fail-close.)
    mockedInsertSession.mockRejectedValueOnce('caseId does not round-trip');

    const onSaved = vi.fn(async () => undefined);
    const onError = vi.fn();

    const { container } = render(
      <OrthodonticPhotoCaptureModal
        childId="child-1"
        caseId="case-1"
        appliance={makeAppliance()}
        onClose={() => undefined}
        onSaved={onSaved}
        onError={onError}
      />,
    );

    await pickFrontAndSide(container);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    expect(mockedDeleteSession).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('keeps the sessionId stable across retries so the rollback can find what insert wrote', async () => {
    // First submit fails partway through, rollback runs. Then the user
    // hits 保存 again with the same modal state — the second submit MUST
    // reuse the same sessionId so the rollback semantics stay coherent.
    mockedInsertSession
      .mockRejectedValueOnce('first attempt fails before any side-effect')
      .mockResolvedValueOnce({
        sessionId: 'ulid-1',
        childId: 'child-1',
        caseId: 'case-1',
        applianceId: 'appl-1',
        trayIndex: null,
        sessionDate: '2026-05-12',
        note: null,
        createdAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-12T00:00:00.000Z',
      });
    mockedAttach
      .mockResolvedValueOnce({
        attachmentId: 'att-front',
        childId: 'child-1',
        sessionId: 'ulid-1',
        angle: 'front',
        filePath: '/tmp/ulid-1/front.jpg',
        fileName: 'front.jpg',
        mimeType: 'image/jpeg',
        createdAt: '2026-05-12T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        attachmentId: 'att-side',
        childId: 'child-1',
        sessionId: 'ulid-1',
        angle: 'side',
        filePath: '/tmp/ulid-1/side.jpg',
        fileName: 'side.jpg',
        mimeType: 'image/jpeg',
        createdAt: '2026-05-12T00:00:00.000Z',
      });

    const onSaved = vi.fn(async () => undefined);
    const onError = vi.fn();

    const { container } = render(
      <OrthodonticPhotoCaptureModal
        childId="child-1"
        caseId="case-1"
        appliance={makeAppliance()}
        onClose={() => undefined}
        onSaved={onSaved}
        onError={onError}
      />,
    );

    await pickFrontAndSide(container);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });
    await waitFor(() => expect(onError).toHaveBeenCalled());

    // Re-submit.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const firstInsertCall = mockedInsertSession.mock.calls[0]?.[0];
    const secondInsertCall = mockedInsertSession.mock.calls[1]?.[0];
    expect(firstInsertCall?.sessionId).toBe(secondInsertCall?.sessionId);
    expect(firstInsertCall?.sessionId).toBe('ulid-1');
  });
});
