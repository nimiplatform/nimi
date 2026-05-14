// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProfileHero } from './profile-page-hero.js';

const child = {
  childId: 'child-1',
  displayName: '小米',
  birthDate: '2020-01-01',
  gender: 'female' as const,
  avatarPath: null,
};

describe('ProfileHero', () => {
  it('renders edit action with icon without violating single-child slot constraints', () => {
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route
            path="/profile"
            element={(
              <ProfileHero
                child={child}
                ageMonths={72}
                completeness={80}
                recordCount={3}
                lastRecordedDaysAgo={2}
                onAddRecord={vi.fn()}
              />
            )}
          />
          <Route path="/settings/children" element={<div>children settings</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /编辑资料/ }));

    expect(screen.getByText('children settings')).toBeTruthy();
  });
});
