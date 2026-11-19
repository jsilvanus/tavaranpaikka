import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ScanPage from '../src/pages/ScanPage.jsx';
import { resetMockState } from '../src/api/mock.js';

describe('ScanPage', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MOCK', '1');
    resetMockState();
  });

  it('displays scanned item, submits a report, and supports Minä myös voting', async () => {
    render(
      <MemoryRouter initialEntries={['/c/K7M2-QX4D-9']}>
        <Routes>
          <Route path="/c/:code" element={<ScanPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Projektori Epson EB-W49')).toBeInTheDocument();
    });

    // Accessible path text
    expect(
      screen.getByText(/Keittiön varasto > Hyllykkö A > Ylähylly/)
    ).toBeInTheDocument();

    // Click quick report button "Rikki"
    fireEvent.click(screen.getByRole('button', { name: 'Rikki' }));
    expect(screen.getByTestId('report-form')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Lisätieto (valinnainen)'), {
      target: { value: 'Lamppu paloi' },
    });
    fireEvent.change(screen.getByLabelText('Oma nimi (valinnainen)'), {
      target: { value: 'Matti' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lähetä ilmoitus' }));

    await waitFor(() => {
      expect(screen.getByText('Ilmoitus lähetetty. Kiitos!')).toBeInTheDocument();
    });

    // Newly created open report appears with "Minä myös" button
    const meTooBtn = screen.getByRole('button', { name: 'Minä myös' });
    fireEvent.click(meTooBtn);

    await waitFor(() => {
      expect(screen.getByText('2 vahvistanut')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Vahvistettu!' })).toBeDisabled();
    });
  });
});
