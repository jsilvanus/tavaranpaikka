import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PrintPage from '../src/pages/PrintPage.jsx';
import { resetMockState } from '../src/api/mock.js';

describe('PrintPage size, font and logo controls', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MOCK', '1');
    resetMockState();
  });

  it('has qr/font sliders and places a separate logo left or right', async () => {
    render(
      <MemoryRouter>
        <PrintPage />
      </MemoryRouter>
    );
    const list = await screen.findByTestId('print-target-list');
    await waitFor(() => expect(within(list).getAllByRole('checkbox').length).toBeGreaterThan(0));
    fireEvent.click(within(list).getAllByRole('checkbox')[0]);

    const qr = screen.getByLabelText(/QR-koodin koko/);
    const font = screen.getByLabelText(/Tekstikoko/);
    expect(qr).toHaveAttribute('type', 'range');
    expect(font).toHaveAttribute('type', 'range');
    fireEvent.change(qr, { target: { value: '1.5' } });
    expect(screen.getByLabelText(/QR-koodin koko \(150 %\)/)).toBeInTheDocument();

    const preview = screen.getByTestId('print-preview');
    expect(within(preview).queryByTestId('label-logo-left')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Logon sijainti'), { target: { value: 'left' } });
    expect(within(preview).getByTestId('label-logo-left')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Logon sijainti'), { target: { value: 'right' } });
    expect(within(preview).getByTestId('label-logo-right')).toBeInTheDocument();
  });
});
