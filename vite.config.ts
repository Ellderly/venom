import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
let sha = ''; try { sha = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* сборка вне git */ }
const BUILD = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${sha ? ' · ' + sha : ''}`;
export default defineConfig({ base: './', define: { __BUILD__: JSON.stringify(BUILD) }, build: { target: 'es2022', chunkSizeWarningLimit: 2000 }, worker: { format: 'es' } });
