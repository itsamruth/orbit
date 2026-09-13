import pg from "pg";
import type { SqlConnection, SqlDatabase } from "@orbit/local-store";
import { schema } from "@orbit/local-store";
export class PostgresDatabase implements SqlDatabase {
  readonly pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 10 });
  }
  async query<T = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    return (await this.pool.query(sql, values)).rows as T[];
  }
  async transaction<T>(fn: (db: SqlConnection) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT id FROM orbit_write_lock WHERE id=1 FOR UPDATE",
      );
      const result = await fn({
        query: async <R = Record<string, unknown>>(
          sql: string,
          values: unknown[] = [],
        ) => (await client.query(sql, values)).rows as R[],
      });
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(4318001)");
      for (const sql of schema)
        await client.query(
          sql.replaceAll(
            "INTEGER PRIMARY KEY AUTOINCREMENT",
            "BIGSERIAL PRIMARY KEY",
          ),
        );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
