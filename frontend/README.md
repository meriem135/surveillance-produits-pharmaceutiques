# VigiloChain — Dashboard Frontend

React 19 + Vite 8 + TypeScript 6 + Tailwind 4 + shadcn/ui

## Structure

```
frontend/src/
├── App.tsx              HashRouter : /, /login, /register, /* (protégé)
├── layouts/             DashboardLayout : navigation + contrôle d'accès par rôle
├── pages/
│   ├── HomePage              page publique (KPIs du dataset)
│   ├── TableauDeBordPage     taux d'attaque par mois / heure / saison (+ DatasetOverview)
│   ├── Phase1Page            ingestion temps réel : flux WebSocket, règles et alertes DPI
│   ├── Phase2Page            4 modèles ML, timeline, entraînement en direct
│   ├── ShapDashboardPage     explicabilité SHAP (annuelle, horaire, par point)
│   ├── TrainingResultsPage   résultats détaillés du dernier entraînement
│   ├── AdvancedAnalyticsPage courbes ROC / PR, distributions de score
│   ├── PharmaImpactPage      impact des attaques sur stock / production (GMP)
│   ├── AdminUsersPage        comptes (admin)       AuditLogsPage   journal d'audit (admin)
│   └── ProfilePage, LoginPage, RegisterPage, ShapPointReportPage
├── components/          ui/ (shadcn) + panneaux métier
├── contexts/            AuthContext (JWT, expiration, 401 → déconnexion), ThemeContext
└── types.ts
```

## Démarrage

```bash
npm ci
npm run dev                                   # http://localhost:5173, proxy /api et /ws → :8000
BACKEND_URL=http://localhost:8010 npm run dev # backend sur un autre port
```

## Build

```bash
npm run build     # dist/
npm run deploy    # build + copie dans ../backend/static (servi sur /dashboard)
```
