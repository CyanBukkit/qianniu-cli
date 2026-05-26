import * as fs from 'fs';
import * as path from 'path';

export interface AuditLogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  details: Record<string, unknown>;
}

const AUDIT_LOG_DIR = path.resolve(process.cwd(), 'data/runtime-audit');
const RETENTION_DAYS = 7;

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatLocalDateParts(date = new Date()): { year: number; month: number; day: number } {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function getDailyAuditLogFilename(date = new Date()): string {
  const { year, month, day } = formatLocalDateParts(date);
  return `${year}-${pad2(month)}-${pad2(day)}.jsonl`;
}

function getDailyAuditLogPath(date = new Date()): string {
  return path.join(AUDIT_LOG_DIR, getDailyAuditLogFilename(date));
}

function parseAuditLogFilename(filename: string): Date | null {
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})\.jsonl$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function ensureAuditLogDir(): void {
  fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
}

function pruneExpiredAuditLogs(now = new Date()): void {
  ensureAuditLogDir();

  // 只保留最近 7 个自然日的日志文件，便于 git 跟踪新增和删除。
  const retentionCutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - RETENTION_DAYS);
  const files = fs.readdirSync(AUDIT_LOG_DIR);

  for (const filename of files) {
    const fileDate = parseAuditLogFilename(filename);
    if (!fileDate) continue;
    if (fileDate >= retentionCutoff) continue;

    const filePath = path.join(AUDIT_LOG_DIR, filename);
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error('⚠️ 删除过期审计日志失败:', filePath, error);
    }
  }
}

export function appendAuditLog(
  event: string,
  details: Record<string, unknown> = {},
  level: AuditLogEntry['level'] = 'info'
): void {
  const now = new Date();
  const entry: AuditLogEntry = {
    at: now.toISOString(),
    level,
    event,
    details,
  };

  try {
    ensureAuditLogDir();
    pruneExpiredAuditLogs(now);
    // 每天单独写一个 jsonl 文件，便于按日期回溯事故。
    const auditLogPath = getDailyAuditLogPath(now);
    fs.appendFileSync(auditLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.error('⚠️ 写入审计日志失败:', error);
  }
}

export function readRecentAuditLogs(limit = 100, date = new Date()): AuditLogEntry[] {
  try {
    const auditLogPath = getDailyAuditLogPath(date);
    if (!fs.existsSync(auditLogPath)) {
      return [];
    }

    const content = fs.readFileSync(auditLogPath, 'utf8');
    const lines = content
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    return lines
      .slice(-Math.max(1, limit))
      .map(line => JSON.parse(line) as AuditLogEntry);
  } catch (error) {
    console.error('⚠️ 读取审计日志失败:', error);
    return [];
  }
}

export function listAuditLogFiles(): string[] {
  try {
    ensureAuditLogDir();
    return fs.readdirSync(AUDIT_LOG_DIR)
      .filter(filename => filename.endsWith('.jsonl'))
      .sort();
  } catch (error) {
    console.error('⚠️ 读取审计日志目录失败:', error);
    return [];
  }
}

export function getAuditLogDir(): string {
  return AUDIT_LOG_DIR;
}

export function getTodayAuditLogPath(): string {
  return getDailyAuditLogPath(new Date());
}
