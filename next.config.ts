import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Uploads laufen durch proxy.ts (Login-Prüfung). Standard sind nur 10 MB – zu wenig für
    // Video-Referenzen und größere WAV-Dateien.
    proxyClientMaxBodySize: "1gb",
  },
};

export default nextConfig;
