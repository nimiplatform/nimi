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
          modelLabel="GPT-5.4"
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
    expect(container.querySelector('[data-chat-composer-toolbar-meta="true"]')?.textContent).toContain('GPT-5.4');
    expect(container.querySelector('[data-chat-composer-voice="true"]')).toBeTruthy();
    expect(container.querySelector('[data-chat-composer-attach="true"]')).toBeTruthy();
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
