import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the static build works on GitHub Pages (project site) and any
// static host without a server-side router.
export default defineConfig({
  plugins: [react()],
  base: './',
})
