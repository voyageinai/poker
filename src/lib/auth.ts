/**
 * Auth utilities — pure JWT, no Next.js runtime deps.
 * getCurrentUser() (server components) lives separately to avoid
 * importing next/headers at the top level in server.ts.
 */
import jwt from 'jsonwebtoken';
import { AUTH_COOKIE_NAME, readCookieValue } from '@/lib/runtime-config';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';
const JWT_EXPIRY = '7d';

export interface JwtPayload {
  userId: string;
  username: string;
  role: 'admin' | 'user';
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

/** Server component — reads JWT from HTTP-only cookie. Dynamic import to avoid top-level next/headers. */
export async function getCurrentUser(): Promise<JwtPayload | null> {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/** API route helper — reads from Authorization header or cookie */
export function getUserFromRequest(req: Request): JwtPayload | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    return verifyToken(auth.slice(7));
  }
  const cookieHeader = req.headers.get('cookie') ?? '';
  const token = readCookieValue(cookieHeader, AUTH_COOKIE_NAME);
  if (token) return verifyToken(token);
  return null;
}

/** Returns user payload if admin, or null. For use in API routes. */
export function getAdminFromRequest(req: Request): JwtPayload | null {
  const user = getUserFromRequest(req);
  if (!user || user.role !== 'admin') return null;
  return user;
}
