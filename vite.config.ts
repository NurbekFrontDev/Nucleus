import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // React Compiler: автоматическая мемоизация во всех компонентах (меньше перерисовок).
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  // Настройки для Tauri (десктоп): стабильный порт и игнор папки src-tauri.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // НЕ следим за сборочными артефактами Rust/Tauri — иначе Vite падает с EBUSY
      // на заблокированных .exe во время компиляции.
      ignored: ['**/src-tauri/**'],
    },
  },
})
