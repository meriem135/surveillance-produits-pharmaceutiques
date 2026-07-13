import { Routes, Route } from 'react-router-dom';
import { HashRouter } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import DashboardLayout from './layouts/DashboardLayout';

export default function App() {
  return (
    <HashRouter>
      <ThemeProvider>
        <TooltipProvider delayDuration={200}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/*" element={<DashboardLayout />} />
          </Routes>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </HashRouter>
  );
}
