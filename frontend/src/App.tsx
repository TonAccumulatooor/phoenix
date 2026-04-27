import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { Propose } from './pages/Propose';
import { MigrationDashboard } from './pages/MigrationDashboard';
import { Tracker } from './pages/Tracker';
import { Vote } from './pages/Vote';
import { Token } from './pages/Token';
import { Docs } from './pages/Docs';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/propose" element={<Propose />} />
        <Route path="/migration/:id" element={<MigrationDashboard />} />
        <Route path="/migrations" element={<Tracker />} />
        <Route path="/vote/:id" element={<Vote />} />
        <Route path="/token" element={<Token />} />
        <Route path="/docs" element={<Docs />} />
      </Route>
    </Routes>
  );
}
