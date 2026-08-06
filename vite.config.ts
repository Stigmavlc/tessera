import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base so the same build works locally and under
  // https://<user>.github.io/tessera/
  base: "./",
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
  },
});
