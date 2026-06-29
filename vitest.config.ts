import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Tests de la capa-motor: código puro, entorno node, sin red ni DOM.
// El alias @/ replica el `paths` de tsconfig.json para que los imports `@/lib/...`
// resuelvan igual que en Next.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
