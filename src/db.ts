import { Capacitor, registerPlugin } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";
import { schema, version, tables } from "./schema";
export interface DB {
  backup?(text: string): Promise<void>;
  exec(sql: string): Promise<void>;
  run(sql: string, v?: any[]): Promise<void>;
  all(sql: string, v?: any[]): Promise<any[]>;
}
export async function openDB(): Promise<DB> {
  if (!Capacitor.isNativePlatform() && import.meta.env.DEV)
    return (await import("./preview")).previewDB();
  if (!Capacitor.isNativePlatform())
    throw new Error(
      "请在 Android 应用中使用真实 SQLite；浏览器仅提供界面，不保存正式数据。",
    );
  const connection = new SQLiteConnection(CapacitorSQLite);
  const db = await connection.createConnection(
    "fitlog",
    false,
    "no-encryption",
    version,
    false,
  );
  await db.open();
  const files = registerPlugin<{
    migrationBackup(o: { text: string }): Promise<void>;
  }>("FitLogFiles");
  const adapter: DB = {
    backup: async (text) => {
      await files.migrationBackup({ text });
    },
    exec: async (sql) => {
      await db.execute(sql, false);
    },
    run: async (sql, v = []) => {
      await db.run(sql, v, false);
    },
    all: async (sql, v = []) => (await db.query(sql, v)).values ?? [],
  };
  await migrate(adapter);
  return adapter;
}
export async function migrate(db: DB) {
  await db.exec("PRAGMA foreign_keys=ON;");
  const v = (await db.all("PRAGMA user_version"))[0].user_version;
  if (v > version) throw new Error("数据库版本高于此应用，禁止降级打开");
  // Migration 0→1 creates the schema; 1→2 adds a history lookup index without modifying records.
  if (v === 0) {
    await transaction(db, async () => {
      await db.exec(schema);
    });
  }
  if (v < 2) {
    if (v === 1) {
      if (!db.backup) throw Error("缺少迁移备份能力");
      const snapshot: any = {
        schema_version: 1,
        exported_at: new Date().toISOString(),
      };
      for (const table of tables)
        snapshot[table] = await db.all(`SELECT * FROM ${table}`);
      await db.backup(JSON.stringify(snapshot));
    }
    await transaction(db, async () => {
      await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_sets_history ON session_sets(set_index,completed,session_exercise_id); PRAGMA user_version=2;",
      );
    });
  }
  const check = await db.all("PRAGMA integrity_check");
  if (check[0].integrity_check !== "ok")
    throw new Error("数据库完整性检查失败");
}
export async function transaction<T>(db: DB, fn: () => Promise<T>): Promise<T> {
  await db.exec("BEGIN IMMEDIATE");
  try {
    const r = await fn();
    await db.exec("COMMIT");
    return r;
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}
