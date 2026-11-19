import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StoragesPage from '../src/pages/StoragesPage.jsx';
import { resetMockState } from '../src/api/mock.js';

describe('StoragesPage', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MOCK', '1');
    resetMockState();
  });

  it('lists storages sorted by needs attention and supports kind filter and search', async () => {
    render(
      <MemoryRouter>
        <StoragesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Keittiön varasto')).toBeInTheDocument();
      expect(screen.getByText('Seurakuntasalin ensiapupakkaus')).toBeInTheDocument();
      expect(screen.getByText('Kappelin sakastikaappi')).toBeInTheDocument();
    });

    // Kappelin sakastikaappi has 0 issues, so it should be last under attention sort
    const cards = screen.getAllByTestId(/^storage-card-/);
    expect(cards).toHaveLength(3);
    expect(cards[2]).toHaveTextContent('Kappelin sakastikaappi');

    // Filter by kind: first_aid
    fireEvent.change(screen.getByLabelText('Tyyppi'), { target: { value: 'first_aid' } });
    expect(screen.getByText('Seurakuntasalin ensiapupakkaus')).toBeInTheDocument();
    expect(screen.queryByText('Keittiön varasto')).not.toBeInTheDocument();

    // Reset filter and search
    fireEvent.change(screen.getByLabelText('Tyyppi'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Hae säilytyspaikkaa'), {
      target: { value: 'sakasti' },
    });
    expect(screen.getByText('Kappelin sakastikaappi')).toBeInTheDocument();
    expect(screen.queryByText('Keittiön varasto')).not.toBeInTheDocument();
  });
});
