import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { NavLink, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import BandMark, { Wordmark } from '../components/BandMark';
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
  LayoutDashboard, LineChart, ScrollText, Radio, Gauge, Menu, X, Crosshair, FileText, Database, Play, Settings,
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

type Item = { label: string; path: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; roles: string[]; hint?: string };
const ALL = ['admin', 'operator'];

const ADMIN = ['admin'];
const ROLE_LABEL: Record<string, string> = { admin: 'Administrateur', operator: 'Opérateur' };

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
    title: 'Archives : année simulée',
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
    document.title = current ? `${current.label} | VigiloChain` : 'VigiloChain';
  }, [current]);

  const handleLogout = useCallback(() => {
    logout();
    navigate('/login');
  }, [logout, navigate]);

  const sidebar = (
    <nav aria-label="Navigation principale" className="flex flex-col h-full">
      <div className="flex items-center px-5 h-[60px] shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => navigate('/')} aria-label="Accueil VigiloChain" className="rounded-sm">
          <Wordmark sub="Chaîne du froid" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map(group => {
          const items = group.items.filter(i => i.roles.includes(role));
          if (!items.length) return null;
          return (
            <div key={group.title}>
              <div className="px-3 mb-1 text-[12.5px] font-semibold" style={{ color: 'var(--text-muted)' }}>{group.title}</div>
              <div className="space-y-px">
                {items.map(item => {
                  const active = location.pathname.startsWith(item.path);
                  const Icon = item.icon;
                  return (
                    <NavLink key={item.path} to={item.path} title={item.hint} aria-current={active ? 'page' : undefined}
                      className="flex items-center gap-2.5 pl-3 pr-2 h-9 rounded-[3px] text-[14px] no-underline relative"
                      style={{
                        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontWeight: active ? 600 : 400,
                        background: active ? 'var(--bg-panel)' : 'transparent',
                        boxShadow: active ? 'inset 0 0 0 1px var(--border)' : undefined,
                      }}>
                      {active && <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[3px]" style={{ background: 'var(--accent-primary)' }} />}
                      <Icon className="w-4 h-4 shrink-0" style={{ color: active ? 'var(--accent-primary)' : undefined }} />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-5 py-3 text-[12px] leading-snug" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
        Projet de fin d’études : détection d’intrusions IoT sur la chaîne du froid pharmaceutique
      </div>
    </nav>
  );

  const group = NAV_GROUPS.find(g => current && g.items.includes(current))?.title;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      {/* Barre latérale (bureau) */}
      <aside className="hidden lg:block w-[244px] shrink-0" style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)' }}>
        {sidebar}
      </aside>

      {/* Tiroir (téléphone / tablette) */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0" style={{ background: 'rgba(16,22,28,0.55)' }} onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw]" style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)' }}>
            <button className="absolute right-3 top-4 p-1.5 rounded-[3px]" onClick={() => setDrawer(false)} aria-label="Fermer le menu"
              style={{ color: 'var(--text-secondary)' }}>
              <X className="w-5 h-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-3 px-4 sm:px-6 h-[60px] shrink-0"
          style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
          <button className="lg:hidden p-1.5 -ml-1.5 rounded-[3px]" onClick={() => setDrawer(true)} aria-label="Ouvrir le menu"
            style={{ color: 'var(--text-primary)' }}>
            <Menu className="w-5 h-5" />
          </button>
          <span className="lg:hidden"><BandMark size={24} /></span>
          <div className="min-w-0 flex-1 flex items-baseline gap-2 text-[14px] truncate">
            {group && <span className="hidden sm:inline" style={{ color: 'var(--text-muted)' }}>{group} /</span>}
            <span className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{current?.label ?? 'VigiloChain'}</span>
          </div>

          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="h-9 px-2.5 inline-flex items-center gap-1.5 rounded-[4px] border text-[13px]"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
            aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
            title={theme === 'dark' ? 'Thème clair' : 'Thème sombre'}>
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span className="hidden md:inline">{theme === 'dark' ? 'Clair' : 'Sombre'}</span>
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 h-9 pl-1 pr-2 rounded-[4px] border" style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                aria-label={`Compte ${user?.username ?? ''}`}>
                <span className="w-7 h-7 rounded-[3px] flex items-center justify-center text-[13px] font-semibold"
                  style={{ background: 'var(--text-primary)', color: 'var(--bg-panel)', fontFamily: 'var(--display)' }}>
                  {(user?.username ?? '?').slice(0, 2).toUpperCase()}
                </span>
                <span className="hidden sm:flex flex-col items-start leading-tight">
                  <span className="text-[13px] max-w-[120px] truncate">{user?.username}</span>
                  <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{ROLE_LABEL[role] ?? role}</span>
                </span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user?.full_name || user?.username}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                <span className="text-xs">{ROLE_LABEL[role] ?? role}{user?.email ? `, ${user.email}` : ''}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/dashboard/profile')}>
                <User className="w-4 h-4 mr-2" /> Mon profil
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} style={{ color: 'var(--accent-danger)' }}>
                <LogOut className="w-4 h-4 mr-2" /> Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="w-full px-4 py-6 sm:px-8 sm:py-8 2xl:px-10">
            <Suspense fallback={
              <div className="flex items-center justify-center h-64">
                <div className="w-6 h-6 border-2 rounded-full animate-spin" role="status" aria-label="Chargement"
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
    <div className="vc-fiche max-w-xl p-6 flex gap-4 items-start" style={{ borderLeftColor: 'var(--accent-danger)' }}>
      <ShieldAlert className="w-7 h-7 shrink-0" style={{ color: 'var(--accent-danger)' }} />
      <div>
        <h1 className="text-[28px] leading-tight" style={{ color: 'var(--text-primary)' }}>Accès refusé</h1>
        <p className="text-sm mt-1.5" style={{ color: 'var(--text-secondary)' }}>
          Cette page est réservée à l’administrateur. Votre rôle : <strong>{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</strong>.
          Les pages Surveillance et Modèle restent accessibles depuis le menu.
        </p>
      </div>
    </div>
  );
}
