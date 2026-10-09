import { Capacitor, registerPlugin } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";
import {
  schema,
  version,
  tables,
  migration3Columns,
  sideSetsSchema,
} from "./schema";
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
  if (v > 0 && v < version) {
    if (!db.backup) throw Error("缺少迁移备份能力");
    const snapshot: any = {
      schema_version: v,
      exported_at: new Date().toISOString(),
    };
    for (const table of tables)
      snapshot[table] = await db.all(`SELECT * FROM ${table}`);
    await db.backup(JSON.stringify(snapshot));
  }
  await transaction(db, async () => {
    if (v === 0) await db.exec(schema);
    if (v < 2)
      await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_sets_history ON session_sets(set_index,completed,session_exercise_id);",
      );
    if (v < 3) {
      for (const [table, column, definition] of migration3Columns) {
        const columns = await db.all(`PRAGMA table_info(${table})`);
        if (!columns.some((c) => c.name === column))
          await db.exec(
            `ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`,
          );
      }
      const columns = await db.all("PRAGMA table_info(session_sets)");
      if (!columns.some((c) => c.name === "side")) {
        const names = columns.map((c) => c.name).join(",");
        await db.exec(sideSetsSchema);
        await db.exec(
          `INSERT INTO session_sets_v3 (${names}) SELECT ${names} FROM session_sets; DROP TABLE session_sets; ALTER TABLE session_sets_v3 RENAME TO session_sets;`,
        );
      }
      await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_sets_parent ON session_sets(session_exercise_id,set_index); CREATE INDEX IF NOT EXISTS idx_sets_history ON session_sets(set_index,completed,session_exercise_id,side);",
      );
    }
    await db.exec(`PRAGMA user_version=${version};`);
    if ((await db.all("PRAGMA foreign_key_check")).length)
      throw Error("迁移引用检查失败");
  });
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
