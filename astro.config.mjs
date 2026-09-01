// @ts-check
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';
import { defineConfig } from 'astro/config';

export default defineConfig({
    site: 'https://gradeviewer.org',
    output: 'server',
    adapter: vercel(),
    vite: {
        plugins: [tailwindcss()],
    },
});
