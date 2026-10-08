import { DB, transaction } from "./db";
import { tables } from "./schema";
export const uuid = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export const now = () => new Date().toISOString();
export class Repository {
  constructor(public db: DB) {}
  all(sql: string, v: any[] = []) {
    return this.db.all(sql, v);
  }
  run(sql: string, v: any[] = []) {
    return this.db.run(sql, v);
  }
  async insert(table: string, row: any) {
    if (!tables.includes(table as any)) throw Error("Unknown table");
    const keys = Object.keys(row);
    await this.run(
      `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      Object.values(row),
    );
  }
  tx<T>(fn: () => Promise<T>) {
    return transaction(this.db, fn);
  }
  async dump() {
    const result: any = { schema_version: 2, exported_at: now() };
    for (const t of tables) result[t] = await this.all(`SELECT * FROM ${t}`);
    return result;
  }
  async sets(id: string) {
    return this.all(
      "SELECT * FROM session_sets WHERE session_exercise_id=? ORDER BY set_index",
      [id],
    );
  }
  async history(exercise: string, index: number) {
    return (
      await this.all(
        `SELECT ss.weight,ss.reps FROM session_sets ss JOIN session_exercises se ON se.id=ss.session_exercise_id JOIN sessions s ON s.id=se.session_id WHERE se.exercise_id=? AND ss.set_index=? AND ss.completed=1 AND se.skipped=0 AND s.status='completed' AND ss.weight IS NOT NULL AND ss.reps>0 ORDER BY s.completed_at DESC,s.started_at DESC LIMIT 1`,
        [exercise, index],
      )
    )[0];
  }
}
