import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Split large vendor libraries into separate chunks to reduce the main bundle size
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('firebase')) return 'vendor_firebase';
            if (id.includes('framer-motion')) return 'vendor_framer_motion';
            if (id.includes('lucide-react')) return 'vendor_icons';
            if (id.includes('date-fns')) return 'vendor_datefns';
            return 'vendor';
          }
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})