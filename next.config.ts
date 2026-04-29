import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "microphone=(self), camera=()",
        },
      ],
    },
  ],
  poweredByHeader: false,
};

export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
  // Source maps solo se suben si el usuario configura SENTRY_AUTH_TOKEN
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
