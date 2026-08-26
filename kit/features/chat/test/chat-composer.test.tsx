import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer } from '../src/index.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function dispatchTextareaValue(element: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

describe('ChatComposer', () => {
  it('submits on Enter and trims payload', async () => {
    const submit = vi.fn(async () => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ChatComposer adapter={{ submit }} />);
      await flush();
    });

    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    dispatchTextareaValue(textarea as HTMLTextAreaElement, '  hello kit  ');

    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({ text: 'hello kit', attachments: [] });
  });

  it('notifies external draft state when successful submit clears text', async () => {
    const submit = vi.fn(async () => {});
    const onTextChange = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ChatComposer adapter={{ submit }} onTextChange={onTextChange} />);
      await flush();
    });

    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    dispatchTextareaValue(textarea as HTMLTextAreaElement, 'draft message');

    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    });

    expect(submit).toHaveBeenCalledWith({ text: 'draft message', attachments: [] });
    expect(onTextChange).toHaveBeenLastCalledWith('');
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('supports controlled text updates and clears through onTextChange after submit', async () => {
    const submit = vi.fn(async () => {});
    const onTextChange = vi.fn();

    function ControlledComposer() {
      const [text, setText] = useState('');
      return (
        <>
          <button type="button" data-testid="mention" onClick={() => setText('@Sage ')}>
            mention
          </button>
          <ChatComposer
            adapter={{ submit }}
            text={text}
            onTextChange={(nextText) => {
              onTextChange(nextText);
              setText(nextText);
            }}
          />
        </>
      );
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ControlledComposer />);
      await flush();
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const mention = container.querySelector('[data-testid="mention"]');
    expect(textarea.value).toBe('');

    await act(async () => {
      mention?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });
    expect(textarea.value).toBe('@Sage ');

    dispatchTextareaValue(textarea, '@Sage hello');
    expect(onTextChange).toHaveBeenLastCalledWith('@Sage hello');

    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    });

    expect(submit).toHaveBeenCalledWith({ text: '@Sage hello', attachments: [] });
    expect(onTextChange).toHaveBeenLastCalledWith('');
    expect(textarea.value).toBe('');
  });

  it('does not submit on Shift+Enter', async () => {
    const submit = vi.fn(async () => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ChatComposer adapter={{ submit }} />);
      await flush();
    });

    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    dispatchTextareaValue(textarea as HTMLTextAreaElement, 'hello');

    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
      await flush();
    });

    expect(submit).not.toHaveBeenCalled();
  });

  it('submits controlled attachments even when text is empty', async () => {
    const submit = vi.fn(async () => {});
    const attachments = [{ id: 'image-1', label: 'Preview image' }];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ChatComposer
          adapter={{ submit }}
          attachments={attachments}
          onAttachmentsChange={() => {}}
          attachmentsSlot={({ attachments: currentAttachments }) => (
            <div>{currentAttachments.map((attachment) => attachment.label).join(', ')}</div>
          )}
        />,
      );
      await flush();
    });

    const submitButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.getAttribute('type') === 'submit');
    expect(submitButton).toBeTruthy();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(submit).toHaveBeenCalledWith({
      text: '',
      attachments,
    });
  });

  it('renders default attachment preview metadata from adapter', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ChatComposer
          adapter={{ submit: async () => {} }}
          attachments={[{ id: 'image-1', name: 'Screenshot', url: '/preview.png', size: '2 MB' }]}
          onAttachmentsChange={() => {}}
          attachmentAdapter={{
            openPicker: async () => [],
            getKey: (attachment) => attachment.id,
            getLabel: (attachment) => attachment.name,
            getSecondaryLabel: (attachment) => attachment.size,
            getPreviewUrl: (attachment) => attachment.url,
            getKind: () => 'image',
          }}
        />,
      );
      await flush();
    });

    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('/preview.png');
    expect(container.textContent).toContain('Screenshot');
    expect(container.textContent).toContain('2 MB');
  });

  it('renders stacked layout with textarea row and toolbar markers', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ChatComposer
          layout="stacked"
          adapter={{ submit: async () => {} }}
          attachmentAdapter={{ openPicker: async () => [] }}
          voiceState={{
            status: 'idle',
            onToggle: () => undefined,
          }}
          leadingSlot={<div data-testid="leading-slot">Avatar</div>}
          toolbarSlot={<button type="button" data-testid="custom-tool">Tool</button>}
          intentLabel="Cloud intent"
          sendHint="Enter to send"
        />,
      );
      await flush();
    });

    expect(container.querySelector('[data-chat-composer-layout="stacked"]')).toBeTruthy();
    expect(container.querySelector('[data-chat-composer-textarea-row="true"]')).toBeTruthy();
    expect(container.querySelector('[data-chat-composer-textarea="true"]')?.getAttribute('aria-label')).toBe('Type a message...');
    expect(container.querySelector('[data-chat-composer-toolbar="true"]')).toBeTruthy();
    expect(container.querySelector('[data-chat-composer-toolbar-actions="true"]')).toBeTruthy();
    expect(container.querySelector('[data-chat-composer-toolbar-slot="true"]')).toBeTruthy();
    expect(container.querySelector('[data-chat-composer-toolbar-meta="true"]')?.textContent).toContain('Cloud intent');
    expect(container.querySelector('[data-chat-composer-voice="true"]')).toBeTruthy();
    expect(container.querySelector('[data-chat-composer-attach="true"]')).toBeTruthy();
  });

  it('exposes cancel while transcribing without changing recording toggle semantics', async () => {
    const onToggle = vi.fn();
    const onCancel = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ChatComposer
          adapter={{ submit: async () => {} }}
          voiceState={{ status: 'transcribing', onToggle, onCancel }}
        />,
      );
      await flush();
    });

    const transcribingVoice = container.querySelector('[data-chat-composer-voice="true"]');
    const transcribingPrimary = transcribingVoice?.querySelector('button[title="Transcribing…"]');
    const transcribingCancel = Array.from(transcribingVoice?.querySelectorAll('button') || [])
      .find((button) => button.textContent === 'Cancel');
    expect(transcribingPrimary?.hasAttribute('disabled')).toBe(true);
    expect(transcribingCancel).toBeTruthy();
    await act(async () => {
      transcribingCancel?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();

    await act(async () => {
      root?.render(
        <ChatComposer
          adapter={{ submit: async () => {} }}
          voiceState={{ status: 'recording', onToggle, onCancel }}
        />,
      );
      await flush();
    });
    const recordingPrimary = container.querySelector(
      '[data-chat-composer-voice="true"] button[title="Stop recording"]',
    );
    await act(async () => {
      recordingPrimary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('projects partial and final voice transcripts as session-ephemeral composer state', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ChatComposer
          adapter={{ submit: async () => {} }}
          voiceState={{
            status: 'recording',
            onToggle: () => undefined,
            transcript: { text: 'partial speech', final: false },
          }}
        />,
      );
      await flush();
    });

    const partial = container.querySelector('[data-chat-composer-voice-transcript="partial"]');
    expect(partial?.textContent).toBe('partial speech');
    expect(partial?.getAttribute('aria-live')).toBe('polite');

    await act(async () => {
      root?.render(
        <ChatComposer
          adapter={{ submit: async () => {} }}
          voiceState={{
            status: 'transcribing',
            onToggle: () => undefined,
            transcript: { text: 'final speech', final: true },
          }}
        />,
      );
      await flush();
    });

    expect(container.querySelector('[data-chat-composer-voice-transcript="partial"]')).toBeNull();
    expect(container.querySelector('[data-chat-composer-voice-transcript="final"]')?.textContent).toBe('final speech');
  });

  it('keeps stacked toolbar controls flat inside the composer shell', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ChatComposer
          layout="stacked"
          adapter={{ submit: async () => {} }}
          attachmentAdapter={{ openPicker: async () => [] }}
          voiceState={{
            status: 'idle',
            onToggle: () => undefined,
          }}
          leadingSlot={<button type="button" data-testid="avatar-entry">A</button>}
          toolbarSlot={<button type="button" data-testid="custom-tool">Tool</button>}
          intentLabel="Local intent"
        />,
      );
      await flush();
    });

    const actions = container.querySelector('[data-chat-composer-toolbar-actions="true"]');
    const trailing = container.querySelector('[data-chat-composer-toolbar-trailing="true"]');

    expect(actions?.getAttribute('data-chat-composer-control-surface')).toBe('flat');
    expect(trailing?.getAttribute('data-chat-composer-control-surface')).toBe('flat');
    expect(actions?.className).not.toContain('rounded-full');
    expect(trailing?.className).not.toContain('rounded-full');
  });

  it('hides unavailable stacked controls when no voice or attachment capability exists', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ChatComposer layout="stacked" adapter={{ submit: async () => {} }} />);
      await flush();
    });

    expect(container.querySelector('[data-chat-composer-layout="stacked"]')).toBeTruthy();
    expect(container.querySelector('[data-chat-composer-voice="true"]')).toBeNull();
    expect(container.querySelector('[data-chat-composer-attach="true"]')).toBeNull();
    expect(container.querySelector('[data-chat-composer-send="true"]')).toBeTruthy();
  });
});
