import type { NextConfig } from "next";

/**
 * Adresses publiques de l'API et du MCP, stables et lisibles pour les applications et agents :
 *  - `/api/v1/recordings[/…]` est l'API des essais (mêmes routes et mêmes droits que l'atelier) ;
 *  - `/mcp` est le point d'entrée MCP.
 */
const config: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/api/v1/recordings", destination: "/api/sessions" },
      {
        source: "/api/v1/recordings/:path*",
        destination: "/api/sessions/:path*",
      },
      { source: "/mcp", destination: "/api/mcp" },
    ];
  },
};
export default config;
