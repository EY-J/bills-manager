import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const swBuildId = String(Date.now())

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SW_BUILD_ID': JSON.stringify(swBuildId),
  },
})
