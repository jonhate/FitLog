import init from "sql.js";
import wasmURL from "sql.js/dist/sql-wasm.wasm?url";
import { DB, migrate } from "./db";
export async function previewDB(): Promise<DB> {
  const SQL = await init({ locateFile: () => wasmURL });
  const db = new SQL.Database();
  const adapter: DB = {
    backup: async () => {},
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, v = []) => {
      db.run(sql, v);
    },
    all: async (sql, v = []) => {
      const s = db.prepare(sql);
      try {
        s.bind(v);
        const rows = [];
        while (s.step()) rows.push(s.getAsObject());
        return rows;
      } finally {
        s.free();
      }
    },
  };
  await migrate(adapter);
  return adapter;
}
