/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API base is read at build time for the browser bundle; see .env.example.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
};

// One address for everything. When API_PROXY_TARGET is set, this server
// forwards anything under /api to the API service, so the browser only ever
// talks to its own address (kitstock.example.com/api/...). That means sign-in
// is at /login and its request goes to the same host - no second domain, no
// CORS. Leave it unset to have the browser call the API address directly.
const apiTarget = (process.env.API_PROXY_TARGET || '').replace(/\/$/, '');

nextConfig.rewrites = async () =>
  apiTarget ? [{ source: '/api/:path*', destination: `${apiTarget}/api/:path*` }] : [];

export default nextConfig;
