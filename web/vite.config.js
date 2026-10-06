import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  server: {
    // 5174 porque a 5173 (padrão do Vite) costuma estar ocupada
    // pelo outro projeto. O mesmo valor aparece no ORIGEM_PAINEL
    // do .env da API, que é o que libera o CORS.
    port: 5174
  }
});
