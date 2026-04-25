import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        open: true
    },
    build: {
        outDir: 'dist',
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
