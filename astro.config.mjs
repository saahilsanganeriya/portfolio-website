// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import { darkroom } from './src/styles/shiki-darkroom.mjs';

// Vercel sets the production domain at build time; the fallback is the expected *.vercel.app address.
const site = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'https://portfolio-website.vercel.app';

export default defineConfig({
  site,
  // Every page is prerendered; a route opts into on-demand rendering with `export const prerender = false`,
  // and such routes are cached by Vercel ISR for at most an hour.
  output: 'static',
  adapter: vercel({ isr: { expiration: 3600 } }),
  integrations: [mdx(), react(), sitemap()],
  markdown: {
    shikiConfig: { theme: darkroom },
  },
  devToolbar: { enabled: false },
});
