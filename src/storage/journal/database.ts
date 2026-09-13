import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
export interface SqlConnection {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<T[]>;
}
export interface SqlDatabase extends SqlConnection {
  transaction<T>(fn: (db: SqlConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export const schema = [
  "CREATE TABLE IF NOT EXISTS orbit_schema_versions (version INTEGER PRIMARY KEY)",
  "INSERT INTO orbit_schema_versions (version) VALUES (3) ON CONFLICT (version) DO NOTHING",
  "CREATE TABLE IF NOT EXISTS orbit_entities (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, parent_id TEXT, ordinal BIGINT NOT NULL DEFAULT 0, data TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS orbit_project_entities ON orbit_entities(project_id,kind,ordinal,id)",
  "CREATE TABLE IF NOT EXISTS orbit_tombstones (id TEXT NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (project_id,id))",
  "CREATE TABLE IF NOT EXISTS orbit_outbox (position INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, project_id TEXT NOT NULL, data TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS orbit_offsets (source TEXT PRIMARY KEY, position BIGINT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS orbit_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS orbit_changes (cursor INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, data TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS orbit_receipts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, fingerprint TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS orbit_write_lock (id INTEGER PRIMARY KEY)",
  "INSERT INTO orbit_write_lock (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
];
export class SqliteDatabase implements SqlDatabase {
  readonly raw: Database.Database;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(path: string, readOnly = false) {
    if (!readOnly && path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    this.raw = new Database(path, { readonly: readOnly, fileMustExist: readOnly });
    if (readOnly) return;
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.raw.pragma("foreign_keys = ON");
    this.raw.pragma("secure_delete = ON");
    this.raw.pragma("journal_mode = WAL");
    this.raw.pragma("busy_timeout = 5000");
    for (const sql of schema) this.raw.exec(sql);
  }
  async query<T = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    const stmt = this.raw.prepare(sql.replace(/\$\d+/g, "?"));
    return (
      stmt.reader ? stmt.all(...values) : (stmt.run(...values), [])
    ) as T[];
  }
  async transaction<T>(fn: (db: SqlConnection) => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => {
      release = r;
    });
    await previous;
    let begun = false;
    try {
      this.raw.exec("BEGIN IMMEDIATE");
      begun = true;
      const result = await fn(this);
      this.raw.exec("COMMIT");
      return result;
    } catch (e) {
      if (begun) this.raw.exec("ROLLBACK");
      throw e;
    } finally {
      release();
    }
  }
  async close() {
    await this.tail;
    this.raw.close();
  }
}
