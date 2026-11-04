import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { NavLink, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
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
  Activity, ShieldAlert, Users, Moon, Sun, ChevronDown, Cpu, LogOut, User, Brain, Sparkles,
  LayoutDashboard, LineChart, ScrollText, Radio, Gauge, Menu, X, ShieldCheck, Crosshair, FileText, Database, Play, Settings,
} from 'lucide-react';

const OverviewPage = lazy(() => import('../pages/OverviewPage'));
const Phase1Page = lazy(() => import('../pages/Phase1Page'));
const Phase2Page = lazy(() => import('../pages/Phase2Page'));
const TrainingResultsPage = lazy(() => import('../pages/TrainingResultsPage'));
const ShapDashboardPage = lazy(() => import('../pages/ShapDashboardPage'));
const ShapPointReportPage = lazy(() => import('../pages/ShapPointReportPage'));
const AdminUsersPage = lazy(() => import('../pages/AdminUsersPage'));
const ProfilePage = lazy(() => import('../pages/ProfilePage'));
const TableauDeBordPage = lazy(() => import('../pages/TableauDeBordPage'));
const AuditLogsPage = lazy(() => import('../pages/AuditLogsPage'));
const TempsReelPage = lazy(() => import('../pages/etude/TempsReelPage'));
const DetectionPage = lazy(() => import('../pages/etude/DetectionPage'));
const DatasetPage = lazy(() => import('../pages/etude/DatasetPage'));
const ResultatsPage = lazy(() => import('../pages/etude/ResultatsPage'));
const ShapPage = lazy(() => import('../pages/etude/ShapPage'));
const RapportPage = lazy(() => import('../pages/etude/RapportPage'));
const EntrainementPage = lazy(() => import('../pages/etude/EntrainementPage'));
const ParametresPage = lazy(() => import('../pages/etude/ParametresPage'));

type Item = { label: string; path: string; icon: React.ComponentType<{ className?: string }>; roles: string[]; hint?: string };
const ALL = ['admin', 'operator'];

const ADMIN = ['admin'];

const NAV_GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Surveillance',
    items: [
      { label: "Vue d'ensemble", path: '/dashboard/overview', icon: Gauge, roles: ALL, hint: 'Indicateurs lus en base de données' },
      { label: 'Temps réel', path: '/dashboard/temps-reel', icon: Radio, roles: ALL, hint: 'Le meilleur modèle analyse le flux de mesures' },
      { label: 'Détection vs réalité', path: '/dashboard/detection', icon: Crosshair, roles: ALL, hint: 'Alertes du modèle face aux attaques réelles' },
      { label: "Rapport d'alerte", path: '/dashboard/rapport', icon: FileText, roles: ALL, hint: 'Consignes pour l’opérateur' },
    ],
  },
  {
    title: 'Modèle',
    items: [
      { label: 'Résultats', path: '/dashboard/resultats', icon: Brain, roles: ALL, hint: 'Métriques train / validation / test' },
      { label: 'Explicabilité SHAP', path: '/dashboard/explicabilite', icon: Sparkles, roles: ALL },
      { label: 'Jeu de données', path: '/dashboard/donnees', icon: Database, roles: ALL, hint: 'KPI des traces réelles avec attaques' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Entraînement', path: '/dashboard/entrainement', icon: Play, roles: ADMIN },
      { label: 'Paramètres', path: '/dashboard/parametres', icon: Settings, roles: ADMIN },
      { label: 'Comptes', path: '/dashboard/admin-users', icon: Users, roles: ADMIN },
      { label: "Journal d'audit", path: '/dashboard/audit', icon: ScrollText, roles: ADMIN },
      { label: 'Mon profil', path: '/dashboard/profile', icon: User, roles: ALL },
    ],
  },
  {
    title: 'Archives · année simulée',
    items: [
      { label: 'Ingestion MQTT', path: '/dashboard/phase1', icon: Cpu, roles: ALL, hint: 'Phase 1 : flux des capteurs' },
      { label: 'ML non supervisé', path: '/dashboard/phase2', icon: Activity, roles: ALL, hint: 'Phase 2 : année simulée' },
      { label: 'SHAP phase 2', path: '/dashboard/shap', icon: Sparkles, roles: ALL },
      { label: 'Résultats phase 2', path: '/dashboard/results', icon: LineChart, roles: ALL },
      { label: 'Jeu annuel simulé', path: '/dashboard/tableau-bord', icon: LayoutDashboard, roles: ALL },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap(g => g.items);
const PAGE_ROLES: Record<string, string[]> = Object.fromEntries(ALL_ITEMS.map(i => [i.path, i.roles]));

export default function DashboardLayout() {
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);

  const role = user?.role ?? '';
  const canAccess = (path: string): boolean => (PAGE_ROLES[path] || []).includes(role);
  const current = ALL_ITEMS.find(i => location.pathname.startsWith(i.path));

  useEffect(() => { setDrawer(false); }, [location.pathname]);
  useEffect(() => {
    document.title = current ? `${current.label} — VigiloChain` : 'VigiloChain';
  }, [current]);

  const handleLogout = useCallback(() => {
    logout();
    navigate('/login');
  }, [logout, navigate]);

  const sidebar = (
    <nav aria-label="Navigation principale" className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-5 h-14 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5" aria-label="Accueil VigiloChain">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }}>
            <ShieldCheck className="w-[18px] h-[18px]" />
          </span>
          <span className="text-left leading-tight">
            <span className="block text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>VigiloChain</span>
            <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>Chaîne du froid · IoT</span>
          </span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map(group => {
          const items = group.items.filter(i => i.roles.includes(role));
          if (!items.length) return null;
          return (
            <div key={group.title}>
              <div className="vc-kicker px-3 mb-1.5">{group.title}</div>
              <div className="space-y-0.5">
                {items.map(item => {
                  const active = location.pathname.startsWith(item.path);
                  const Icon = item.icon;
                  return (
                    <NavLink key={item.path} to={item.path} title={item.hint}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium no-underline relative"
                      style={{
                        color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
                        background: active ? 'var(--accent-glow)' : 'transparent',
                      }}>
                      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r" style={{ background: 'var(--accent-primary)' }} />}
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-5 py-3 text-[11px] leading-snug" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
        Projet de fin d’études — détection d’intrusions IoT, produits pharmaceutiques
      </div>
    </nav>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      {/* Barre latérale (bureau) */}
      <aside className="hidden lg:block w-60 shrink-0" style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)' }}>
        {sidebar}
      </aside>

      {/* Tiroir (téléphone / tablette) */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0" style={{ background: 'rgba(8,14,24,0.5)' }} onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw]" style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)' }}>
            <button className="absolute right-3 top-3.5 p-1.5 rounded-md" onClick={() => setDrawer(false)} aria-label="Fermer le menu"
              style={{ color: 'var(--text-secondary)' }}>
              <X className="w-5 h-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-3 px-4 sm:px-6 h-14 shrink-0"
          style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
          <button className="lg:hidden p-1.5 -ml-1.5 rounded-md" onClick={() => setDrawer(true)} aria-label="Ouvrir le menu"
            style={{ color: 'var(--text-primary)' }}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] hidden sm:block" style={{ color: 'var(--text-muted)' }}>
              {NAV_GROUPS.find(g => current && g.items.includes(current))?.title ?? 'VigiloChain'}
            </div>
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{current?.label ?? 'VigiloChain'}</div>
          </div>

          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="h-9 w-9 flex items-center justify-center rounded-md border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
            title={theme === 'dark' ? 'Thème clair' : 'Thème sombre'}>
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 h-9 pl-1 pr-2 rounded-md border" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                <span className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-semibold uppercase"
                  style={{ background: 'var(--accent-glow)', color: 'var(--accent-primary)' }}>
                  {(user?.username ?? '?').slice(0, 2)}
                </span>
                <span className="hidden sm:inline text-xs max-w-[110px] truncate">{user?.username}</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user?.full_name || user?.username}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                <Badge variant="outline" className="text-[10px]">{user?.role}</Badge>
                <span className="ml-2 text-xs">{user?.email}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/dashboard/profile')}>
                <User className="w-4 h-4 mr-2" /> Mon profil
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} style={{ color: 'var(--accent-danger)' }}>
                <LogOut className="w-4 h-4 mr-2" /> Déconnexion
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 sm:py-6">
            <Suspense fallback={
              <div className="flex items-center justify-center h-64">
                <div className="w-6 h-6 border-2 rounded-full animate-spin"
                  style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
              </div>
            }>
              <Routes>
                <Route path="/dashboard" element={<Navigate to="/dashboard/overview" replace />} />
                <Route path="/dashboard/overview" element={canAccess('/dashboard/overview') ? <OverviewPage /> : <AccessDenied />} />
                <Route path="/dashboard/temps-reel" element={canAccess('/dashboard/temps-reel') ? <TempsReelPage /> : <AccessDenied />} />
                <Route path="/dashboard/detection" element={canAccess('/dashboard/detection') ? <DetectionPage /> : <AccessDenied />} />
                <Route path="/dashboard/rapport" element={canAccess('/dashboard/rapport') ? <RapportPage /> : <AccessDenied />} />
                <Route path="/dashboard/resultats" element={canAccess('/dashboard/resultats') ? <ResultatsPage /> : <AccessDenied />} />
                <Route path="/dashboard/explicabilite" element={canAccess('/dashboard/explicabilite') ? <ShapPage /> : <AccessDenied />} />
                <Route path="/dashboard/donnees" element={canAccess('/dashboard/donnees') ? <DatasetPage /> : <AccessDenied />} />
                <Route path="/dashboard/entrainement" element={canAccess('/dashboard/entrainement') ? <EntrainementPage /> : <AccessDenied />} />
                <Route path="/dashboard/parametres" element={canAccess('/dashboard/parametres') ? <ParametresPage /> : <AccessDenied />} />
                <Route path="/dashboard/transmission" element={<Navigate to="/dashboard/resultats" replace />} />
                <Route path="/dashboard/phase1" element={canAccess('/dashboard/phase1') ? <Phase1Page /> : <AccessDenied />} />
                <Route path="/dashboard/phase2" element={canAccess('/dashboard/phase2') ? <Phase2Page /> : <AccessDenied />} />
                <Route path="/dashboard/shap" element={canAccess('/dashboard/shap') ? <ShapDashboardPage /> : <AccessDenied />} />
                <Route path="/dashboard/shap/report" element={canAccess('/dashboard/shap') ? <ShapPointReportPage /> : <AccessDenied />} />
                <Route path="/dashboard/results" element={canAccess('/dashboard/results') ? <TrainingResultsPage /> : <AccessDenied />} />
                <Route path="/dashboard/tableau-bord" element={canAccess('/dashboard/tableau-bord') ? <TableauDeBordPage /> : <AccessDenied />} />
                <Route path="/dashboard/admin-users" element={canAccess('/dashboard/admin-users') ? <AdminUsersPage /> : <AccessDenied />} />
                <Route path="/dashboard/audit" element={canAccess('/dashboard/audit') ? <AuditLogsPage /> : <AccessDenied />} />
                <Route path="/dashboard/profile" element={canAccess('/dashboard/profile') ? <ProfilePage /> : <AccessDenied />} />
                <Route path="*" element={<Navigate to="/dashboard/overview" replace />} />
              </Routes>
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

function AccessDenied() {
  const { user } = useAuth();
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
      <ShieldAlert className="w-12 h-12" style={{ color: 'var(--text-muted)' }} />
      <div className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>Accès refusé</div>
      <div className="text-sm max-w-md" style={{ color: 'var(--text-secondary)' }}>
        Votre rôle (<strong>{user?.role}</strong>) ne vous permet pas d'accéder à cette page.
      </div>
    </div>
  );
}
