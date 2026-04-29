import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    base: './',
    server: {
        port: 5173,
        strictPort: true
    },
    resolve: {
        alias: {
            'jsmediatags': path.resolve(__dirname, 'node_modules/jsmediatags/build2/jsmediatags.js')
        }
    },
    optimizeDeps: {
        include: ['jsmediatags'],
        esbuildOptions: {
            external: ['react-native-fs']
        }
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            external: [
                'react-native-fs',
                'buffer',
                'fs',
                'path',
                'stream'
            ]
        }
    }
});
