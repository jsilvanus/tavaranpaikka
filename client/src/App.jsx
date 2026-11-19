import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import StoragesPage from './pages/StoragesPage.jsx';
import StorageSummaryPage from './pages/StorageSummaryPage.jsx';
import ScanPage from './pages/ScanPage.jsx';
import ManagePage from './pages/ManagePage.jsx';
import PrintPage from './pages/PrintPage.jsx';
import PrivacyPage from './pages/PrivacyPage.jsx';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/storages" replace />} />
        <Route path="/storages" element={<StoragesPage />} />
        <Route path="/storages/:id" element={<StorageSummaryPage />} />
        <Route path="/c/:code" element={<ScanPage />} />
        <Route path="/manage" element={<ManagePage />} />
        <Route path="/print" element={<PrintPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<Navigate to="/storages" replace />} />
      </Routes>
    </Layout>
  );
}
