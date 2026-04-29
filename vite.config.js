import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const emptyShim = path.resolve(__dirname, 'src/shims/empty.js');

export default defineConfig({
    base: './',
    server: {
        port: 5173,
        strictPort: true
    },
    resolve: {
        alias: {
            'jsmediatags': path.resolve(__dirname, 'node_modules/jsmediatags/build2/jsmediatags.js'),
            'react-native-fs': emptyShim,
            'fs': emptyShim,
            'path': emptyShim,
            'stream': emptyShim
        }
    },
    optimizeDeps: {
        include: ['jsmediatags']
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true
    }
});
