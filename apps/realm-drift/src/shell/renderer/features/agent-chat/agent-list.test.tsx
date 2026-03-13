import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.count !== undefined) return `${opts.count} agents`;
      const map: Record<string, string> = {
        'chat.agentEmpty': 'No agents available',
      };
      return map[key] ?? key;
    },
  }),
}));

import { AgentList } from './agent-list.js';
import type { WorldAgent } from '../world-browser/world-browser-data.js';

function makeAgent(overrides: Partial<WorldAgent> & { id: string; name: string }): WorldAgent {
  return { ...overrides };
}

describe('AgentList', () => {
  it('renders agent names', () => {
    const agents = [
      makeAgent({ id: 'a1', name: 'Sage' }),
      makeAgent({ id: 'a2', name: 'Warrior' }),
    ];

    render(<AgentList agents={agents} activeAgentId={null} onSelect={vi.fn()} />);

    expect(screen.getByText('Sage')).toBeDefined();
    expect(screen.getByText('Warrior')).toBeDefined();
  });

  it('renders agent bios (truncated)', () => {
    const agents = [
      makeAgent({
        id: 'a1',
        name: 'Sage',
        bio: 'A wise scholar who has traveled across many realms seeking ancient knowledge.',
      }),
    ];

    render(<AgentList agents={agents} activeAgentId={null} onSelect={vi.fn()} />);

    expect(
      screen.getByText(
        'A wise scholar who has traveled across many realms seeking ancient knowledge.',
      ),
    ).toBeDefined();
  });

  it('shows avatar when avatarUrl present', () => {
    const agents = [
      makeAgent({ id: 'a1', name: 'Sage', avatarUrl: 'https://img.test/sage.png' }),
    ];

    render(<AgentList agents={agents} activeAgentId={null} onSelect={vi.fn()} />);

    const img = screen.getByAltText('Sage') as HTMLImageElement;
    expect(img).toBeDefined();
    expect(img.src).toBe('https://img.test/sage.png');
  });

  it('shows placeholder when no avatar', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Sage' })];

    render(<AgentList agents={agents} activeAgentId={null} onSelect={vi.fn()} />);

    // Placeholder shows first letter uppercased
    expect(screen.getByText('S')).toBeDefined();
  });

  it('calls onSelect when clicked', () => {
    const agent = makeAgent({ id: 'a1', name: 'Sage' });
    const handleSelect = vi.fn();

    render(<AgentList agents={[agent]} activeAgentId={null} onSelect={handleSelect} />);

    fireEvent.click(screen.getByRole('button'));
    expect(handleSelect).toHaveBeenCalledOnce();
    expect(handleSelect).toHaveBeenCalledWith(agent);
  });

  it('shows empty state for no agents', () => {
    render(<AgentList agents={[]} activeAgentId={null} onSelect={vi.fn()} />);

    expect(screen.getByText('No agents available')).toBeDefined();
  });

  it('highlights the active agent', () => {
    const agents = [
      makeAgent({ id: 'a1', name: 'Sage' }),
      makeAgent({ id: 'a2', name: 'Warrior' }),
    ];

    const { container } = render(
      <AgentList agents={agents} activeAgentId="a1" onSelect={vi.fn()} />,
    );

    const buttons = container.querySelectorAll('button');
    // Active agent (a1) should have bg-neutral-700
    expect(buttons[0]!.className).toContain('bg-neutral-700');
    // Inactive agent (a2) should not have bg-neutral-700
    expect(buttons[1]!.className).not.toContain('bg-neutral-700');
  });
});
