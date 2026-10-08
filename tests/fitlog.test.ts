import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { migrate, DB } from "../src/db";
import { Repository } from "../src/repository";
import { FitLog } from "../src/service";
import { initialWeight, propagate } from "../src/domain";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let sqlite: Database.Database, svc: FitLog, dir: string, path: string;
function adapter(d: Database.Database): DB {
  return {
    backup: async (text) => {
      writeFileSync(join(dir, "pre-migration.json"), text);
    },
    exec: async (sql) => {
      d.exec(sql);
    },
    run: async (sql, v = []) => {
      d.prepare(sql).run(...v);
    },
    all: async (sql, v = []) => d.prepare(sql).all(...v),
  };
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "fitlog-"));
  path = join(dir, "test.sqlite");
  sqlite = new Database(path);
  const db = adapter(sqlite);
  await migrate(db);
  svc = new FitLog(new Repository(db));
  await svc.initialize(true);
});
afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});
async function monday() {
  return (await svc.r.all("SELECT * FROM plans WHERE weekday=1"))[0].id;
}
async function prep(weights: (number | null)[]) {
  const id = await monday();
  const plan = await svc.plan(id);
  plan.exercises = plan.exercises.slice(0, 1);
  plan.exercises[0].sets = weights.map((default_weight) => ({
    default_weight,
  }));
  await svc.savePlan(plan);
  return id;
}
async function complete(id: string, weights: number[]) {
  const s = await svc.session(id);
  for (let i = 0; i < weights.length; i++)
    await svc.editSet(s.exercises[0].id, s.exercises[0].sets[i].id, {
      weight: weights[i],
      reps: 12,
      rir: 2,
      completed: 1,
    });
  await svc.finish(id);
}
async function rows(id: string) {
  return (await svc.session(id)).exercises[0].sets;
}
describe("weight unit rules", () => {
  it("history outranks previous and preset including zero", () => {
    expect(initialWeight(0, 35, 40)).toEqual({
      weight: 0,
      weight_source: "history",
    });
  });
  it("empty remains distinct from zero", () => {
    expect(initialWeight(null, null, null).weight).toBeNull();
    expect(initialWeight(null, 0, 20).weight).toBe(0);
  });
  it("completed and manually cleared sets remain locked", () => {
    const base: any = { reps: null, rir: null, default_weight: 10 };
    const out = propagate([
      {
        ...base,
        id: "1",
        set_index: 1,
        weight: 30,
        weight_source: "manual",
        completed: 0,
      },
      {
        ...base,
        id: "2",
        set_index: 2,
        weight: 40,
        weight_source: "previous",
        completed: 1,
      },
      {
        ...base,
        id: "3",
        set_index: 3,
        weight: null,
        weight_source: "manual",
        completed: 0,
      },
    ]);
    expect(out.map((s) => s.weight)).toEqual([30, 40, null]);
  });
});
describe("real SQLite integration", () => {
  it("first session follows previous, first set preset", async () => {
    const p = await prep([30, 35, 40, 30]);
    const id = await svc.start(p);
    expect((await rows(id)).map((s: any) => s.weight)).toEqual([
      30, 30, 30, 30,
    ]);
  });
  it("distinct four historical weights and new fifth set; actual reps reset", async () => {
    const p = await prep([null, null, null, null]);
    const old = await svc.start(p);
    await complete(old, [30, 35, 40, 30]);
    const id = await svc.start(p);
    let r = await rows(id);
    expect(r.map((s: any) => s.weight)).toEqual([30, 35, 40, 30]);
    expect(
      r.every(
        (s: any) => s.reps === null && s.rir === null && s.completed === 0,
      ),
    ).toBe(true);
    await svc.addSet((await svc.session(id)).exercises[0].id);
    r = await rows(id);
    expect(r[4].weight).toBe(30);
  });
  it("propagates previous changes; manual and completed stay intact", async () => {
    const p = await prep([20, 30, 40, 50]);
    const id = await svc.start(p);
    const e = (await svc.session(id)).exercises[0];
    await svc.editSet(e.id, e.sets[2].id, { weight: 42 });
    await svc.editSet(e.id, e.sets[3].id, { reps: 10, completed: 1 });
    await svc.editSet(e.id, e.sets[0].id, { weight: 25 });
    expect((await rows(id)).map((s: any) => s.weight)).toEqual([
      25, 25, 42, 42,
    ]);
    await svc.editSet(e.id, e.sets[1].id, { weight: 33 });
    expect((await rows(id)).map((s: any) => s.weight)).toEqual([
      25, 33, 42, 42,
    ]);
  });
  it("skipped exercise and unfinished drafts do not enter inheritance", async () => {
    const p = await prep([15]);
    const old = await svc.start(p);
    const e = (await svc.session(old)).exercises[0];
    await svc.editSet(e.id, e.sets[0].id, {
      weight: 99,
      reps: 12,
      completed: 1,
    });
    await svc.skipExercise(e.id, 1);
    await svc.r.run(
      "UPDATE sessions SET status='completed',completed_at=? WHERE id=?",
      [new Date().toISOString(), old],
    );
    const draft = await svc.start(p);
    await svc.editSet(
      (await svc.session(draft)).exercises[0].id,
      (await rows(draft))[0].id,
      { weight: 88, reps: 12, completed: 1 },
    );
    const id = await svc.start(p);
    expect((await rows(id))[0].weight).toBe(15);
  });
  it("plan edit cannot alter snapshots", async () => {
    const p = await prep([30]);
    const id = await svc.start(p);
    const before = await svc.session(id);
    const plan = await svc.plan(p);
    plan.name = "改变";
    plan.exercises[0].sets = [{ default_weight: 100 }, { default_weight: 150 }];
    await svc.savePlan(plan);
    expect(await svc.session(id)).toEqual(before);
  });
  it("reopen disk database restores draft input", async () => {
    const p = await prep([30]);
    const id = await svc.start(p);
    const e = (await svc.session(id)).exercises[0];
    await svc.editSet(e.id, e.sets[0].id, { reps: 12, rir: 2, completed: 1 });
    sqlite.close();
    sqlite = new Database(path);
    await migrate(adapter(sqlite));
    svc = new FitLog(new Repository(adapter(sqlite)));
    expect((await rows(id))[0]).toMatchObject({
      weight: 30,
      reps: 12,
      rir: 2,
      completed: 1,
    });
    expect((await svc.session(id)).status).toBe("active");
  });
  it("JSON full replacement roundtrip verifies every table", async () => {
    const p = await prep([13.6, 0]);
    const id = await svc.start(p);
    await complete(id, [13.6, 0]);
    const before = JSON.parse(await svc.exportJSON());
    await svc.deleteSession(id);
    const result = await svc.restore(JSON.stringify(before));
    expect(result.sessions).toBe(1);
    const after = JSON.parse(await svc.exportJSON());
    delete before.exported_at;
    delete after.exported_at;
    for (const t of Object.keys(before))
      if (Array.isArray(before[t])) {
        before[t].sort((a: any, b: any) => a.id.localeCompare(b.id));
        after[t].sort((a: any, b: any) => a.id.localeCompare(b.id));
      }
    expect(after).toEqual(before);
  });
  it("invalid JSON or invalid FK rolls back all deleted rows", async () => {
    const before = await svc.exportJSON();
    await expect(svc.restore("{")).rejects.toThrow();
    const broken = JSON.parse(before);
    broken.plan_sets[0].plan_exercise_id = crypto.randomUUID();
    await expect(svc.restore(JSON.stringify(broken))).rejects.toThrow();
    const after = JSON.parse(await svc.exportJSON());
    const expected = JSON.parse(before);
    delete after.exported_at;
    delete expected.exported_at;
    expect(after).toEqual(expected);
  });
  it("schema initialization and repeated migrate preserve history; refuses future version", async () => {
    const p = await prep([30]);
    const id = await svc.start(p);
    await complete(id, [30]);
    sqlite.pragma("user_version=1");
    sqlite.exec("DROP INDEX idx_sets_history");
    await migrate(adapter(sqlite));
    expect(
      JSON.parse(readFileSync(join(dir, "pre-migration.json"), "utf8"))
        .sessions[0].id,
    ).toBe(id);
    expect(sqlite.pragma("user_version", { simple: true })).toBe(2);
    expect((await rows(id))[0].completed).toBe(1);
    sqlite.pragma("user_version=3");
    await expect(migrate(adapter(sqlite))).rejects.toThrow("禁止降级");
  });
  it("CSV includes Chinese header, quoted names, decimals and all fields", async () => {
    const p = await prep([13.6]);
    const plan = await svc.plan(p);
    plan.name = '胸,"肩"\n练';
    await svc.savePlan(plan);
    const id = await svc.start(p);
    await complete(id, [13.6]);
    const csv = await svc.exportCSV();
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"RIR"');
    expect(csv).toContain('"13.6"');
    expect(csv).toContain('"胸,""肩""\n练"');
  });
  it("same day multiple sessions never overwrite", async () => {
    const p = await prep([30]);
    const a = await svc.start(p),
      b = await svc.start(p);
    expect(a).not.toBe(b);
    await complete(a, [35]);
    expect((await rows(b))[0].weight).toBe(30);
    expect((await svc.r.all("SELECT id FROM sessions")).length).toBe(2);
  });
  it("history edits affect future, not existing drafts", async () => {
    const p = await prep([30]);
    const old = await svc.start(p);
    await complete(old, [30]);
    const draft = await svc.start(p);
    const s = await svc.session(old);
    s.exercises[0].sets[0].weight = 35;
    await svc.saveHistory(s);
    const fresh = await svc.start(p);
    expect((await rows(draft))[0].weight).toBe(30);
    expect((await rows(fresh))[0].weight).toBe(35);
  });
  it("fallback history finds latest completed session containing corresponding index", async () => {
    const p = await prep([null, null]);
    const older = await svc.start(p);
    await complete(older, [30, 40]);
    const plan = await svc.plan(p);
    plan.exercises[0].sets.pop();
    await svc.savePlan(plan);
    const newer = await svc.start(p);
    await complete(newer, [35]);
    const id = await svc.start(p);
    await svc.addSet((await svc.session(id)).exercises[0].id);
    expect((await rows(id)).map((s: any) => s.weight)).toEqual([35, 40]);
  });
  it("failed completion and invalid history edit do not corrupt data", async () => {
    const p = await prep([null]);
    const id = await svc.start(p);
    await expect(svc.finish(id)).rejects.toThrow();
    const s = await svc.session(id);
    s.exercises[0].sets[0].completed = 1;
    await expect(svc.saveHistory(s)).rejects.toThrow();
    expect((await rows(id))[0].completed).toBe(0);
  });
  it("serial concurrent edits persist every field", async () => {
    const p = await prep([30]);
    const id = await svc.start(p);
    const e = (await svc.session(id)).exercises[0];
    await Promise.all([
      svc.editSet(e.id, e.sets[0].id, { weight: 35 }),
      svc.editSet(e.id, e.sets[0].id, { reps: 12 }),
      svc.editSet(e.id, e.sets[0].id, { rir: 2 }),
      svc.editSet(e.id, e.sets[0].id, { completed: 1 }),
    ]);
    expect((await rows(id))[0]).toMatchObject({
      weight: 35,
      reps: 12,
      rir: 2,
      completed: 1,
    });
  });
});

describe("data safety edge cases", () => {
  it("zero kg is valid, zero reps cannot be completed, invalid drafts rollback", async () => {
    const p = await prep([0]);
    const id = await svc.start(p);
    const e = (await svc.session(id)).exercises[0];
    await expect(
      svc.editSet(e.id, e.sets[0].id, { reps: 0, completed: 1 }),
    ).rejects.toThrow();
    await expect(
      svc.editSet(e.id, e.sets[0].id, { weight: Infinity }),
    ).rejects.toThrow();
    expect((await rows(id))[0].weight).toBe(0);
    await svc.editSet(e.id, e.sets[0].id, { reps: 12, rir: 0, completed: 1 });
    expect((await rows(id))[0].completed).toBe(1);
  });
  it("migration backup failure prevents schema changes and preserves records", async () => {
    const p = await prep([30]);
    const id = await svc.start(p);
    sqlite.pragma("user_version=1");
    const db = adapter(sqlite);
    db.backup = async () => {
      throw Error("disk full");
    };
    await expect(migrate(db)).rejects.toThrow("disk full");
    expect(sqlite.pragma("user_version", { simple: true })).toBe(1);
    expect((await rows(id))[0].weight).toBe(30);
  });
  it("wrong version and duplicate ids leave original data unchanged", async () => {
    const before = JSON.parse(await svc.exportJSON());
    const bad = { ...before, schema_version: 99 };
    await expect(svc.restore(JSON.stringify(bad))).rejects.toThrow();
    const dup = JSON.parse(JSON.stringify(before));
    dup.plans.push(dup.plans[0]);
    await expect(svc.restore(JSON.stringify(dup))).rejects.toThrow();
    const after = JSON.parse(await svc.exportJSON());
    delete after.exported_at;
    delete before.exported_at;
    expect(after).toEqual(before);
  });
});

it("sample week fills training days without touching existing plans or history", async () => {
  const plans = await svc.r.all("SELECT * FROM plans ORDER BY weekday");
  for (const p of plans) {
    const plan = await svc.plan(p.id);
    expect(plan.exercises.length > 0).toBe(!p.rest);
  }
  const id = await monday();
  const sessionId = await svc.start(id);
  const before = await svc.session(sessionId);
  await svc.fillEmptySampleDays();
  expect(await svc.session(sessionId)).toEqual(before);
  expect((await svc.plan(id)).exercises).toHaveLength(6);
});

it("plan-only import preserves active sessions and rejects invalid input atomically", async () => {
  const id = await monday(), sessionId = await svc.start(id);
  const before = await svc.session(sessionId);
  const data = { format: "fitlog-plans", version: 1, days: [{weekday: 1, name: "我的卧推", rest: false, exercises: [{name: "平板卧推", weights: [30,35,40,30], reps_min: 8, reps_max: 12}]}] };
  expect(await svc.importPlansJSON(JSON.stringify(data))).toBe(1);
  expect(await svc.session(sessionId)).toEqual(before);
  const plan = await svc.plan(id);
  expect(plan.exercises[0].sets.map((s: any) => s.default_weight)).toEqual([30,35,40,30]);
  data.days[0].exercises[0].weights[1] = -1;
  expect(() => svc.importPlansJSON(JSON.stringify(data))).toThrow();
  expect(await svc.plan(id)).toEqual(plan);
});
