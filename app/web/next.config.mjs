/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // バックエンド API は Next.js の Route Handlers (src/app/api) で提供する
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
