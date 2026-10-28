import path from "node:path";
import { defineConfig } from "vitest/config";

// Les composants importent `@/lib/...` (alias de tsconfig) : les tests qui les rendent en ont besoin.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
});
