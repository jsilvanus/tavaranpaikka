import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PrintPage from '../src/pages/PrintPage.jsx';
import { resetMockState } from '../src/api/mock.js';

describe('PrintPage', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MOCK', '1');
    resetMockState();
  });

  it('updates live A4 preview immediately when toggling name, place, and layout', async () => {
    render(
      <MemoryRouter>
        <PrintPage />
      </MemoryRouter>
    );

    // Wait for targets to load
    const targetList = await screen.findByTestId('print-target-list');
    await waitFor(() => {
      expect(within(targetList).getByText('Projektori Epson EB-W49')).toBeInTheDocument();
    });

    // Select the projector item checkbox
    const projectorCheckbox = within(targetList)
      .getByText('Projektori Epson EB-W49')
      .closest('label')
      .querySelector('input[type="checkbox"]');
    fireEvent.click(projectorCheckbox);

    const preview = screen.getByTestId('print-preview');
    expect(within(preview).getByText('Projektori Epson EB-W49')).toBeInTheDocument();
    expect(
      within(preview).getByText('Keittiön varasto > Hyllykkö A > Ylähylly')
    ).toBeInTheDocument();

    // Toggle off global "Näytä nimi"
    fireEvent.click(screen.getByLabelText('Näytä nimi'));
    expect(within(preview).queryByText('Projektori Epson EB-W49')).not.toBeInTheDocument();

    // Toggle off global "Näytä sijainti"
    fireEvent.click(screen.getByLabelText('Näytä sijainti'));
    expect(
      within(preview).queryByText('Keittiön varasto > Hyllykkö A > Ylähylly')
    ).not.toBeInTheDocument();

    // Change layout to a4-2x7
    fireEvent.change(screen.getByLabelText('Arkkikoko'), { target: { value: 'a4-2x7' } });
    const sheetEl = preview.querySelector('[data-layout]');
    expect(sheetEl).toHaveAttribute('data-layout', 'a4-2x7');
  });
});
