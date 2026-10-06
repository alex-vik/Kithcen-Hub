// Сборка PWA из src/web (ADR-001). Прокси к API и манифест — в задачах шага 6.
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
});
