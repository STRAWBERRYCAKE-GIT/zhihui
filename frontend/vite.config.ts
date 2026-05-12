import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/image': 'http://localhost:5000',
      '/user': 'http://localhost:5000',
      '/auth': 'http://localhost:5000',
      // 其他后端路径也加上
    }
  }
})