import { lazy, Suspense, useCallback } from 'react';
import { NavLink, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/use-toast';
import {
  AlertTriangle, Activity, ShieldAlert, Monitor,
  Moon, Sun, ChevronDown, Bell, Cpu, RefreshCw
} from 'lucide-react';
import type { NavItem, ThemeMode } from '../types';

const AlertsPage = lazy(() => import('../pages/AlertsPage'));
const DevicesPage = lazy(() => import('../pages/DevicesPage'));
const Phase1Page = lazy(() => import('../pages/Phase1Page'));
const Phase1DpiDetailPage = lazy(() => import('../pages/Phase1DpiDetailPage'));
const Phase2Page = lazy(() => import('../pages/Phase2Page'));
const Phase3Page = lazy(() => import('../pages/Phase3Page'));

const NAV_ITEMS: NavItem[] = [
  { label: 'Ingestion', path: '/dashboard/phase1', icon: 'cpu' },
  { label: 'ML', path: '/dashboard/phase2', icon: 'activity' },
  { label: 'Risques', path: '/dashboard/phase3', icon: 'shield' },
  { label: 'Alertes', path: '/dashboard/alerts', icon: 'alert' },
  { label: 'Appareils', path: '/dashboard/devices', icon: 'monitor' },
];

const NAV_ICONS: Record<string, React.ReactNode> = {
  '/dashboard/phase1': <Cpu className="w-4 h-4" />,
  '/dashboard/phase2': <Activity className="w-4 h-4" />,
  '/dashboard/phase3': <ShieldAlert className="w-4 h-4" />,
  '/dashboard/alerts': <AlertTriangle className="w-4 h-4" />,
  '/dashboard/devices': <Monitor className="w-4 h-4" />,
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
  const location = useLocation();
  const navigate = useNavigate();

  const handleSimulateAlert = useCallback(() => {
    toast({
      title: 'Nouvelle alerte',
      description: 'Anomalie détectée sur le réseau — risque élevé',
      variant: 'destructive',
    });
  }, []);

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
          }} onClick={() => navigate('/')}>PS</div>
          <div className="font-display font-bold text-sm tracking-wide cursor-pointer" style={{ color: 'var(--color-text-primary)' }} onClick={() => navigate('/')}>PEAKSOFT</div>
          <span className="text-[10px] font-mono ml-1 hidden sm:inline" style={{ color: 'var(--color-text-secondary)' }}>Security Platform</span>
          <Badge variant="success" className="ml-2 hidden md:inline-flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse-dot" />
            LIVE
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={handleSimulateAlert}>
                <Bell className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Simuler une alerte</TooltipContent>
          </Tooltip>

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

          <Button variant="ghost" size="icon" onClick={() => window.location.reload()}>
            <RefreshCw className="w-4 h-4" />
          </Button>

          <span className="text-[11px] font-mono opacity-40 hidden sm:inline" style={{ color: 'var(--color-text-secondary)' }}>v2.0.0</span>
        </div>
      </header>

      <nav className="flex items-center gap-1 px-4 overflow-x-auto shrink-0 scrollbar-thin" style={{
        background: 'var(--color-bg-panel)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/dashboard/phase1'}
              className="flex items-center gap-2 px-4 py-3 text-sm font-medium no-underline whitespace-nowrap transition-all duration-200 border-b-2 shrink-0"
              style={{
                color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                borderBottomColor: isActive ? 'var(--color-accent-primary)' : 'transparent',
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
              <Route path="/dashboard" element={<Navigate to="/dashboard/phase2" replace />} />
              <Route path="/dashboard/phase1" element={<Phase1Page />} />
              <Route path="/dashboard/phase1/dpi/:id" element={<Phase1DpiDetailPage />} />
              <Route path="/dashboard/phase2" element={<Phase2Page />} />
              <Route path="/dashboard/phase3" element={<Phase3Page />} />
              <Route path="/dashboard/alerts" element={<AlertsPage />} />
              <Route path="/dashboard/devices" element={<DevicesPage />} />
            </Routes>
          </Suspense>
      </div>
    </div>
  );
}
