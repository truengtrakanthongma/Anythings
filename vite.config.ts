import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // ใช้ path แบบ relative เพื่อให้เปิดได้ทั้งบน GitHub Pages (/Anythings/) และเครื่องตัวเอง
  base: './',
  plugins: [react(), tailwindcss()],
})
