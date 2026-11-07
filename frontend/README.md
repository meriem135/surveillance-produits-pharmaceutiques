# VigiloChain — Dashboard Frontend

React 19 + Vite 8 + TypeScript 6 + Tailwind 4 + shadcn/ui

## Structure

```
frontend/src/
├── App.tsx              HashRouter : /, /login, /register, /* (protégé)
├── layouts/             DashboardLayout : navigation + contrôle d'accès par rôle
├── pages/
│   ├── HomePage              page publique (KPIs du dataset)
│   ├── OverviewPage          vue d'ensemble lue en base
│   ├── etude/                Temps réel, Détection vs réalité, Rapport, Résultats,
│   │                         Explicabilité SHAP, Jeu de données, Entraînement, Paramètres
│   ├── AdminUsersPage        comptes (admin)       AuditLogsPage   journal d'audit (admin)
│   └── ProfilePage, LoginPage, RegisterPage
├── components/          ui/ (shadcn) + panneaux métier
├── contexts/            AuthContext (JWT, expiration, 401 → déconnexion), ThemeContext
└── types.ts
```

## Démarrage

```bash
npm ci
npm run dev                                   # http://localhost:5173, proxy /api → :8000
BACKEND_URL=http://localhost:8010 npm run dev # backend sur un autre port
```

## Build

```bash
npm run build     # dist/
npm run deploy    # build + copie dans ../backend/static (servi sur /dashboard)
```
