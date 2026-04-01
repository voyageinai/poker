import { getDb } from './index';

export type AuditCategory = 'admin' | 'chips' | 'account' | 'tournament' | 'system';

export interface AuditEntry {
  userId?: string | null;
  category: AuditCategory;
  action: string;
  targetId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Write an audit log entry. Fire-and-forget — never throws,
 * never blocks the caller on failure.
 */
export function audit(entry: AuditEntry): void {
  try {
    getDb().prepare(
      'INSERT INTO audit_log (user_id, category, action, target_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      entry.userId ?? null,
      entry.category,
      entry.action,
      entry.targetId ?? null,
      JSON.stringify(entry.detail ?? {}),
      entry.ip ?? null,
    );
  } catch (err) {
    console.error('[Audit] Failed to write audit log:', err);
  }
}

export interface AuditLogRow {
  id: number;
  user_id: string | null;
  category: AuditCategory;
  action: string;
  target_id: string | null;
  detail: string;
  ip: string | null;
  created_at: number;
}

export interface AuditQueryParams {
  category?: string;
  action?: string;
  userId?: string;
  targetId?: string;
  from?: number;   // unix timestamp
  to?: number;     // unix timestamp
  page?: number;
  pageSize?: number;
}

/**
 * Query audit logs with flexible filters + pagination.
 * Returns { rows, total } for the admin panel.
 */
export function queryAuditLogs(params: AuditQueryParams): { rows: AuditLogRow[]; total: number } {
  const conditions: string[] = [];
  const args: unknown[] = [];

  if (params.category) {
    conditions.push('category = ?');
    args.push(params.category);
  }
  if (params.action) {
    conditions.push('action = ?');
    args.push(params.action);
  }
  if (params.userId) {
    conditions.push('user_id = ?');
    args.push(params.userId);
  }
  if (params.targetId) {
    conditions.push('target_id = ?');
    args.push(params.targetId);
  }
  if (params.from) {
    conditions.push('created_at >= ?');
    args.push(params.from);
  }
  if (params.to) {
    conditions.push('created_at <= ?');
    args.push(params.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) as n FROM audit_log ${where}`).get(...args) as { n: number }).n;
  const rows = db.prepare(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(...args, pageSize, offset) as AuditLogRow[];

  return { rows, total };
}

/**
 * Query audit logs relevant to a specific user (as actor OR target).
 */
export function queryUserAuditLogs(userId: string, params: { category?: string; page?: number; pageSize?: number }): { rows: AuditLogRow[]; total: number } {
  const conditions: string[] = ['(user_id = ? OR target_id = ?)'];
  const args: unknown[] = [userId, userId];

  if (params.category) {
    conditions.push('category = ?');
    args.push(params.category);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) as n FROM audit_log ${where}`).get(...args) as { n: number }).n;
  const rows = db.prepare(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(...args, pageSize, offset) as AuditLogRow[];

  return { rows, total };
}
