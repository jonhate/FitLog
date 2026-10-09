import React, { useEffect, useState, useRef } from "react";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { createRoot } from "react-dom/client";
import { openDB } from "./db";
import { Repository } from "./repository";
import { FitLog } from "./service";
import { numberInput, groups, targetLabel } from "./domain";
import { saveFile, openFile } from "./files";
import "./style.css";
import { HistoryCalendar, localDateKey } from "./HistoryCalendar";
let service: FitLog;
const day = () => new Date().getDay() || 7;
const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
function Numeric({
  value,
  onChange,
  integer = false,
  placeholder = "—",
}: {
  value: number | null;
  onChange: (n: number | null) => Promise<void> | void;
  integer?: boolean;
  placeholder?: string;
}) {
  const editing = useRef(false);
  const [text, setText] = useState(value == null ? "" : String(value));
  const [error, setError] = useState("");
  useEffect(() => {
    if (!editing.current) setText(value == null ? "" : String(value));
  }, [value]);
  return (
    <input
      aria-label={placeholder}
      className={error ? "invalid" : ""}
      inputMode={integer ? "numeric" : "decimal"}
      value={text}
      placeholder={placeholder}
      title={error}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        try {
          const n = numberInput(v, integer);
          setError("");
          Promise.resolve(onChange(n)).catch((x) =>
            setError(String(x.message)),
          );
        } catch (x: any) {
          setError(x.message);
        }
      }}
      onBlur={() => {
        editing.current = false;
      }}
      onFocus={(e) => {
        editing.current = true;
        e.target.scrollIntoView({ block: "center", behavior: "smooth" });
      }}
    />
  );
}
function NoteField({
  value,
  label,
  placeholder,
  onChange,
}: {
  value: string;
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const focused = useRef(false),
    [text, setText] = useState(value || "");
  useEffect(() => {
    if (!focused.current) setText(value || "");
  }, [value]);
  return (
    <textarea
      aria-label={label}
      rows={2}
      placeholder={placeholder}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
      }}
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value);
      }}
    />
  );
}
function RepTarget({
  exercise: e,
  change,
}: {
  exercise: any;
  change: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState(e.target_reps_min !== e.target_reps_max);
  return (
    <div className="target-editor">
      <button className="subtle" onClick={() => setOpen(!open)}>
        {targetLabel(e.target_reps_min, e.target_reps_max) ||
          "目标次数：未设置"}{" "}
        · {open ? "收起" : "设置（可选）"}
      </button>
      {open && (
        <>
          <div className="row">
            <button
              className={!range ? "selected" : ""}
              onClick={() => {
                setRange(false);
                e.target_reps_max = e.target_reps_min;
                change();
              }}
            >
              固定次数
            </button>
            <button
              className={range ? "selected" : ""}
              onClick={() => setRange(true)}
            >
              次数范围
            </button>
            <button
              onClick={() => {
                e.target_reps_min = null;
                e.target_reps_max = null;
                change();
                setOpen(false);
              }}
            >
              清除
            </button>
          </div>
          <div className="row">
            <label>
              {range ? "最少次数" : "每组目标次数"}
              <Numeric
                integer
                value={e.target_reps_min}
                placeholder={range ? "最少次数" : "目标次数"}
                onChange={(n) => {
                  e.target_reps_min = n;
                  if (!range) e.target_reps_max = n;
                  change();
                }}
              />
            </label>
            {range && (
              <label>
                最多次数
                <Numeric
                  integer
                  value={e.target_reps_max}
                  placeholder="最多次数"
                  onChange={(n) => {
                    e.target_reps_max = n;
                    change();
                  }}
                />
              </label>
            )}
          </div>
          <small>仅作为训练参考；实际次数仍需逐组填写。</small>
        </>
      )}
    </div>
  );
}
function App() {
  const [adding, setAdding] = useState(false),
    [temporaryName, setTemporaryName] = useState(""),
    [temporaryMode, setTemporaryMode] = useState("bilateral");
  const [historyDate, setHistoryDate] = useState<string | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState("今日"),
    [plans, setPlans] = useState<any[]>([]),
    [selection, setSelection] = useState(""),
    [active, setActive] = useState<any[]>([]),
    [session, setSession] = useState<any>(null),
    [historical, setHistorical] = useState(false),
    [history, setHistory] = useState<any[]>([]),
    [plan, setPlan] = useState<any>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [backup, setBackup] = useState<string | null>(null),
    [stats, setStats] = useState<any>(null);
  const refresh = async () => {
    const ps = await service.r.all("SELECT * FROM plans ORDER BY weekday");
    setPlans(ps);
    setSelection((x) =>
      ps.some((p) => p.id === x)
        ? x
        : (ps.find((p) => p.weekday === day())?.id ?? ""),
    );
    setActive(
      await service.r.all(
        "SELECT * FROM sessions WHERE status='active' ORDER BY started_at DESC",
      ),
    );
    setHistory(
      await service.r.all("SELECT * FROM sessions ORDER BY started_at DESC"),
    );
    setStats({
      sessions: (await service.r.all("SELECT COUNT(*) n FROM sessions"))[0].n,
      sets: (
        await service.r.all(
          "SELECT COUNT(*) n FROM (SELECT session_exercise_id,set_index FROM session_sets GROUP BY session_exercise_id,set_index HAVING MIN(completed)=1)",
        )
      )[0].n,
    });
  };
  useEffect(() => {
    openDB()
      .then((db) => {
        service = new FitLog(new Repository(db));
        return refresh();
      })
      .then(() => setReady(true))
      .catch((e) => setError(e.message));
  }, []);
  const action = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError("");
    try {
      if (document.querySelector("input.invalid"))
        throw Error("请先修正红框中的无效输入");
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const loadSession = async (id: string, h = false) => {
    await service.flush();
    setSession(await service.session(id));
    setHistorical(h);
    setDirty(false);
  };
  useEffect(() => {
    const pop = () => {
      if (historical && dirty && !confirm("放弃尚未保存的历史修改？")) return;
      setSession(null);
      setPlan(null);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [historical, dirty]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener("backButton", () => {
      if (dirty && !confirm("放弃尚未保存的修改？")) return;
      if (backup) setBackup(null);
      else if (session || plan) {
        setSession(null);
        setPlan(null);
        setDirty(false);
        void refresh();
      } else if (tab !== "今日") setTab("今日");
      else void NativeApp.exitApp();
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [dirty, backup, session, plan, tab]);
  const edit = async (e: any, s: any, patch: any) => {
    if (historical) {
      setSession((current: any) => ({
        ...current,
        exercises: current.exercises.map((x: any) =>
          x.id !== e.id
            ? x
            : {
                ...x,
                sets: x.sets.map((r: any) =>
                  r.id === s.id
                    ? {
                        ...r,
                        ...patch,
                        ...("weight" in patch
                          ? { weight_source: "manual" }
                          : {}),
                      }
                    : r,
                ),
              },
        ),
      }));
      setDirty(true);
      return;
    }
    try {
      setMessage("保存中…");
      await service.editSet(e.id, s.id, patch);
      await service.flush();
      const data = await service.session(session.id);
      setSession(data);
      setMessage("已保存");
    } catch (err: any) {
      setError("保存失败：" + err.message);
      throw err;
    }
  };
  const editNotes = async (e: any, value: string, reminder = false) => {
    const key = reminder ? "next_reminder_snapshot" : "notes";
    setSession((current: any) => ({
      ...current,
      exercises: current.exercises.map((x: any) =>
        x.id === e.id ? { ...x, [key]: value } : x,
      ),
    }));
    if (historical) {
      setDirty(true);
      return;
    }
    try {
      setMessage("保存中…");
      await service.editExerciseNotes(
        e.id,
        reminder ? { next_reminder: value } : { notes: value },
      );
      setMessage("已保存");
    } catch (err: any) {
      setError("保存失败：" + err.message);
    }
  };
  const mutateSession = async (fn: () => Promise<any>) =>
    action(async () => {
      await fn();
      await loadSession(session.id);
      await refresh();
    });
  const navigate = (next: string) => {
    if (dirty && !confirm("放弃尚未保存的修改？")) return;
    setAdding(false);
    setTab(next);
    setSession(null);
    setPlan(null);
    setDirty(false);
  };
  const selected = plans.find((p) => p.id === selection);
  return (
    <div className="app">
      {import.meta.env.DEV && (
        <div className="error">
          开发预览：SQLite在内存中，刷新会重置。请安装APK保存正式数据。
        </div>
      )}
      <header>
        <div>
          <strong>
            FitLog<span>V1.3</span>
          </strong>
          <small>本地 · 离线 · 属于你</small>
        </div>
        <div className="badge">离线可用</div>
      </header>
      {error && (
        <div role="alert" className="error">
          {error}
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
      {!ready ? (
        <section>
          <h2>正在打开本地数据库</h2>
          <p>浏览器不作为正式存储。请安装 Android APK 使用。</p>
        </section>
      ) : !plans.length ? (
        <section>
          <h1>开始你的训练记录</h1>
          <p>无需账户。计划与训练保存在手机本地。</p>
          <button
            onClick={() =>
              action(async () => {
                await service.initialize(true);
                await refresh();
              })
            }
          >
            使用示例周计划
          </button>
          <button
            onClick={() =>
              action(async () => {
                await service.initialize(false);
                await refresh();
              })
            }
          >
            创建空白周计划
          </button>
        </section>
      ) : session ? (
        <>
          <button
            className="subtle"
            onClick={() => {
              if (dirty && !confirm("放弃修改？")) return;
              setSession(null);
              setDirty(false);
              refresh();
            }}
          >
            ← 返回
          </button>
          <h1>{session.plan_name_snapshot}</h1>
          <p>
            {new Date(session.started_at).toLocaleString()} ·{" "}
            {historical ? "历史编辑，需明确保存" : message || "输入自动保存"}
          </p>
          <Progress session={session} />
          {session.exercises.map((e: any) => (
            <section key={e.id} className={e.skipped ? "skipped" : ""}>
              <div className="row">
                <h2>{e.exercise_name_snapshot}</h2>
                {!historical && (
                  <button
                    className="subtle"
                    onClick={() =>
                      mutateSession(() =>
                        service.skipExercise(e.id, e.skipped ? 0 : 1),
                      )
                    }
                  >
                    {e.skipped ? "恢复动作" : "跳过"}
                  </button>
                )}
              </div>
              <small>
                {e.mode === "unilateral" ? "单手 · 每组分左右记录" : "双手"}
                {targetLabel(e.target_reps_min, e.target_reps_max) &&
                  ` · ${targetLabel(e.target_reps_min, e.target_reps_max)}`}
              </small>
              <div className="setgrid labels">
                <span>组</span>
                <span>重量 kg</span>
                <span>次数</span>
                <span>RIR</span>
                <span>完成</span>
                <span />
              </div>
              {groups(e.sets).map((group) => (
                <div
                  className={e.mode === "unilateral" ? "side-group" : ""}
                  key={group[0].id}
                >
                  {e.mode === "unilateral" && (
                    <div className="row">
                      <b>第 {group[0].set_index} 组</b>
                      <small>左右完成算一组</small>
                    </div>
                  )}
                  {group.map((s: any, sideIndex: number) => (
                    <div
                      className={`setgrid ${s.completed ? "completed-row" : ""}`}
                      key={s.id}
                    >
                      <b>
                        {s.side === "left"
                          ? "左"
                          : s.side === "right"
                            ? "右"
                            : s.set_index}
                      </b>
                      <Numeric
                        value={s.weight}
                        placeholder="重量"
                        onChange={(n) => edit(e, s, { weight: n })}
                      />
                      <Numeric
                        value={s.reps}
                        integer
                        placeholder={
                          s.reference_reps ? `上次${s.reference_reps}` : "次数"
                        }
                        onChange={(n) => edit(e, s, { reps: n })}
                      />
                      <Numeric
                        value={s.rir}
                        integer
                        placeholder="RIR"
                        onChange={(n) => edit(e, s, { rir: n })}
                      />
                      <button
                        disabled={!!e.skipped}
                        className={s.completed ? "done" : ""}
                        aria-label="完成组"
                        onClick={() =>
                          action(() =>
                            edit(e, s, { completed: s.completed ? 0 : 1 }),
                          )
                        }
                      >
                        {s.completed ? "✓" : "○"}
                      </button>
                      {!historical && sideIndex === 0 && (
                        <button
                          className="subtle"
                          aria-label="删除组"
                          onClick={() => {
                            if (confirm("删除这一组及其输入？"))
                              mutateSession(() =>
                                service.deleteSet(e.id, s.id),
                              );
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              <div className="exercise-notes">
                <label>
                  本次感受
                  <NoteField
                    label="本次感受"
                    placeholder="动作感受、发力或不适（可选）"
                    value={e.notes || ""}
                    onChange={(value) => void editNotes(e, value)}
                  />
                </label>
                <label>
                  下次提醒
                  {historical ? (
                    <p>{e.next_reminder_snapshot || "未设置"}</p>
                  ) : (
                    <NoteField
                      label="下次提醒"
                      placeholder="例如：下次尝试 15 kg，注意控制离心"
                      value={e.next_reminder_snapshot || ""}
                      onChange={(value) => void editNotes(e, value, true)}
                    />
                  )}
                </label>
                <small>提醒会带入下次训练，不会自动改写重量。</small>
              </div>
              {!historical && !e.skipped && (
                <button
                  className="subtle"
                  onClick={() => mutateSession(() => service.addSet(e.id))}
                >
                  ＋ 增加一组
                </button>
              )}
            </section>
          ))}
          {historical ? (
            <section>
              <label>
                训练备注
                <textarea
                  value={session.notes}
                  onChange={(e) => {
                    setSession({ ...session, notes: e.target.value });
                    setDirty(true);
                  }}
                />
              </label>
              <button
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await service.saveHistory(session);
                    setDirty(false);
                    setMessage("历史已保存");
                    await refresh();
                  })
                }
              >
                保存历史修改
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (confirm("永久删除这次训练？建议先备份。"))
                    action(async () => {
                      await service.deleteSession(session.id);
                      setSession(null);
                      await refresh();
                    });
                }}
              >
                删除这次训练
              </button>
            </section>
          ) : (
            <>
              {adding ? (
                <section>
                  <h2>临时动作</h2>
                  <label>
                    动作名称
                    <input
                      aria-label="临时动作名称"
                      value={temporaryName}
                      onChange={(event) => setTemporaryName(event.target.value)}
                    />
                  </label>
                  <label>
                    记录方式
                    <select
                      aria-label="临时动作记录方式"
                      value={temporaryMode}
                      onChange={(event) => setTemporaryMode(event.target.value)}
                    >
                      <option value="bilateral">双手 / 双侧同时</option>
                      <option value="unilateral">单手 / 单侧分开</option>
                    </select>
                  </label>
                  <button
                    disabled={busy}
                    onClick={() =>
                      mutateSession(async () => {
                        await service.addSessionExercise(
                          session.id,
                          temporaryName,
                          temporaryMode,
                        );
                        setAdding(false);
                        setTemporaryName("");
                      })
                    }
                  >
                    添加到本次训练
                  </button>
                  <button onClick={() => setAdding(false)}>取消</button>
                </section>
              ) : (
                <button onClick={() => setAdding(true)}>＋ 临时动作</button>
              )}
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await service.finish(session.id);
                    setSession(null);
                    await refresh();
                  })
                }
              >
                完成训练
              </button>
            </>
          )}
        </>
      ) : plan ? (
        <>
          <button
            className="subtle"
            onClick={() => {
              if (dirty && !confirm("放弃计划修改？")) return;
              setPlan(null);
              setDirty(false);
            }}
          >
            ← 返回周计划
          </button>
          <h1>编辑 · 周{weekdays[plan.weekday - 1]}</h1>
          <input
            aria-label="训练名称"
            value={plan.name}
            onChange={(e) => {
              setPlan({ ...plan, name: e.target.value });
              setDirty(true);
            }}
          />
          <label className="row rest-switch">
            <input
              role="switch"
              aria-label="设为休息日"
              type="checkbox"
              checked={!!plan.rest}
              onChange={(e) => {
                setPlan({ ...plan, rest: e.target.checked ? 1 : 0 });
                setDirty(true);
              }}
            />
            <span>
              设为休息日<small>开启后，今日页面显示休息状态</small>
            </span>
          </label>
          {plan.exercises.map((e: any, index: number) => (
            <section key={e.id}>
              <div className="row">
                <h2>{e.name}</h2>
                <button
                  onClick={() => {
                    const list = [...plan.exercises];
                    if (index > 0) {
                      [list[index - 1], list[index]] = [
                        list[index],
                        list[index - 1],
                      ];
                      setPlan({ ...plan, exercises: list });
                      setDirty(true);
                    }
                  }}
                >
                  ↑
                </button>
                <button
                  onClick={() => {
                    const list = [...plan.exercises];
                    if (index < list.length - 1) {
                      [list[index + 1], list[index]] = [
                        list[index],
                        list[index + 1],
                      ];
                      setPlan({ ...plan, exercises: list });
                      setDirty(true);
                    }
                  }}
                >
                  ↓
                </button>
                <button
                  onClick={() => {
                    setPlan({
                      ...plan,
                      exercises: plan.exercises.filter(
                        (x: any) => x.id !== e.id,
                      ),
                    });
                    setDirty(true);
                  }}
                >
                  删除
                </button>
              </div>
              <label className="row">
                记录方式
                <select
                  aria-label="记录方式"
                  value={e.mode || "bilateral"}
                  onChange={(event) => {
                    if (
                      event.target.value === "unilateral" &&
                      e.mode !== "unilateral"
                    )
                      for (const s of e.sets) {
                        s.default_weight_left = s.default_weight;
                        s.default_weight_right = s.default_weight;
                      }
                    e.mode = event.target.value;
                    setPlan({ ...plan });
                    setDirty(true);
                  }}
                >
                  <option value="bilateral">双手 / 双侧同时</option>
                  <option value="unilateral">单手 / 单侧分开</option>
                </select>
              </label>
              <RepTarget
                exercise={e}
                change={() => {
                  setPlan({ ...plan });
                  setDirty(true);
                }}
              />
              {e.sets.map((s: any, i: number) => (
                <div className="row" key={i}>
                  <span>第{i + 1}组默认 kg</span>
                  {(e.mode === "unilateral" ? ["left", "right"] : ["both"]).map(
                    (side) => (
                      <label key={side}>
                        {side === "left"
                          ? "左侧"
                          : side === "right"
                            ? "右侧"
                            : ""}
                        <Numeric
                          value={
                            side === "both"
                              ? s.default_weight
                              : (s[`default_weight_${side}`] ?? null)
                          }
                          placeholder={
                            side === "both"
                              ? "默认重量"
                              : `${side === "left" ? "左" : "右"}侧默认重量`
                          }
                          onChange={(n) => {
                            s[
                              side === "both"
                                ? "default_weight"
                                : `default_weight_${side}`
                            ] = n;
                            setPlan({ ...plan });
                            setDirty(true);
                          }}
                        />
                      </label>
                    ),
                  )}
                  <button
                    disabled={e.sets.length === 1}
                    onClick={() => {
                      e.sets.splice(i, 1);
                      setPlan({ ...plan });
                      setDirty(true);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  e.sets.push({ default_weight: null });
                  setPlan({ ...plan });
                  setDirty(true);
                }}
              >
                ＋ 目标组
              </button>
            </section>
          ))}
          <button
            disabled={busy}
            onClick={() =>
              action(async () => {
                await service.savePlan(plan);
                setDirty(false);
                setMessage("计划已保存");
                await refresh();
              })
            }
          >
            保存计划
          </button>
          <button
            onClick={() => {
              const name = prompt("动作名称（同名会复用已有动作ID）");
              if (name)
                action(async () => {
                  await service.savePlan(plan);
                  await service.addPlanExercise(plan.id, name);
                  setPlan(await service.plan(plan.id));
                  setDirty(false);
                });
            }}
          >
            ＋ 添加动作
          </button>
          <label>
            复制其他日期（替换本日）
            <select
              defaultValue=""
              onChange={(e) => {
                const source = e.target.value;
                if (
                  source &&
                  confirm("用该日计划替换本日计划？历史训练不受影响。")
                )
                  action(async () => {
                    await service.copyPlan(source, plan.id);
                    setPlan(await service.plan(plan.id));
                    setDirty(false);
                    await refresh();
                  });
              }}
            >
              <option value="">选择来源</option>
              {plans
                .filter((p) => p.id !== plan.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    周{weekdays[p.weekday - 1]} {p.name}
                  </option>
                ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <h1>
            {tab === "今日"
              ? new Date().toLocaleDateString("zh-CN", {
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })
              : tab}
          </h1>
          {tab === "今日" ? (
            <>
              <section>
                <small>今日安排</small>
                <select
                  value={selection}
                  onChange={(e) => setSelection(e.target.value)}
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      周{weekdays[p.weekday - 1]} · {p.name}
                    </option>
                  ))}
                </select>
                {selected?.rest && <p>休息日 · 也可以选择其他日计划训练</p>}
                <PlanPreview id={selection} />
                <button
                  disabled={busy}
                  className="primary"
                  onClick={() =>
                    action(async () => {
                      await loadSession(await service.start(selection));
                      await refresh();
                    })
                  }
                >
                  开始训练
                </button>
                <button
                  className="subtle"
                  onClick={() =>
                    action(async () => {
                      setPlan(await service.plan(selection));
                      setDirty(false);
                    })
                  }
                >
                  编辑此计划
                </button>
              </section>
              {active.map((s) => (
                <section key={s.id}>
                  <small>
                    未完成训练 · {new Date(s.started_at).toLocaleString()}
                  </small>
                  <h2>{s.plan_name_snapshot}</h2>
                  <ActivePreview id={s.id} />
                  <button onClick={() => action(() => loadSession(s.id))}>
                    继续训练
                  </button>
                </section>
              ))}
            </>
          ) : tab === "周计划" ? (
            <>
              <p>
                示例动作可编辑；重量按你的实际情况填写。周三、周日为休息日。
              </p>
              <button
                onClick={() =>
                  action(async () => {
                    await service.fillEmptySampleDays();
                    await refresh();
                    setMessage("已补全空白训练日，已有动作保持原样");
                  })
                }
              >
                补全空白日期的示例动作
              </button>
              {plans.map((p) => (
                <section key={p.id}>
                  <small>
                    周{weekdays[p.weekday - 1]} {p.rest ? "· 休息" : ""}
                  </small>
                  <h2>{p.name}</h2>
                  <PlanPreview key={`${p.id}-${p.version}`} id={p.id} />
                  <button
                    onClick={() =>
                      action(async () => {
                        setPlan(await service.plan(p.id));
                        setDirty(false);
                      })
                    }
                  >
                    编辑计划
                  </button>
                </section>
              ))}
            </>
          ) : tab === "历史" ? (
            <>
              <HistoryCalendar
                sessions={history}
                selected={historyDate}
                onSelect={setHistoryDate}
              />
              {!history.length && <p>还没有训练记录</p>}
              {historyDate &&
                !history.some(
                  (s) => localDateKey(s.started_at) === historyDate,
                ) && <p>这一天没有训练记录</p>}
              {history
                .filter(
                  (s) =>
                    !historyDate || localDateKey(s.started_at) === historyDate,
                )
                .map((s) => (
                  <section key={s.id}>
                    <small>
                      {new Date(s.started_at).toLocaleString()} ·{" "}
                      {s.status === "active" ? "未完成" : "已完成"}
                    </small>
                    <h2>{s.plan_name_snapshot}</h2>
                    <button
                      onClick={() => action(() => loadSession(s.id, true))}
                    >
                      查看 / 编辑
                    </button>
                  </section>
                ))}
            </>
          ) : (
            <section>
              <h2>数据管理</h2>
              <button
                onClick={() =>
                  action(async () => {
                    const text = await openFile();
                    if (!text) return;
                    if (
                      !confirm("替换文件中指定日期的计划？历史和当前训练保留。")
                    )
                      return;
                    const count = await service.importPlansJSON(text);
                    await refresh();
                    setMessage(`已导入 ${count} 天计划，训练记录保留`);
                  })
                }
              >
                导入训练计划 JSON
              </button>
              <p>
                {stats?.sessions} 次训练 · {stats?.sets} 个完成组
              </p>
              <p>数据库 v3 · 应用 1.0.0（V1.3）</p>
              <p>
                卸载或清除应用数据会删除数据库。请将JSON备份保存到独立目录。
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await saveFile(
                      `FitLog-${Date.now()}.json`,
                      "application/json",
                      await service.exportJSON(),
                    );
                    setMessage("JSON已写入你选择的位置");
                  })
                }
              >
                导出完整 JSON
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await saveFile(
                      `FitLog-${Date.now()}.csv`,
                      "text/csv",
                      await service.exportCSV(),
                    );
                    setMessage("CSV已写入你选择的位置");
                  })
                }
              >
                导出 CSV
              </button>
              <button
                disabled={busy}
                onClick={() => action(async () => setBackup(await openFile()))}
              >
                选择 JSON 恢复文件
              </button>
              {backup && (
                <div className="error">
                  <p>
                    恢复将完整替换所有现有计划、草稿和历史。请先导出当前JSON。
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (confirm("确认完整替换全部当前数据？"))
                        action(async () => {
                          const result = await service.restore(backup);
                          setBackup(null);
                          await refresh();
                          setMessage(
                            `恢复成功并通过内容校验：${result.plans}个计划，${result.sessions}次训练，${result.sets}组`,
                          );
                        });
                    }}
                  >
                    确认替换恢复
                  </button>
                  <button onClick={() => setBackup(null)}>取消</button>
                </div>
              )}
              {message && <p role="status">{message}</p>}
            </section>
          )}
        </>
      )}
      {ready && plans.length > 0 && (
        <nav>
          {["今日", "周计划", "历史", "设置"].map((x) => (
            <button
              key={x}
              className={x === tab ? "selected" : ""}
              onClick={() => navigate(x)}
            >
              {x}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
function Progress({ session }: { session: any }) {
  const rows = session.exercises
    .filter((e: any) => !e.skipped)
    .flatMap((e: any) => groups(e.sets));
  const done = rows.filter((group: any[]) =>
    group.every((s) => s.completed),
  ).length;
  return (
    <div className="progress">
      <div className="row">
        <span>训练进度</span>
        <strong>
          {done} / {rows.length} 组
        </strong>
      </div>
      <progress value={done} max={rows.length || 1} />
    </div>
  );
}
function PlanPreview({ id }: { id: string }) {
  const [p, setP] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    service.plan(id).then((x) => {
      if (alive) setP(x);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <div>
      {p?.exercises.length ? (
        p.exercises.map((e: any) => (
          <div className="row preview" key={e.id}>
            <span>
              {e.name}
              <small>
                {e.mode === "unilateral" ? "单手 · " : ""}
                {targetLabel(e.target_reps_min, e.target_reps_max)}
              </small>
            </span>
            <b>{e.target_sets}组</b>
          </div>
        ))
      ) : (
        <p>{p?.rest ? "休息恢复 · 无力量训练安排" : "动作待编辑"}</p>
      )}
    </div>
  );
}
function ActivePreview({ id }: { id: string }) {
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    service.session(id).then(setS);
  }, [id]);
  return s ? (
    <>
      <Progress session={s} />
      {s.exercises.map((e: any) => (
        <div className="row preview" key={e.id}>
          <span>{e.exercise_name_snapshot}</span>
          <b>
            {groups(e.sets).filter((g) => g.every((x) => x.completed)).length} /{" "}
            {groups(e.sets).length}组
          </b>
        </div>
      ))}
    </>
  ) : null;
}
createRoot(document.getElementById("root")!).render(<App />);
