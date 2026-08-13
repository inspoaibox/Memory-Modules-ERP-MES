import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 43128,
    strictPort: true,
    host: "0.0.0.0",
    proxy: {
      "/api": "http://localhost:43127"
    }
  }
});
