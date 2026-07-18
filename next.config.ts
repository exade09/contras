import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        {
          key: "Content-Security-Policy",
          value: "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://community.akamai.steamstatic.com https://community.cloudflare.steamstatic.com https://community.fastly.steamstatic.com https://cdn.steamstatic.com https://steamcommunity-a.akamaihd.net https://avatars.akamai.steamstatic.com https://avatars.cloudflare.steamstatic.com https://avatars.fastly.steamstatic.com https://avatars.steamstatic.com https://steamcdn-a.akamaihd.net https://raw.githubusercontent.com; connect-src 'self'; font-src 'self' data:; frame-src 'none'; manifest-src 'self'; worker-src 'self' blob:",
        },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
