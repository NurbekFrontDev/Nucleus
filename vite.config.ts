import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// Версия приложения берётся из package.json и подставляется в код как
// __APP_VERSION__ (см. src/lib/version.ts). Так номер версии не надо дублировать
// руками в интерфейсе.
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string }

export default defineConfig({
  plugins: [
    react(),
    // React Compiler: автоматическая мемоизация во всех компонентах (меньше перерисовок).
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  // Настройки для Tauri (десктоп): стабильный порт и игнор папки src-tauri.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
