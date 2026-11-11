import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@paypal/agent-toolkit"],
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://www.sandbox.paypal.com\")" },
      // Scripts and frames only from this site and PayPal. Next.js needs inline scripts for hydration, so script-src keeps 'unsafe-inline'.
      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://*.paypal.com https://*.paypalobjects.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.paypal.com https://*.paypalobjects.com; connect-src 'self' https://*.paypal.com https://*.paypalobjects.com; frame-src https://*.paypal.com; font-src 'self' data: https://*.paypalobjects.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" },
    ] }];
  },
};
export default config;
