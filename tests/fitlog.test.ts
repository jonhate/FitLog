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
    expect(sqlite.pragma("user_version", { simple: true })).toBe(3);
    expect((await rows(id))[0].completed).toBe(1);
    sqlite.pragma("user_version=4");
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
  const id = await monday(),
    sessionId = await svc.start(id);
  const before = await svc.session(sessionId);
  const data = {
    format: "fitlog-plans",
    version: 1,
    days: [
      {
        weekday: 1,
        name: "我的卧推",
        rest: false,
        exercises: [
          {
            name: "平板卧推",
            weights: [30, 35, 40, 30],
            reps_min: 8,
            reps_max: 12,
          },
        ],
      },
    ],
  };
  expect(await svc.importPlansJSON(JSON.stringify(data))).toBe(1);
  expect(await svc.session(sessionId)).toEqual(before);
  const plan = await svc.plan(id);
  expect(plan.exercises[0].sets.map((s: any) => s.default_weight)).toEqual([
    30, 35, 40, 30,
  ]);
  data.days[0].exercises[0].weights[1] = -1;
  expect(() => svc.importPlansJSON(JSON.stringify(data))).toThrow();
  expect(await svc.plan(id)).toEqual(plan);
});

import { schema, v3Defaults, tables } from "../src/schema";
import { groups } from "../src/domain";
async function unilateral() {
  const p = await prep([10, 20, 30]);
  const plan = await svc.plan(p);
  plan.exercises[0].mode = "unilateral";
  plan.exercises[0].target_reps_min = 8;
  plan.exercises[0].target_reps_max = 12;
  plan.exercises[0].sets[0].default_weight_left = 10;
  plan.exercises[0].sets[0].default_weight_right = 12;
  await svc.savePlan(plan);
  return p;
}
describe("V3 sides, notes and compatibility", () => {
  it("separate side propagation, logical completion, addition and deletion", async () => {
    const p = await unilateral(),
      id = await svc.start(p),
      e = (await svc.session(id)).exercises[0];
    expect(e.sets.map((s: any) => s.weight)).toEqual([10, 12, 10, 12, 10, 12]);
    await svc.editSet(e.id, e.sets[0].id, {
      weight: 15,
      reps: 10,
      completed: 1,
    });
    expect((await rows(id)).map((s: any) => s.weight)).toEqual([
      15, 12, 15, 12, 15, 12,
    ]);
    expect(
      groups(await rows(id)).filter((g) => g.every((s) => s.completed)),
    ).toHaveLength(0);
    await svc.editSet(e.id, e.sets[1].id, { reps: 11, completed: 1 });
    expect(
      groups(await rows(id)).filter((g) => g.every((s) => s.completed)),
    ).toHaveLength(1);
    await svc.addSet(e.id);
    expect((await rows(id)).slice(-2).map((s: any) => s.weight)).toEqual([
      15, 12,
    ]);
    await svc.deleteSet(e.id, e.sets[2].id);
    expect((await rows(id)).map((s: any) => s.set_index)).toEqual([
      1, 1, 2, 2, 3, 3,
    ]);
  });
  it("inherits each side independently and preserves locked sets", async () => {
    const p = await unilateral(),
      old = await svc.start(p),
      e = (await svc.session(old)).exercises[0];
    for (let i = 0; i < e.sets.length; i++)
      await svc.editSet(e.id, e.sets[i].id, {
        weight: 20 + i,
        reps: 8 + i,
        rir: 2,
        completed: 1,
      });
    await svc.finish(old);
    const id = await svc.start(p),
      r = await rows(id);
    expect(r.map((s: any) => s.weight)).toEqual([20, 21, 22, 23, 24, 25]);
    expect(
      r.every((s: any) => s.reps === null && s.rir === null && !s.completed),
    ).toBe(true);
    const x = (await svc.session(id)).exercises[0];
    await svc.addSet(x.id);
    expect((await rows(id)).slice(-2).map((s: any) => s.weight)).toEqual([
      24, 25,
    ]);
    await svc.editSet(x.id, r[0].id, { weight: 99 });
    expect((await rows(id))[2].weight).toBe(22);
    const edit = await svc.session(old);
    edit.exercises[0].sets[1].weight = 35;
    await svc.saveHistory(edit);
    expect((await rows(await svc.start(p)))[1].weight).toBe(35);
    expect((await rows(id))[1].weight).toBe(21);
  });
  it("mode and target snapshots survive plan changes; bilateral history never becomes left history", async () => {
    const p = await prep([30]),
      old = await svc.start(p);
    await complete(old, [30]);
    const snapshot = await svc.session(old);
    const plan = await svc.plan(p);
    plan.exercises[0].mode = "unilateral";
    plan.exercises[0].sets[0].default_weight_left = 30;
    plan.exercises[0].sets[0].default_weight_right = 30;
    plan.exercises[0].target_reps_min = 12;
    plan.exercises[0].target_reps_max = 12;
    await svc.savePlan(plan);
    expect(await svc.session(old)).toEqual(snapshot);
    const fresh = await svc.session(await svc.start(p));
    expect(fresh.exercises[0]).toMatchObject({
      mode: "unilateral",
      target_reps_min: 12,
      target_reps_max: 12,
    });
    expect(
      fresh.exercises[0].sets.every((s: any) => s.weight_source === "plan"),
    ).toBe(true);
  });
  it("notes and reminder persist after reopen, reminders do not override weights; full JSON roundtrip", async () => {
    const p = await unilateral(),
      id = await svc.start(p),
      e = (await svc.session(id)).exercises[0];
    await svc.editExerciseNotes(e.id, {
      notes: "左侧控制更好，逗号,换行\n测试",
      next_reminder: "下次尝试 50 kg",
    });
    await svc.editSet(e.id, e.sets[0].id, { reps: 12, rir: 1 });
    sqlite.close();
    sqlite = new Database(path);
    await migrate(adapter(sqlite));
    svc = new FitLog(new Repository(adapter(sqlite)));
    expect((await svc.session(id)).exercises[0].notes).toContain("左侧");
    const fresh = await svc.session(await svc.start(p));
    expect(fresh.exercises[0].next_reminder_snapshot).toBe("下次尝试 50 kg");
    expect(fresh.exercises[0].sets[0].weight).toBe(10);
    const backup = await svc.exportJSON();
    await svc.restore(backup);
    expect((await svc.session(id)).exercises[0].sets[0]).toMatchObject({
      side: "left",
      reps: 12,
      rir: 1,
    });
    const csv = await svc.exportCSV();
    expect(csv).toContain('"侧别"');
    expect(csv).toContain('"左"');
    expect(csv).toContain('"动作备注"');
    const bad = JSON.parse(backup);
    bad.session_sets.pop();
    await expect(svc.restore(JSON.stringify(bad))).rejects.toThrow(
      "左右组结构",
    );
    expect((await svc.session(id)).exercises[0].notes).toContain("左侧");
  });
  it("historical action notes save explicitly and reject wrong session ownership", async () => {
    const p = await prep([30]),
      a = await svc.start(p),
      b = await svc.start(p),
      draft = await svc.session(a);
    draft.exercises[0].notes = "历史修改";
    expect((await svc.session(a)).exercises[0].notes).toBe("");
    await svc.saveHistory(draft);
    expect((await svc.session(a)).exercises[0].notes).toBe("历史修改");
    draft.exercises[0].id = (await svc.session(b)).exercises[0].id;
    await expect(svc.saveHistory(draft)).rejects.toThrow("归属");
    expect((await svc.session(b)).exercises[0].notes).toBe("");
  });
  it("restores old V2 backups preserving old independent exercises as bilateral", async () => {
    const p = await prep([30]),
      id = await svc.start(p);
    await complete(id, [30]);
    const data = JSON.parse(await svc.exportJSON());
    data.schema_version = 2;
    for (const t of tables)
      for (const row of data[t])
        for (const key of Object.keys(v3Defaults[t] ?? {})) delete row[key];
    await svc.restore(JSON.stringify(data));
    expect((await rows(id))[0]).toMatchObject({
      side: "both",
      weight: 30,
      completed: 1,
    });
  });
  it("real old schema migrates non-destructively and failed table rebuild rolls back", async () => {
    const p = await prep([30]),
      id = await svc.start(p);
    await complete(id, [30]);
    const data = JSON.parse(await svc.exportJSON());
    const old = new Database(join(dir, "old.sqlite"));
    old.exec(schema);
    old.pragma("user_version=2");
    for (const t of tables)
      for (const row of data[t]) {
        const copy = { ...row };
        for (const key of Object.keys(v3Defaults[t] ?? {})) delete copy[key];
        const keys = Object.keys(copy);
        old
          .prepare(
            `INSERT INTO ${t} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
          )
          .run(...keys.map((k) => copy[k]));
      }
    const db = adapter(old),
      exec = db.exec;
    db.exec = async (sql) => {
      if (sql.includes("INSERT INTO session_sets_v3"))
        throw Error("simulated write failure");
      await exec(sql);
    };
    await expect(migrate(db)).rejects.toThrow("simulated");
    expect(old.pragma("user_version", { simple: true })).toBe(2);
    expect(old.prepare("SELECT weight FROM session_sets").get()).toEqual({
      weight: 30,
    });
    db.exec = exec;
    await migrate(db);
    expect(old.pragma("user_version", { simple: true })).toBe(3);
    expect(
      old.prepare("SELECT weight,side,completed FROM session_sets").get(),
    ).toEqual({ weight: 30, side: "both", completed: 1 });
    old.close();
  });
});

it("temporary unilateral actions and paired history validity", async () => {
  const p = await prep([30]),
    id = await svc.start(p);
  await svc.addSessionExercise(id, "单臂划船", "unilateral");
  let s = await svc.session(id);
  const e = s.exercises[1];
  expect(e.mode).toBe("unilateral");
  expect(e.sets.map((x: any) => x.side)).toEqual(["left", "right"]);
  await svc.editSet(s.exercises[0].id, s.exercises[0].sets[0].id, {
    reps: 12,
    completed: 1,
  });
  for (const set of e.sets)
    await svc.editSet(e.id, set.id, {
      weight: set.side === "left" ? 10 : 12,
      reps: 12,
      completed: 1,
    });
  await svc.finish(id);
  s = await svc.session(id);
  s.exercises[1].sets[1].completed = 0;
  await svc.saveHistory(s);
  expect(await svc.r.history(e.exercise_id, 1, "left")).toBeUndefined();
  await svc.addSessionExercise(await svc.start(p), "单臂划船", "unilateral");
});
it("plan-only unilateral import accepts side defaults including intentional empty", async () => {
  const p = await monday();
  await svc.importPlansJSON(
    JSON.stringify({
      format: "fitlog-plans",
      version: 1,
      days: [
        {
          weekday: 1,
          name: "左右",
          rest: false,
          exercises: [
            {
              name: "侧平举",
              mode: "unilateral",
              weights: [15],
              weights_left: [null],
              weights_right: [12],
            },
          ],
        },
      ],
    }),
  );
  const r = await rows(await svc.start(p));
  expect(r.map((s: any) => s.weight)).toEqual([null, 12]);
});

it("rest plans cannot create sessions, retain actions, and can be re-enabled", async () => {
  const p = await prep([30]),
    plan = await svc.plan(p);
  plan.rest = 1;
  await svc.savePlan(plan);
  const before = await svc.r.all("SELECT id FROM sessions");
  await expect(svc.start(p)).rejects.toThrow("休息日");
  expect(await svc.r.all("SELECT id FROM sessions")).toEqual(before);
  expect((await svc.plan(p)).exercises).toHaveLength(1);
  plan.rest = 0;
  await svc.savePlan(plan);
  expect((await rows(await svc.start(p)))[0].weight).toBe(30);
});

import { nativeAdapter, sqlStatements, NativeSQLiteBridge } from "../src/db";
import { migration3Columns, sideSetsSchema } from "../src/schema";
function androidBridge(d: Database.Database): NativeSQLiteBridge {
  return {
    // Mirrors the native plugin's ";\\n" batch separator and execSQL's first-statement behavior.
    execute: async (sql) => {
      for (const chunk of sql.split(";\n")) {
        const first = sqlStatements(chunk)[0];
        if (first) d.exec(first);
      }
      return {};
    },
    run: async (sql, values) => {
      d.prepare(sql).run(...values);
      return {};
    },
    query: async (sql, values) => ({ values: d.prepare(sql).all(...values) }),
  };
}
async function legacyFixture() {
  const p = await prep([30]),
    id = await svc.start(p);
  await complete(id, [30]);
  const snapshot = JSON.parse(await svc.exportJSON()),
    old = new Database(join(dir, "native.sqlite"));
  old.exec(schema);
  old.pragma("user_version=2");
  for (const table of tables)
    for (const row of snapshot[table]) {
      const copy = { ...row };
      for (const key of Object.keys(v3Defaults[table] ?? {})) delete copy[key];
      const keys = Object.keys(copy);
      old
        .prepare(
          `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        )
        .run(...keys.map((k) => copy[k]));
    }
  return { old, id, p };
}
describe("Android bridge migration regression", () => {
  it("dispatches same-line SQL statements individually without splitting literals", async () => {
    expect(
      sqlStatements(
        "CREATE TABLE x(v TEXT); INSERT INTO x VALUES('a;b'); SELECT * FROM x;",
      ),
    ).toHaveLength(3);
    const db = new Database(":memory:");
    const bridge = nativeAdapter(androidBridge(db), async () => {});
    await bridge.exec("CREATE TABLE x(v TEXT); INSERT INTO x VALUES('a;b');");
    expect(await bridge.all("SELECT * FROM x")).toEqual([{ v: "a;b" }]);
    db.close();
  });
  it("native bridge upgrades actual V2 then opens history, edits and starts a fresh session", async () => {
    const { old, id, p } = await legacyFixture();
    const db = nativeAdapter(androidBridge(old), async (text) =>
      writeFileSync(join(dir, "native-backup.json"), text),
    );
    await migrate(db);
    const service = new FitLog(new Repository(db));
    expect((await service.session(id)).exercises[0].sets[0]).toMatchObject({
      weight: 30,
      side: "both",
    });
    const history = await service.session(id);
    history.exercises[0].sets[0].weight = 35;
    await service.saveHistory(history);
    expect(
      (await service.session(await service.start(p))).exercises[0].sets[0]
        .weight,
    ).toBe(35);
    old.close();
  });
  it("repairs version3 marker with old group table and stale temporary copy without losing current records", async () => {
    const { old, id, p } = await legacyFixture();
    for (const [table, column, type] of migration3Columns)
      old.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    old.exec(sideSetsSchema);
    old.exec(
      "INSERT INTO session_sets_v3 (id,session_exercise_id,set_index,weight,reps,rir,completed,weight_source,default_weight,updated_at) SELECT id,session_exercise_id,set_index,weight,reps,rir,completed,weight_source,default_weight,updated_at FROM session_sets",
    );
    old.pragma("user_version=3");
    old.exec(
      "UPDATE session_sets SET weight=33; UPDATE session_exercises SET notes='升级后已有备注'",
    );
    let protection: any;
    const db = nativeAdapter(androidBridge(old), async (text) => {
      protection = JSON.parse(text);
    });
    await migrate(db);
    const service = new FitLog(new Repository(db));
    expect((await service.session(id)).exercises[0]).toMatchObject({
      notes: "升级后已有备注",
    });
    expect((await service.session(id)).exercises[0].sets[0].weight).toBe(33);
    expect(protection.session_sets[0].weight).toBe(33);
    expect(protection.migration_artifacts.session_sets_v3[0].weight).toBe(30);
    expect(
      (await service.session(await service.start(p))).exercises[0].sets[0]
        .weight,
    ).toBe(33);
    expect(
      await db.all(
        "SELECT name FROM sqlite_master WHERE name='session_sets_v3'",
      ),
    ).toHaveLength(0);
    await service.restore(JSON.stringify(protection));
    expect((await service.session(id)).exercises[0].sets[0].weight).toBe(33);
    old.close();
  });
  it("repair protection failure and interrupted rebuilding both preserve the old authoritative records", async () => {
    const { old, id } = await legacyFixture();
    old.pragma("user_version=3");
    const bridge = androidBridge(old);
    await expect(
      migrate(
        nativeAdapter(bridge, async () => {
          throw Error("backup unavailable");
        }),
      ),
    ).rejects.toThrow("backup unavailable");
    expect(old.prepare("SELECT weight FROM session_sets").get()).toEqual({
      weight: 30,
    });
    const exec = bridge.execute;
    bridge.execute = async (sql, transaction) => {
      if (sql.startsWith("DROP TABLE session_sets;"))
        throw Error("simulated native failure");
      return exec(sql, transaction);
    };
    await expect(
      migrate(nativeAdapter(bridge, async () => {})),
    ).rejects.toThrow("simulated native failure");
    expect(old.prepare("SELECT weight FROM session_sets").get()).toEqual({
      weight: 30,
    });
    expect(
      old
        .prepare("PRAGMA table_info(session_sets)")
        .all()
        .some((c: any) => c.name === "side"),
    ).toBe(false);
    old.close();
  });
});
