import type { NextConfig } from 'next';
import { AUTH_COOKIE_NAME, normalizeBasePath } from './src/lib/runtime-config';

const basePath = normalizeBasePath(process.env.BASE_PATH ?? '');

const nextConfig: NextConfig = {
  // Custom server handles HTTP — tell Next.js not to start its own
  experimental: {},
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_AUTH_COOKIE_NAME: AUTH_COOKIE_NAME,
  },
};

export default nextConfig;
