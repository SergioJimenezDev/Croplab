import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    open: false
  },
  build: {
    outDir: 'build',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Code-splitting manual: separamos las librerías pesadas en chunks propios
        // para que el bundle principal cargue rápido y el 3D se descargue solo cuando
        // el usuario entra a una simulación. Las dependencias de React/router las dejamos
        // en el chunk principal para evitar referencias circulares.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return;
          if (id.includes('three') || id.includes('@react-three')) return 'vendor-three';
          if (id.includes('@tsparticles')) return 'vendor-particles';
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) return 'vendor-charts';
          // El resto (react, router, axios, etc.) se queda en el chunk principal
        }
      }
    }
  }
});
