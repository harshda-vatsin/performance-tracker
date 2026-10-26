import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The browser only ever talks to its own origin: /api/* is proxied to the Fastify API, so the
// HttpOnly session cookie is first-party and the API needs no CORS configuration.
const apiTarget = process.env.API_URL ?? 'http://127.0.0.1:4000';
const proxy = { '/api': { target: apiTarget, changeOrigin: false, rewrite: (p: string) => p.replace(/^\/api/, '') } };

export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.WEB_PORT ?? 5173), proxy },
  preview: { port: Number(process.env.WEB_PORT ?? 5173), proxy },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
