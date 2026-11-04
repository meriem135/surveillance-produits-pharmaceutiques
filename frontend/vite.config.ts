import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Backend cible du proxy de dev (surcharge : BACKEND_URL=http://localhost:8010 npm run dev)
const backend = process.env.BACKEND_URL ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: backend,
        changeOrigin: true,
        ws: true,
      },
      '/ws': {
        target: backend.replace(/^http/, 'ws'),
        ws: true,
      },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Groupes précis avec priorité : sans cela, le groupe des graphiques capturait React (dépendance
        // de recharts) et l'entrée préchargeait 450 ko de graphiques sur toutes les pages, même la connexion.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser|clsx|tailwind-merge|class-variance-authority)[\\/]/, priority: 30 },
            { name: 'vendor-icons', test: /node_modules[\\/]lucide-react[\\/]/, priority: 20 },
            { name: 'vendor-charts', test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|@reduxjs|redux|react-redux|immer|reselect|es-toolkit|eventemitter3|decimal\.js-light|tiny-invariant|internmap|use-sync-external-store|react-is)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  appType: 'spa',
})
