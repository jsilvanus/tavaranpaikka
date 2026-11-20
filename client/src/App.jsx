import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import StoragesPage from './pages/StoragesPage.jsx';
import StorageSummaryPage from './pages/StorageSummaryPage.jsx';
import ScanPage from './pages/ScanPage.jsx';
import ManagePage from './pages/ManagePage.jsx';
import PrintPage from './pages/PrintPage.jsx';
import PrivacyPage from './pages/PrivacyPage.jsx';
import RequireRole from './components/RequireRole.jsx';
import { MeProvider } from './MeContext.jsx';

export default function App() {
  return (
    <MeProvider>
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/storages" replace />} />
        <Route path="/storages" element={<StoragesPage />} />
        <Route path="/storages/:id" element={<StorageSummaryPage />} />
        <Route path="/c/:code" element={<ScanPage />} />
        <Route path="/manage" element={
            <RequireRole min="keeper">
              <ManagePage />
            </RequireRole>
          } />
        <Route path="/print" element={
            <RequireRole min="keeper">
              <PrintPage />
            </RequireRole>
          } />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<Navigate to="/storages" replace />} />
      </Routes>
    </Layout>
    </MeProvider>
  );
}
