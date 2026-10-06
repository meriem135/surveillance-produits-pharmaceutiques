import { lazy, Suspense, useCallback } from 'react';
import { NavLink, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Activity, ShieldAlert, Users,
  Moon, Sun, ChevronDown, Cpu, RefreshCw, LogOut, User, Brain, Sparkles, LayoutDashboard,
  Pill, LineChart, ScrollText, Radio,
} from 'lucide-react';
import type { NavItem, ThemeMode } from '../types';

const Phase1Page = lazy(() => import('../pages/Phase1Page'));
const Phase2Page = lazy(() => import('../pages/Phase2Page'));
const TrainingResultsPage = lazy(() => import('../pages/TrainingResultsPage'));
const ShapDashboardPage = lazy(() => import('../pages/ShapDashboardPage'));
const ShapPointReportPage = lazy(() => import('../pages/ShapPointReportPage'));
const AdminUsersPage = lazy(() => import('../pages/AdminUsersPage'));
const ProfilePage = lazy(() => import('../pages/ProfilePage'));
const TableauDeBordPage = lazy(() => import('../pages/TableauDeBordPage'));
const PharmaImpactPage = lazy(() => import('../pages/PharmaImpactPage'));
const AdvancedAnalyticsPage = lazy(() => import('../pages/AdvancedAnalyticsPage'));
const AuditLogsPage = lazy(() => import('../pages/AuditLogsPage'));
const TransmissionPage = lazy(() => import('../pages/TransmissionPage'));
const NAV_ITEMS: NavItem[] = [
  { label: 'Tableau de bord', path: '/dashboard/tableau-bord', icon: 'layout', roles: ['admin', 'operator'] },
  { label: 'Ingestion', path: '/dashboard/phase1', icon: 'cpu', roles: ['admin', 'operator'] },
  { label: 'ML & Anomalies', path: '/dashboard/phase2', icon: 'activity', roles: ['admin', 'operator'] },
  { label: 'Transmission', path: '/dashboard/transmission', icon: 'radio', roles: ['admin', 'operator'] },
  { label: 'SHAP', path: '/dashboard/shap', icon: 'sparkles', roles: ['admin', 'operator'] },
  { label: 'Résultats', path: '/dashboard/results', icon: 'brain', roles: ['admin', 'operator'] },
  { label: 'Analyses', path: '/dashboard/analyses', icon: 'chart', roles: ['admin', 'operator'] },
  { label: 'Impact pharma', path: '/dashboard/pharma', icon: 'pill', roles: ['admin', 'operator'] },
  { label: 'Comptes', path: '/dashboard/admin-users', icon: 'layout', roles: ['admin'] },
  { label: 'Audit', path: '/dashboard/audit', icon: 'scroll', roles: ['admin'] },
  { label: 'Mon profil', path: '/dashboard/profile', icon: 'layout', roles: ['admin', 'operator'] },
];

const PAGE_ROLES: Record<string, string[]> = {
  '/dashboard/phase1': ['admin', 'operator'],
  '/dashboard/phase2': ['admin', 'operator'],
  '/dashboard/transmission': ['admin', 'operator'],
  '/dashboard/shap': ['admin', 'operator'],
  '/dashboard/results': ['admin', 'operator'],
  '/dashboard/tableau-bord': ['admin', 'operator'],
  '/dashboard/kpi': ['admin', 'operator'],
  '/dashboard/dataset': ['admin', 'operator'],
  '/dashboard/analyses': ['admin', 'operator'],
  '/dashboard/pharma': ['admin', 'operator'],
  '/dashboard/admin-users': ['admin'],
  '/dashboard/audit': ['admin'],
  '/dashboard/profile': ['admin', 'operator'],
};

const NAV_ICONS: Record<string, React.ReactNode> = {
  '/dashboard/phase1': <Cpu className="w-4 h-4" />,
  '/dashboard/phase2': <Activity className="w-4 h-4" />,
  '/dashboard/transmission': <Radio className="w-4 h-4" />,
  '/dashboard/shap': <Sparkles className="w-4 h-4" />,
  '/dashboard/results': <Brain className="w-4 h-4" />,
  '/dashboard/tableau-bord': <LayoutDashboard className="w-4 h-4" />,
  '/dashboard/analyses': <LineChart className="w-4 h-4" />,
  '/dashboard/pharma': <Pill className="w-4 h-4" />,
  '/dashboard/admin-users': <Users className="w-4 h-4" />,
  '/dashboard/audit': <ScrollText className="w-4 h-4" />,
  '/dashboard/profile': <User className="w-4 h-4" />,
};

const THEME_ICONS: Record<ThemeMode, React.ReactNode> = {
  dark: <Moon className="w-3.5 h-3.5" />,
  cyberpunk: <Cpu className="w-3.5 h-3.5" />,
  matrix: <Activity className="w-3.5 h-3.5" />,
  light: <Sun className="w-3.5 h-3.5" />,
};

const THEME_LABELS: Record<ThemeMode, string> = {
  dark: 'Dark',
  cyberpunk: 'Cyberpunk',
  matrix: 'Matrix',
  light: 'Light',
};

export default function DashboardLayout() {
  const { theme, nextTheme } = useTheme();
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const role = user?.role ?? '';
  const visibleNav = NAV_ITEMS.filter(item => !item.roles || item.roles.includes(role));

  const canAccess = (path: string): boolean => {
    const roles = PAGE_ROLES[path] || [];
    return roles.includes(role);
  };

  const handleLogout = useCallback(() => {
    logout();
    navigate('/login');
  }, [logout, navigate]);

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--color-bg-base)' }}>
      <header className="flex items-center justify-between px-6 h-14 shrink-0" style={{
        background: 'var(--color-bg-panel)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold cursor-pointer" style={{
            background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-purple))',
            color: '#fff',
          }} onClick={() => navigate('/')}>VC</div>
          <div className="font-display font-bold text-sm tracking-wide cursor-pointer" style={{ color: 'var(--color-text-primary)' }} onClick={() => navigate('/')}>VigiloChain</div>
          <span className="text-[10px] font-mono ml-1 hidden sm:inline" style={{ color: 'var(--color-text-secondary)' }}>Cold Chain Security Platform</span>
        </div>

        <div className="flex items-center gap-3">

          

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                {THEME_ICONS[theme]}
                <span className="hidden sm:inline">{THEME_LABELS[theme]}</span>
                <ChevronDown className="w-3 h-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Thèmes</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(Object.entries(THEME_LABELS) as [ThemeMode, string][]).map(([key, label]) => (
                <DropdownMenuItem key={key} onClick={() => key !== theme && nextTheme()}>
                  {THEME_ICONS[key]}
                  <span>{label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <User className="w-4 h-4" />
                <span className="hidden sm:inline text-xs max-w-[100px] truncate">{user?.username}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user?.full_name || user?.username}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                <Badge variant="outline" className="text-[10px]">{user?.role}</Badge>
                <span className="ml-2 text-xs">{user?.email}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-400">
                <LogOut className="w-4 h-4 mr-2" />
                Déconnexion
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="ghost" size="icon" onClick={() => window.location.reload()}>
            <RefreshCw className="w-4 h-4" />
          </Button>

          <span className="text-[11px] font-mono opacity-40 hidden sm:inline" style={{ color: 'var(--color-text-secondary)' }}></span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="flex flex-col gap-1 px-2 py-4 w-56 shrink-0 overflow-y-auto scrollbar-thin" style={{
          background: 'var(--color-bg-panel)',
          borderRight: '1px solid var(--color-border)',
        }}>
          {visibleNav.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={false}
                className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium no-underline rounded-lg transition-all duration-200"
                style={{
                  color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                  backgroundColor: isActive ? 'color-mix(in srgb, var(--color-accent-primary) 12%, transparent)' : 'transparent',
                }}
              >
                {NAV_ICONS[item.path]}
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--color-bg-base)' }}>
          <Suspense fallback={
            <div className="flex items-center justify-center h-64">
              <div className="w-6 h-6 border-2 rounded-full animate-spin"
                style={{ borderColor: 'var(--color-accent-primary)', borderTopColor: 'transparent' }} />
            </div>
          }>
            <Routes>
              <Route path="/dashboard" element={<Navigate to="/dashboard/tableau-bord" replace />} />
              <Route path="/dashboard/phase1" element={canAccess('/dashboard/phase1') ? <Phase1Page /> : <AccessDenied />} />
              <Route path="/dashboard/phase2" element={canAccess('/dashboard/phase2') ? <Phase2Page /> : <AccessDenied />} />
              <Route path="/dashboard/transmission" element={canAccess('/dashboard/transmission') ? <TransmissionPage /> : <AccessDenied />} />
              <Route path="/dashboard/shap" element={canAccess('/dashboard/shap') ? <ShapDashboardPage /> : <AccessDenied />} />
              <Route path="/dashboard/shap/report" element={canAccess('/dashboard/shap') ? <ShapPointReportPage /> : <AccessDenied />} />
              <Route path="/dashboard/results" element={canAccess('/dashboard/results') ? <TrainingResultsPage /> : <AccessDenied />} />
              <Route path="/dashboard/analytics" element={<Navigate to="/dashboard/results" replace />} />
              <Route path="/dashboard/phase3" element={<Navigate to="/dashboard/shap" replace />} />
              <Route path="/dashboard/tableau-bord" element={canAccess('/dashboard/tableau-bord') ? <TableauDeBordPage /> : <AccessDenied />} />
              <Route path="/dashboard/kpi" element={<Navigate to="/dashboard/tableau-bord" replace />} />
              <Route path="/dashboard/dataset" element={<Navigate to="/dashboard/tableau-bord" replace />} />
              <Route path="/dashboard/analyses" element={canAccess('/dashboard/analyses') ? <AdvancedAnalyticsPage /> : <AccessDenied />} />
              <Route path="/dashboard/pharma" element={canAccess('/dashboard/pharma') ? <PharmaImpactPage /> : <AccessDenied />} />
              <Route path="/dashboard/admin-users" element={canAccess('/dashboard/admin-users') ? <AdminUsersPage /> : <AccessDenied />} />
              <Route path="/dashboard/audit" element={canAccess('/dashboard/audit') ? <AuditLogsPage /> : <AccessDenied />} />
              <Route path="/dashboard/profile" element={canAccess('/dashboard/profile') ? <ProfilePage /> : <AccessDenied />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function AccessDenied() {
  const { user } = useAuth();
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
      <ShieldAlert className="w-12 h-12" style={{ color: 'var(--color-text-muted)' }} />
      <div className="font-display font-bold text-lg" style={{ color: 'var(--color-text-primary)' }}>
        Accès refusé
      </div>
      <div className="text-sm max-w-md" style={{ color: 'var(--color-text-secondary)' }}>
        Votre rôle (<strong>{user?.role}</strong>) ne vous permet pas d'accéder à cette page.
      </div>
    </div>
  );
}
