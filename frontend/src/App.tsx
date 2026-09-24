import { Routes, Route } from 'react-router-dom';
import { HashRouter } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardLayout from './layouts/DashboardLayout';
import PrivateRoute from './components/PrivateRoute';

export default function App() {
  return (
    <HashRouter>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider delayDuration={200}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/*" element={<PrivateRoute><DashboardLayout /></PrivateRoute>} />
            </Routes>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </HashRouter>
  );
}
