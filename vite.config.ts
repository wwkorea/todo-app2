import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true,
    watch: {
      // Rust 빌드 산출물은 감시 제외 — 컴파일 중 잠긴 파일을 watch하면 EBUSY로 vite가 죽는다
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    chunkSizeWarningLimit: 6000
  }
})
