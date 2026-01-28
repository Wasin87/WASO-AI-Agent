
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // We remove the direct 'process.env.API_KEY' definition to secure the client bundle.
  // Variables used in the client should now be prefixed with VITE_ if needed,
  // but for Gemini we will move to a serverless proxy.
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: './index.html',
      },
    },
  },
});
