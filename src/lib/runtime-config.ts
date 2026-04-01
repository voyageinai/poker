function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeBasePath(value?: string | null): string {
  if (!value) return '';

  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

export const BASE_PATH = normalizeBasePath(
  process.env.BASE_PATH ?? process.env.NEXT_PUBLIC_BASE_PATH ?? '',
);

export const AUTH_COOKIE_NAME =
  process.env.AUTH_COOKIE_NAME ??
  process.env.NEXT_PUBLIC_AUTH_COOKIE_NAME ??
  'poker_token';

export function withBasePath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!BASE_PATH) return normalizedPath;
  return normalizedPath === '/' ? BASE_PATH : `${BASE_PATH}${normalizedPath}`;
}

export function stripBasePath(pathname?: string | null): string {
  if (!pathname) return '/';
  if (!BASE_PATH) return pathname;
  if (pathname === BASE_PATH) return '/';
  return pathname.startsWith(`${BASE_PATH}/`) ? pathname.slice(BASE_PATH.length) : pathname;
}

export function getAuthCookiePath(): string {
  return BASE_PATH || '/';
}

export function readCookieValue(cookieHeader: string, cookieName: string): string | null {
  const pattern = new RegExp(`(?:^|;\\s*)${escapeRegExp(cookieName)}=([^;]+)`);
  const match = cookieHeader.match(pattern);
  return match ? decodeURIComponent(match[1]) : null;
}

export function getWsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.host}${withBasePath('/ws')}`;
}
