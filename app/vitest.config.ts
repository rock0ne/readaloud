import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig({ command: 'serve', mode: 'test' }),
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['test/setup.ts'],
      include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    },
  }),
)
