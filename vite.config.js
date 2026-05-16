import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Single-page React app. The logic core (decisionLogic.js, posterExtraction.ts)
// is plain framework-agnostic code, unit-tested with Vitest under both
// src/**/*.test.{js,jsx} and convex/**/*.test.ts.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['.ngrok-free.app'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}', 'convex/**/*.test.ts'],
  },
})
