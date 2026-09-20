/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API base is read at build time for the browser bundle; see .env.example.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
};

export default nextConfig;
