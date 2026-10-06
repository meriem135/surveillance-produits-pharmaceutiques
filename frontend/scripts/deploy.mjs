// Copie le build Vite (dist/) dans backend/static, servi par FastAPI sur /dashboard.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist');
const target = resolve(here, '../../backend/static');

if (!existsSync(dist)) {
  console.error('dist/ introuvable : lancez `npm run build` d\'abord.');
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(dist, target, { recursive: true });
console.log(`Build copié dans ${target}`);
