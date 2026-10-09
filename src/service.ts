import { Repository, uuid, now } from "./repository";
import { initialWeight, propagate, valid, SetRow } from "./domain";
import { tables, v3Defaults } from "./schema";
const sampleExercises: string[][] = [
  [
    "平板卧推",
    "上斜哑铃卧推",
    "器械夹胸",
    "侧平举",
    "三头下压",
    "过顶三头伸展",
  ],
  ["高位下拉", "坐姿划船", "单臂哑铃划船", "卷腹", "悬垂举腿"],
  [],
  ["深蹲", "罗马尼亚硬拉", "腿举", "腿弯举", "提踵", "卷腹"],
  ["高位下拉", "坐姿划船", "反向飞鸟", "面拉", "哑铃弯举", "三头下压"],
  ["上斜哑铃卧推", "平板卧推", "器械夹胸", "二头弯举", "三头下压"],
  [],
];
export class FitLog {
  private queue: Promise<any> = Promise.resolve();
  constructor(public r: Repository) {}
  write<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async flush() {
    await this.queue;
  }
  async initialize(sample: boolean) {
    return this.write(() =>
      this.r.tx(async () => {
        if ((await this.r.all("SELECT id FROM plans")).length) return;
        const names = [
          "胸 + 肩 + 三头",
          "背 + 核心",
          "休息或有氧",
          "腿 + 核心",
          "背 + 后束 + 手臂",
          "胸 + 手臂",
          "休息",
        ];
        for (let i = 1; i <= 7; i++) {
          const id = uuid();
          await this.r.insert("plans", {
            id,
            name: sample ? names[i - 1] : "待编辑",
            weekday: i,
            version: 1,
            rest: sample && [3, 7].includes(i) ? 1 : 0,
            created_at: now(),
            updated_at: now(),
          });
          if (sample)
            for (const name of sampleExercises[i - 1])
              await this.addPlanExerciseInternal(id, name);
        }
      }),
    );
  }
  fillEmptySampleDays() {
    return this.write(() =>
      this.r.tx(async () => {
        const plans = await this.r.all("SELECT * FROM plans ORDER BY weekday");
        for (const plan of plans) {
          if (
            plan.rest ||
            (
              await this.r.all(
                "SELECT id FROM plan_exercises WHERE plan_id=?",
                [plan.id],
              )
            ).length
          )
            continue;
          for (const name of sampleExercises[plan.weekday - 1])
            await this.addPlanExerciseInternal(plan.id, name);
        }
      }),
    );
  }
  importPlansJSON(text: string) {
    const data = JSON.parse(text);
    if (
      data.format !== "fitlog-plans" ||
      data.version !== 1 ||
      !Array.isArray(data.days) ||
      !data.days.length
    )
      throw Error("不是有效的 FitLog 计划文件");
    const seen = new Set<number>();
    for (const d of data.days) {
      if (
        !Number.isInteger(d.weekday) ||
        d.weekday < 1 ||
        d.weekday > 7 ||
        seen.has(d.weekday) ||
        typeof d.name !== "string" ||
        !d.name.trim() ||
        typeof d.rest !== "boolean" ||
        !Array.isArray(d.exercises)
      )
        throw Error("日期或计划字段无效");
      seen.add(d.weekday);
      for (const e of d.exercises) {
        if (e.mode != null && !["bilateral", "unilateral"].includes(e.mode))
          throw Error("动作模式无效");
        if (
          typeof e.name !== "string" ||
          !e.name.trim() ||
          !Array.isArray(e.weights) ||
          !e.weights.length ||
          e.weights.length > 100 ||
          e.weights.some(
            (w: any) =>
              w !== null &&
              (typeof w !== "number" || !Number.isFinite(w) || w < 0),
          )
        )
          throw Error("动作或每组重量无效");
        for (const key of ["weights_left", "weights_right"])
          if (
            e[key] !== undefined &&
            (!Array.isArray(e[key]) ||
              e[key].length !== e.weights.length ||
              e[key].some(
                (w: any) =>
                  w !== null &&
                  (typeof w !== "number" || !Number.isFinite(w) || w < 0),
              ))
          )
            throw Error("左右侧预设重量无效");
        for (const n of [e.reps_min, e.reps_max])
          if (n != null && (!Number.isInteger(n) || n < 0))
            throw Error("目标次数无效");
        if (e.reps_min != null && e.reps_max != null && e.reps_min > e.reps_max)
          throw Error("目标次数范围无效");
      }
    }
    return this.write(() =>
      this.r.tx(async () => {
        for (const d of data.days) {
          const plan = (
            await this.r.all("SELECT id FROM plans WHERE weekday=?", [
              d.weekday,
            ])
          )[0];
          if (!plan) throw Error("请先初始化周计划");
          await this.r.run("DELETE FROM plan_exercises WHERE plan_id=?", [
            plan.id,
          ]);
          await this.r.run(
            "UPDATE plans SET name=?,rest=?,version=version+1,updated_at=? WHERE id=?",
            [d.name.trim(), d.rest ? 1 : 0, now(), plan.id],
          );
          for (let i = 0; i < d.exercises.length; i++) {
            const e = d.exercises[i],
              id = uuid();
            await this.r.insert("plan_exercises", {
              id,
              plan_id: plan.id,
              exercise_id: await this.resolveExercise(e.name.trim()),
              mode: e.mode ?? "bilateral",
              sort_order: i,
              target_sets: e.weights.length,
              target_reps_min: e.reps_min ?? null,
              target_reps_max: e.reps_max ?? null,
            });
            for (let j = 0; j < e.weights.length; j++)
              await this.r.insert("plan_sets", {
                id: uuid(),
                plan_exercise_id: id,
                set_index: j + 1,
                default_weight: e.weights[j],
                default_weight_left:
                  e.mode === "unilateral"
                    ? e.weights_left
                      ? e.weights_left[j]
                      : e.weights[j]
                    : null,
                default_weight_right:
                  e.mode === "unilateral"
                    ? e.weights_right
                      ? e.weights_right[j]
                      : e.weights[j]
                    : null,
              });
          }
        }
        return data.days.length;
      }),
    );
  }
  async resolveExercise(name: string) {
    const found = (
      await this.r.all("SELECT id FROM exercises WHERE name=?", [name])
    )[0];
    if (found) return found.id;
    const id = uuid();
    await this.r.insert("exercises", {
      id,
      name,
      muscle_group: "",
      equipment: "",
      created_at: now(),
      updated_at: now(),
    });
    return id;
  }
  private async addPlanExerciseInternal(plan: string, name: string) {
    const exercise = await this.resolveExercise(name);
    const id = uuid();
    const count = (
      await this.r.all(
        "SELECT COUNT(*) n FROM plan_exercises WHERE plan_id=?",
        [plan],
      )
    )[0].n;
    await this.r.insert("plan_exercises", {
      id,
      plan_id: plan,
      exercise_id: exercise,
      sort_order: count,
      target_sets: 3,
      target_reps_min: null,
      target_reps_max: null,
    });
    for (let i = 1; i <= 3; i++)
      await this.r.insert("plan_sets", {
        id: uuid(),
        plan_exercise_id: id,
        set_index: i,
        default_weight: null,
      });
  }
  addPlanExercise(plan: string, name: string) {
    if (!name.trim()) throw Error("动作名称不能为空");
    return this.write(() =>
      this.r.tx(() => this.addPlanExerciseInternal(plan, name.trim())),
    );
  }
  async plan(id: string) {
    const p = (await this.r.all("SELECT * FROM plans WHERE id=?", [id]))[0];
    p.exercises = await this.r.all(
      "SELECT pe.*,e.name FROM plan_exercises pe JOIN exercises e ON pe.exercise_id=e.id WHERE plan_id=? ORDER BY sort_order",
      [id],
    );
    for (const e of p.exercises)
      e.sets = await this.r.all(
        "SELECT * FROM plan_sets WHERE plan_exercise_id=? ORDER BY set_index",
        [e.id],
      );
    return p;
  }
  savePlan(p: any) {
    if (!p.name.trim()) throw Error("训练名称不能为空");
    for (const e of p.exercises) {
      if (!["bilateral", "unilateral"].includes(e.mode ?? "bilateral"))
        throw Error("动作模式无效");
      if (!e.sets.length) throw Error("动作至少需要一组");
      if (
        e.target_reps_min != null &&
        e.target_reps_max != null &&
        e.target_reps_min > e.target_reps_max
      )
        throw Error("目标次数上限不能小于下限");
    }
    return this.write(() =>
      this.r.tx(async () => {
        await this.r.run(
          "UPDATE plans SET name=?,rest=?,version=version+1,updated_at=? WHERE id=?",
          [p.name, p.rest, now(), p.id],
        );
        const old = await this.r.all(
          "SELECT id FROM plan_exercises WHERE plan_id=?",
          [p.id],
        );
        for (const e of old)
          if (!p.exercises.some((x: any) => x.id === e.id))
            await this.r.run("DELETE FROM plan_exercises WHERE id=?", [e.id]);
        for (let order = 0; order < p.exercises.length; order++) {
          const e = p.exercises[order];
          await this.r.run(
            "UPDATE plan_exercises SET sort_order=?,target_sets=?,target_reps_min=?,target_reps_max=?,mode=? WHERE id=? AND plan_id=?",
            [
              order,
              e.sets.length,
              e.target_reps_min,
              e.target_reps_max,
              e.mode ?? "bilateral",
              e.id,
              p.id,
            ],
          );
          await this.r.run("DELETE FROM plan_sets WHERE plan_exercise_id=?", [
            e.id,
          ]);
          for (let i = 0; i < e.sets.length; i++)
            await this.r.insert("plan_sets", {
              id: uuid(),
              plan_exercise_id: e.id,
              set_index: i + 1,
              default_weight: e.sets[i].default_weight,
              default_weight_left: e.sets[i].default_weight_left ?? null,
              default_weight_right: e.sets[i].default_weight_right ?? null,
            });
        }
      }),
    );
  }
  copyPlan(source: string, target: string) {
    return this.write(() =>
      this.r.tx(async () => {
        if (source === target) return;
        const p = await this.plan(source);
        await this.r.run("DELETE FROM plan_exercises WHERE plan_id=?", [
          target,
        ]);
        await this.r.run(
          "UPDATE plans SET name=?,rest=?,version=version+1,updated_at=? WHERE id=?",
          [p.name, p.rest, now(), target],
        );
        for (const e of p.exercises) {
          const id = uuid();
          const { name, sets, ...row } = e;
          await this.r.insert("plan_exercises", {
            ...row,
            id,
            plan_id: target,
          });
          for (const s of sets)
            await this.r.insert("plan_sets", {
              ...s,
              id: uuid(),
              plan_exercise_id: id,
            });
        }
      }),
    );
  }
  start(plan: string) {
    return this.write(() =>
      this.r.tx(async () => {
        const p = await this.plan(plan);
        if (p.rest) throw Error("该计划为休息日，请选择其他日期的训练计划");
        if (!p.exercises.length) throw Error("请先为该计划添加动作");
        const id = uuid();
        await this.r.insert("sessions", {
          id,
          plan_id: plan,
          plan_name_snapshot: p.name,
          started_at: now(),
          completed_at: null,
          status: "active",
          notes: "",
        });
        for (const e of p.exercises) {
          const seid = uuid();
          await this.r.insert("session_exercises", {
            id: seid,
            session_id: id,
            exercise_id: e.exercise_id,
            exercise_name_snapshot: e.name,
            sort_order: e.sort_order,
            skipped: 0,
            mode: e.mode,
            target_reps_min: e.target_reps_min,
            target_reps_max: e.target_reps_max,
            notes: "",
            next_reminder_snapshot: (
              await this.r.all(
                "SELECT next_reminder FROM exercises WHERE id=?",
                [e.exercise_id],
              )
            )[0].next_reminder,
          });
          const previous: Record<string, number | null> = {};
          for (const set of e.sets) {
            for (const side of e.mode === "unilateral"
              ? ["left", "right"]
              : ["both"]) {
              const preset =
                side === "both"
                  ? set.default_weight
                  : (set[`default_weight_${side}`] ?? null);
              const h = await this.r.history(
                e.exercise_id,
                set.set_index,
                side,
              );
              const weight = initialWeight(h?.weight, previous[side], preset);
              previous[side] = weight.weight;
              await this.r.insert("session_sets", {
                id: uuid(),
                session_exercise_id: seid,
                set_index: set.set_index,
                side,
                ...weight,
                reps: null,
                rir: null,
                completed: 0,
                default_weight: preset,
                updated_at: now(),
              });
            }
          }
        }
        return id;
      }),
    );
  }
  async session(id: string) {
    const s = (await this.r.all("SELECT * FROM sessions WHERE id=?", [id]))[0];
    if (!s) throw Error("训练不存在");
    s.exercises = await this.r.all(
      "SELECT * FROM session_exercises WHERE session_id=? ORDER BY sort_order",
      [id],
    );
    for (const e of s.exercises) {
      e.sets = await this.r.sets(e.id);
      for (const set of e.sets)
        set.reference_reps =
          (await this.r.history(e.exercise_id, set.set_index, set.side))
            ?.reps ?? null;
    }
    return s;
  }
  async persistSet(s: SetRow) {
    for (const key of ["weight", "reps", "rir"] as const) {
      const value = s[key];
      if (
        value !== null &&
        (typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0 ||
          (key !== "weight" && !Number.isInteger(value)))
      )
        throw Error("无效训练数值");
    }
    if (![0, 1].includes(s.completed)) throw Error("完成状态无效");
    await this.r.run(
      "UPDATE session_sets SET weight=?,reps=?,rir=?,completed=?,weight_source=?,updated_at=? WHERE id=?",
      [s.weight, s.reps, s.rir, s.completed, s.weight_source, now(), s.id],
    );
  }
  editSet(parent: string, id: string, patch: Partial<SetRow>) {
    return this.write(() =>
      this.r.tx(async () => {
        const rows = (await this.r.sets(parent)) as SetRow[];
        const target = rows.find((s) => s.id === id);
        if (!target) throw Error("训练组不存在");
        Object.assign(target, patch);
        if ("weight" in patch) target.weight_source = "manual";
        if (target.completed && !valid(target))
          throw Error("完成组需有效重量和大于0的整数次数");
        for (const s of propagate(rows)) await this.persistSet(s);
      }),
    );
  }
  addSet(parent: string) {
    return this.write(() =>
      this.r.tx(async () => {
        const rows = await this.r.sets(parent);
        const e = (
          await this.r.all("SELECT * FROM session_exercises WHERE id=?", [
            parent,
          ])
        )[0];
        const index = (rows[rows.length - 1]?.set_index ?? 0) + 1;
        for (const side of e.mode === "unilateral"
          ? ["left", "right"]
          : ["both"]) {
          const h = await this.r.history(e.exercise_id, index, side);
          const previous = rows.filter((s) => s.side === side).at(-1)?.weight;
          await this.r.insert("session_sets", {
            id: uuid(),
            session_exercise_id: parent,
            set_index: index,
            side,
            ...initialWeight(h?.weight, previous, null),
            default_weight: null,
            reps: null,
            rir: null,
            completed: 0,
            updated_at: now(),
          });
        }
      }),
    );
  }
  deleteSet(parent: string, id: string) {
    return this.write(() =>
      this.r.tx(async () => {
        const target = (await this.r.sets(parent)).find((s) => s.id === id);
        if (!target) throw Error("训练组不存在");
        await this.r.run(
          "DELETE FROM session_sets WHERE session_exercise_id=? AND set_index=?",
          [parent, target.set_index],
        );
        await this.r.run(
          "UPDATE session_sets SET set_index=set_index-1 WHERE session_exercise_id=? AND set_index>?",
          [parent, target.set_index],
        );
        const rows = await this.r.sets(parent);
        for (const s of propagate(rows as SetRow[])) await this.persistSet(s);
      }),
    );
  }
  editExerciseNotes(
    id: string,
    patch: { notes?: string; next_reminder?: string },
  ) {
    return this.write(() =>
      this.r.tx(async () => {
        const e = (
          await this.r.all("SELECT * FROM session_exercises WHERE id=?", [id])
        )[0];
        if (!e) throw Error("动作不存在");
        for (const value of Object.values(patch))
          if (typeof value !== "string" || value.length > 10000)
            throw Error("备注无效或过长");
        if (patch.notes !== undefined)
          await this.r.run("UPDATE session_exercises SET notes=? WHERE id=?", [
            patch.notes,
            id,
          ]);
        if (patch.next_reminder !== undefined) {
          await this.r.run(
            "UPDATE exercises SET next_reminder=?,updated_at=? WHERE id=?",
            [patch.next_reminder, now(), e.exercise_id],
          );
          await this.r.run(
            "UPDATE session_exercises SET next_reminder_snapshot=? WHERE id=?",
            [patch.next_reminder, id],
          );
        }
      }),
    );
  }
  skipExercise(id: string, skip: number) {
    return this.write(() =>
      this.r.run("UPDATE session_exercises SET skipped=? WHERE id=?", [
        skip,
        id,
      ]),
    );
  }
  addSessionExercise(session: string, name: string, mode = "bilateral") {
    return this.write(() =>
      this.r.tx(async () => {
        if (!name.trim()) throw Error("动作名不能为空");
        if (!["bilateral", "unilateral"].includes(mode))
          throw Error("动作模式无效");
        const eid = await this.resolveExercise(name.trim());
        const id = uuid();
        const count = (
          await this.r.all(
            "SELECT COUNT(*) n FROM session_exercises WHERE session_id=?",
            [session],
          )
        )[0].n;
        await this.r.insert("session_exercises", {
          id,
          session_id: session,
          exercise_id: eid,
          exercise_name_snapshot: name.trim(),
          sort_order: count,
          skipped: 0,
          mode,
          next_reminder_snapshot: (
            await this.r.all("SELECT next_reminder FROM exercises WHERE id=?", [
              eid,
            ])
          )[0].next_reminder,
        });
        for (const side of mode === "unilateral"
          ? ["left", "right"]
          : ["both"]) {
          const h = await this.r.history(eid, 1, side);
          await this.r.insert("session_sets", {
            id: uuid(),
            session_exercise_id: id,
            set_index: 1,
            side,
            ...initialWeight(h?.weight, null, null),
            default_weight: null,
            reps: null,
            rir: null,
            completed: 0,
            updated_at: now(),
          });
        }
      }),
    );
  }
  finish(id: string) {
    return this.write(() =>
      this.r.tx(async () => {
        const s = await this.session(id);
        const rows = s.exercises
          .filter((e: any) => !e.skipped)
          .flatMap((e: any) => e.sets);
        if (!rows.length || rows.some((x: any) => !x.completed || !valid(x)))
          throw Error("请完成所有未跳过动作的训练组，或删除未做的组");
        await this.r.run(
          "UPDATE sessions SET status='completed',completed_at=? WHERE id=?",
          [now(), id],
        );
      }),
    );
  }
  saveHistory(s: any) {
    return this.write(() =>
      this.r.tx(async () => {
        await this.r.run("UPDATE sessions SET notes=? WHERE id=?", [
          s.notes,
          s.id,
        ]);
        for (const e of s.exercises) {
          const owner = await this.r.all(
            "SELECT id FROM session_exercises WHERE id=? AND session_id=?",
            [e.id, s.id],
          );
          if (!owner.length) throw Error("历史动作归属校验失败");
          await this.r.run("UPDATE session_exercises SET notes=? WHERE id=?", [
            e.notes ?? "",
            e.id,
          ]);
          for (const set of e.sets) {
            if (set.completed && !valid(set))
              throw Error("历史完成组需有效重量与次数");
            const match = await this.r.all(
              "SELECT ss.id FROM session_sets ss JOIN session_exercises se ON se.id=ss.session_exercise_id WHERE ss.id=? AND se.session_id=? AND se.id=?",
              [set.id, s.id, e.id],
            );
            if (!match.length) throw Error("历史记录归属校验失败");
            await this.persistSet(set);
          }
        }
      }),
    );
  }
  deleteSession(id: string) {
    return this.write(() =>
      this.r.run("DELETE FROM sessions WHERE id=?", [id]),
    );
  }
  exportJSON() {
    return this.write(async () => JSON.stringify(await this.r.dump(), null, 2));
  }
  exportCSV() {
    return this.write(async () => {
      const rows = await this.r.all(
        `SELECT s.started_at,s.plan_name_snapshot,se.exercise_name_snapshot,ss.set_index,ss.weight,ss.reps,ss.rir,ss.completed,se.skipped,ss.side,se.notes,se.next_reminder_snapshot FROM session_sets ss JOIN session_exercises se ON se.id=ss.session_exercise_id JOIN sessions s ON s.id=se.session_id ORDER BY s.started_at DESC,se.sort_order,ss.set_index,ss.side`,
      );
      const escape = (v: any) =>
        '"' + String(v ?? "").replaceAll('"', '""') + '"';
      return (
        "\uFEFF" +
        [
          [
            "日期",
            "训练名称",
            "动作名称",
            "组序号",
            "重量",
            "次数",
            "RIR",
            "完成状态",
            "动作跳过",
            "侧别",
            "动作备注",
            "下次提醒",
          ],
          ...rows.map((r) => [
            r.started_at,
            r.plan_name_snapshot,
            r.exercise_name_snapshot,
            r.set_index,
            r.weight,
            r.reps,
            r.rir,
            r.completed,
            r.skipped,
            r.side === "left" ? "左" : r.side === "right" ? "右" : "双手",
            r.notes,
            r.next_reminder_snapshot,
          ]),
        ]
          .map((r) => r.map(escape).join(","))
          .join("\r\n")
      );
    });
  }
  restore(text: string) {
    return this.write(async () => {
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw Error("不是有效JSON");
      }
      if (
        ![1, 2, 3].includes(data.schema_version) ||
        !Number.isFinite(Date.parse(data.exported_at))
      )
        throw Error("不支持的备份版本或时间");
      const columns: Record<string, string[]> = {};
      for (const table of tables) {
        if (!Array.isArray(data[table])) throw Error("缺少表 " + table);
        columns[table] = (await this.r.all(`PRAGMA table_info(${table})`)).map(
          (x) => x.name,
        );
        for (const row of data[table]) {
          if (
            data.schema_version < 3 &&
            row &&
            typeof row === "object" &&
            !Array.isArray(row)
          ) {
            for (const [key, value] of Object.entries(v3Defaults[table] ?? {}))
              if (!(key in row)) row[key] = value;
          }
          if (
            !row ||
            typeof row !== "object" ||
            Array.isArray(row) ||
            Object.keys(row).sort().join() !==
              columns[table].slice().sort().join() ||
            typeof row.id !== "string" ||
            !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.id)
          )
            throw Error("备份字段或UUID无效");
          if (
            row.mode !== undefined &&
            !["bilateral", "unilateral"].includes(row.mode)
          )
            throw Error("动作模式无效");
          if (
            row.side !== undefined &&
            !["both", "left", "right"].includes(row.side)
          )
            throw Error("侧别无效");
          for (const k of ["notes", "next_reminder", "next_reminder_snapshot"])
            if (
              row[k] !== undefined &&
              (typeof row[k] !== "string" || row[k].length > 10000)
            )
              throw Error("备注无效");
          for (const [key, value] of Object.entries(row)) {
            if (
              key.endsWith("_at") &&
              value !== null &&
              (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
            )
              throw Error("备份时间无效");
            if (
              [
                "set_index",
                "sort_order",
                "target_sets",
                "version",
                "weekday",
              ].includes(key) &&
              (!Number.isInteger(value) || Number(value) < 0)
            )
              throw Error("无效序号");
            if (
              [
                "weight",
                "default_weight",
                "default_weight_left",
                "default_weight_right",
                "reps",
                "rir",
                "target_reps_min",
                "target_reps_max",
              ].includes(key) &&
              value !== null &&
              (typeof value !== "number" ||
                !Number.isFinite(value) ||
                value < 0 ||
                (["reps", "rir", "target_reps_min", "target_reps_max"].includes(
                  key,
                ) &&
                  !Number.isInteger(value)))
            )
              throw Error("无效训练数值");
          }
        }
      }
      for (const e of data.session_exercises) {
        const rows = data.session_sets.filter(
          (s: any) => s.session_exercise_id === e.id,
        );
        const indices = new Set(rows.map((s: any) => s.set_index));
        for (const index of indices) {
          const sides = rows
            .filter((s: any) => s.set_index === index)
            .map((s: any) => s.side)
            .sort()
            .join(",");
          if (sides !== (e.mode === "unilateral" ? "left,right" : "both"))
            throw Error("左右组结构无效");
        }
      }
      await this.r.tx(async () => {
        for (const t of [...tables].reverse())
          await this.r.run(`DELETE FROM ${t}`);
        for (const t of tables)
          for (const row of data[t]) await this.r.insert(t, row);
        if ((await this.r.all("PRAGMA foreign_key_check")).length)
          throw Error("引用关系不完整");
        if (
          (await this.r.all("PRAGMA integrity_check"))[0].integrity_check !==
          "ok"
        )
          throw Error("恢复完整性检查失败");
        for (const t of tables) {
          const rows = await this.r.all(`SELECT * FROM ${t} ORDER BY id`);
          if (
            JSON.stringify(rows.map((r) => columns[t].map((k) => r[k]))) !==
            JSON.stringify(
              [...data[t]]
                .sort((a: any, b: any) =>
                  a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
                )
                .map((r) => columns[t].map((k) => r[k])),
            )
          )
            throw Error("恢复内容校验失败");
        }
      });
      return {
        sessions: data.sessions.length,
        sets: new Set(
          data.session_sets.map(
            (s: any) => `${s.session_exercise_id}:${s.set_index}`,
          ),
        ).size,
        plans: data.plans.length,
      };
    });
  }
}
