// @ts-check
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';
import { defineConfig } from 'astro/config';
import { wispRelay } from './wisp-relay.plugin.mjs';

export default defineConfig({
    site: 'https://gradeviewer.org',
    output: 'server',
    adapter: vercel(),
    vite: {
        plugins: [tailwindcss(), wispRelay()],
        worker: {
            format: 'es',
        },
        optimizeDeps: {
            exclude: ['libcurl.js'],
        },
    },
});
