// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MarketplacePanel } from './MarketplacePanel';
import { createHubStore } from '../shell/hubStore';
import { createMockAdeApi } from '../shell/mocks';

afterEach(cleanup);

describe('MarketplacePanel', () => {
  it('marks unbuilt animals as coming soon', () => {
    render(<MarketplacePanel store={createHubStore()} api={createMockAdeApi()} onClose={() => {}} />);
    for (const name of ['Iris', 'Celene']) {
      const card = screen.getByText(name).closest('.hub-market-card');
      expect(card?.textContent).toContain('Coming soon');
      expect(card?.textContent).not.toContain('Installed');
    }
  });
});
