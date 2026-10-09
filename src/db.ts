import { Capacitor, registerPlugin } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";
import {
  schema,
  version,
  tables,
  migration3Columns,
  sideSetsSchema,
  v3Defaults,
} from "./schema";
export interface DB {
  backup?(text: string): Promise<void>;
  exec(sql: string): Promise<void>;
  run(sql: string, v?: any[]): Promise<void>;
  all(sql: string, v?: any[]): Promise<any[]>;
}
// The Android plugin splits batches only on ";\n". Dispatch each statement
// separately so SQLite cannot silently ignore the tail of a same-line batch.
export function sqlStatements(sql: string) {
  const result: string[] = [];
  let start = 0,
    quote = "",
    comment = "";
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i],
      next = sql[i + 1];
    if (comment === "line") {
      if (ch === "\n") comment = "";
      continue;
    }
    if (comment === "block") {
      if (ch === "*" && next === "/") {
        comment = "";
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === quote) {
        if (next === quote) i++;
        else quote = "";
      }
      continue;
    }
    if (ch === "-" && next === "-") {
      comment = "line";
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      comment = "block";
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "[") {
      quote = "]";
      continue;
    }
    if (ch === ";") {
      const statement = sql.slice(start, i).trim();
      if (statement) result.push(statement);
      start = i + 1;
    }
  }
  const tail = sql.slice(start).trim();
  if (tail) result.push(tail);
  return result;
}
export interface NativeSQLiteBridge {
  execute(sql: string, transaction: boolean): Promise<unknown>;
  run(sql: string, values: any[], transaction: boolean): Promise<unknown>;
  query(sql: string, values: any[]): Promise<{ values?: any[] }>;
}
export function nativeAdapter(
  db: NativeSQLiteBridge,
  backup: (text: string) => Promise<void>,
): DB {
  return {
    backup,
    exec: async (sql) => {
      for (const statement of sqlStatements(sql))
        await db.execute(statement + ";", false);
    },
    run: async (sql, values = []) => {
      await db.run(sql, values, false);
    },
    all: async (sql, values = []) => (await db.query(sql, values)).values ?? [],
  };
}
async function layout(db: DB) {
  const columns: Record<string, string[]> = {};
  for (const table of tables)
    columns[table] = (await db.all(`PRAGMA table_info(${table})`)).map(
      (c) => c.name,
    );
  return columns;
}
function missingV3(columns: Record<string, string[]>) {
  return Object.entries(v3Defaults).some(([table, fields]) =>
    Object.keys(fields).some((column) => !columns[table].includes(column)),
  );
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
  const adapter = nativeAdapter(db, async (text) => {
    await files.migrationBackup({ text });
  });
  await migrate(adapter);
  return adapter;
}
export async function migrate(db: DB) {
  await db.exec("PRAGMA foreign_keys=ON;");
  const v = (await db.all("PRAGMA user_version"))[0].user_version;
  if (v > version) throw new Error("数据库版本高于此应用，禁止降级打开");
  const currentLayout = v > 0 ? await layout(db) : null;
  const repair = v > 0 && missingV3(currentLayout!);
  if (v > 0 && (v < version || repair)) {
    if (!db.backup) throw Error("缺少迁移备份能力");
    const snapshot: any = {
      schema_version: v,
      exported_at: new Date().toISOString(),
    };
    for (const table of tables) {
      snapshot[table] = await db.all(`SELECT * FROM ${table}`);
      if (v === 3)
        for (const row of snapshot[table])
          for (const [column, value] of Object.entries(v3Defaults[table] ?? {}))
            if (!(column in row)) row[column] = value;
    }
    const artifacts = await db.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='session_sets_v3'",
    );
    if (artifacts.length)
      snapshot.migration_artifacts = {
        session_sets_v3: await db.all("SELECT * FROM session_sets_v3"),
      };
    await db.backup(JSON.stringify(snapshot));
  }
  await transaction(db, async () => {
    if (v === 0) await db.exec(schema);
    if (v < 2)
      await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_sets_history ON session_sets(set_index,completed,session_exercise_id);",
      );
    if (v < 3 || repair) {
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
        // Previous faulty Android migration may have left a stale copy. Keep
        // it in the protection snapshot; authoritative records are in the old table.
        await db.exec("DROP TABLE IF EXISTS session_sets_v3;");
        await db.exec(sideSetsSchema);
        await db.exec(
          `INSERT INTO session_sets_v3 (${names}) SELECT ${names} FROM session_sets; DROP TABLE session_sets; ALTER TABLE session_sets_v3 RENAME TO session_sets;`,
        );
      }
      await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_sets_parent ON session_sets(session_exercise_id,set_index); CREATE INDEX IF NOT EXISTS idx_sets_history ON session_sets(set_index,completed,session_exercise_id,side);",
      );
    }
    if (missingV3(await layout(db)))
      throw Error("数据库结构升级未完成，已停止打开并保留原数据");
    const check = await db.all("PRAGMA integrity_check");
    if (check[0].integrity_check !== "ok") throw Error("数据库完整性检查失败");
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
