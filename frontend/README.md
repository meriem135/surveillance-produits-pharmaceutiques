# PeakSoft Security — Dashboard Frontend

React 19 + Vite 8 + TypeScript 6 + Tailwind 4 + shadcn/ui

## Structure

```
frontend/src/
├── App.tsx              ← HashRouter (/, /login, /*)
├── layouts/             ← DashboardLayout (navigation 7 pages)
├── pages/               ← Pages principales
│   ├── Phase1Page       ← Ingestion & DPI
│   ├── Phase2Page       ← ML & Anomalies
│   ├── Phase3Page       ← Risques
│   ├── AlertsPage       ← Alertes
│   └── DevicesPage      ← Appareils
├── components/
│   ├── ui/              ← shadcn (button, card, dialog...)
│   └── *panels          ← Charts, KPI, Risk, DPI, etc.
├── hooks/               ← useTelemetry, useRiskData
├── contexts/            ← ThemeContext (4 thèmes)
└── types.ts             ← Interfaces TS complètes
```

## Démarrage

```bash
npm install
npm run dev
# → http://localhost:5173
```

## Build

```bash
npm run build
# dist/ → copier vers backend/static/
```
