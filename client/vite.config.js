import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
    // Load variables from server/.env
    const env = loadEnv(mode, path.resolve(__dirname, '../server'), '')

    return {
        plugins: [react()],
        define: {
            'process.env.VITE_RECAPTCHA_SITE_KEY': JSON.stringify(env.VITE_RECAPTCHA_SITE_KEY)
        },
        server: {
            proxy: {
                '/api': {
                    target: 'http://localhost:5000',
                    changeOrigin: true
                }
            }
        }
    }
})
