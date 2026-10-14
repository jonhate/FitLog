#!/usr/bin/env python3
"""Apply FitLog V1.3.4 warmup/stretch feature to the V1.3.3 source tree.
Must be used on a clean working copy of jonhate/FitLog. No external deps.
Refuses to overwrite if expected anchors differ. Not a substitute for test/build/signature verification.
"""
from __future__ import annotations
from pathlib import Path
import argparse, sys, difflib

parser=argparse.ArgumentParser()
parser.add_argument('repo',nargs='?',default='.',help='Path to local FitLog source repo')
parser.add_argument('--dry-run',action='store_true')
args=parser.parse_args()
root=Path(args.repo).resolve()
changes={}

def load(path):
    p=root/path
    if not p.exists(): raise RuntimeError(f'File not found: {p}')
    return p.read_text(encoding='utf-8')

def once(s,old,new,path):
    count=s.count(old)
    if count!=1: raise RuntimeError(f'{path}: expected exactly one anchor, got {count}: {old[:115]!r}')
    return s.replace(old,new,1)

def edit(path,fn):
    old=load(path);new=fn(old)
    if new==old: raise RuntimeError(f'No edits produced for {path}')
    changes[path]=(old,new)

DEFAULT_WARMUP={
1:'快走3分钟\n肩关节绕环10次\n弹力带拉开12次\n轻量俯卧撑8次\n卧推递增热身2–3组（不计入正式组）',
2:'快走3分钟\n肩胛控制10次\n弹力带划船12次\n胸椎旋转左右各8次\n首个划船/下拉动作1–2组轻重量热身',
3:'',
4:'轻松步行3分钟\n前后摆腿左右各10次\n臀桥12次\n徒手深蹲10次\n腿部主项递增热身2–3组',
5:'快走3分钟\n肩胛控制10次\n弹力带划船12次\n胸椎旋转左右各8次\n首个划船/下拉动作1–2组轻重量热身',
6:'快走3分钟\n肩关节绕环10次\n弹力带拉开12次\n轻量俯卧撑8次\n卧推递增热身2–3组（不计入正式组）',
7:'',
}
DEFAULT_STRETCH={
1:'门框胸肌拉伸左右各20–30秒\n三头过顶拉伸左右各20–30秒\n肩后侧拉伸左右各20–30秒；按需重复',
2:'凳上背阔肌拉伸20–30秒\n肩后侧拉伸左右各20–30秒\n轻柔胸椎旋转；按需重复',
3:'',
4:'髋屈肌拉伸左右各20–30秒\n股四头肌拉伸左右各20–30秒\n腘绳肌拉伸左右各20–30秒；按需重复',
5:'凳上背阔肌拉伸20–30秒\n肩后侧拉伸左右各20–30秒\n轻柔胸椎旋转；按需重复',
6:'门框胸肌拉伸左右各20–30秒\n三头过顶拉伸左右各20–30秒\n肩后侧拉伸左右各20–30秒；按需重复',
7:'',
}

def jsobj(o):
    return '{\n'+''.join(f'  {k}: {v!r},\n' for k,v in o.items())+'}'

def schema(s):
    p='src/schema.ts'
    s=once(s,'export const version = 3;','export const version = 4;',p)
    add='''export const v4Defaults: Record<string, Record<string, unknown>> = {
  plans: { warmup_enabled: 0, warmup_text: "", stretch_enabled: 0, stretch_text: "" },
  sessions: {
    warmup_enabled: 0, warmup_text: "", warmup_completed: 0,
    stretch_enabled: 0, stretch_text: "", stretch_completed: 0,
  },
};
export const migration4Columns = [
  ["plans", "warmup_enabled", "INTEGER NOT NULL DEFAULT 0 CHECK(warmup_enabled IN(0,1))"],
  ["plans", "warmup_text", "TEXT NOT NULL DEFAULT ''"],
  ["plans", "stretch_enabled", "INTEGER NOT NULL DEFAULT 0 CHECK(stretch_enabled IN(0,1))"],
  ["plans", "stretch_text", "TEXT NOT NULL DEFAULT ''"],
  ["sessions", "warmup_enabled", "INTEGER NOT NULL DEFAULT 0 CHECK(warmup_enabled IN(0,1))"],
  ["sessions", "warmup_text", "TEXT NOT NULL DEFAULT ''"],
  ["sessions", "warmup_completed", "INTEGER NOT NULL DEFAULT 0 CHECK(warmup_completed IN(0,1))"],
  ["sessions", "stretch_enabled", "INTEGER NOT NULL DEFAULT 0 CHECK(stretch_enabled IN(0,1))"],
  ["sessions", "stretch_text", "TEXT NOT NULL DEFAULT ''"],
  ["sessions", "stretch_completed", "INTEGER NOT NULL DEFAULT 0 CHECK(stretch_completed IN(0,1))"],
] as const;
'''
    return once(s,'export const migration3Columns = [',add+'export const migration3Columns = [',p)
edit('src/schema.ts',schema)

def db(s):
    p='src/db.ts'
    s=once(s,'  migration3Columns,','  migration3Columns,\n  migration4Columns,\n  v4Defaults,',p)
    s=once(s,'function missingV3(columns: Record<string, string[]>) {', '''function missingV4(columns: Record<string, string[]>) {
  return Object.entries(v4Defaults).some(([table, fields]) =>
    Object.keys(fields).some((column) => !columns[table].includes(column)),
  );
}
function missingV3(columns: Record<string, string[]>) {''',p)
    s=once(s,'const repair = v > 0 && missingV3(currentLayout!);','const repair = v > 0 && (missingV3(currentLayout!) || missingV4(currentLayout!));',p)
    s=once(s,'    if (missingV3(await layout(db)))', '''    if (v < 4 || missingV4(await layout(db))) {
      for (const [table, column, definition] of migration4Columns) {
        const columns = await db.all(`PRAGMA table_info(${table})`);
        if (!columns.some((c) => c.name === column))
          await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
      }
    }
    if (missingV3(await layout(db)) || missingV4(await layout(db)))''',p)
    return s
edit('src/db.ts',db)

def service(s):
    p='src/service.ts'
    s=once(s,'import { tables, v3Defaults } from "./schema";','import { tables, v3Defaults, v4Defaults } from "./schema";',p)
    s=once(s,'''      seen.add(d.weekday);
      for (const e of d.exercises) {''','''      seen.add(d.weekday);
      for (const field of ["warmup_enabled", "stretch_enabled"])
        if (d[field] !== undefined && typeof d[field] !== "boolean")
          throw Error("辅助训练开关必须为布尔值");
      for (const field of ["warmup_text", "stretch_text"])
        if (d[field] !== undefined &&
          (typeof d[field] !== "string" || d[field].length > 2000))
          throw Error("辅助训练内容无效或过长");
      for (const e of d.exercises) {''',p)
    s=once(s,'''"UPDATE plans SET name=?,rest=?,version=version+1,updated_at=? WHERE id=?",
            [d.name.trim(), d.rest ? 1 : 0, now(), plan.id],''','''"UPDATE plans SET name=?,rest=?,warmup_enabled=?,warmup_text=?,stretch_enabled=?,stretch_text=?,version=version+1,updated_at=? WHERE id=?",
            [d.name.trim(), d.rest ? 1 : 0, d.warmup_enabled ? 1 : 0,
              d.warmup_text ?? "", d.stretch_enabled ? 1 : 0,
              d.stretch_text ?? "", now(), plan.id],''',p)
    s=once(s,'''    if (!p.name.trim()) throw Error("训练名称不能为空");''','''    if (!p.name.trim()) throw Error("训练名称不能为空");
    for (const flag of ["warmup_enabled", "stretch_enabled"])
      if (![0, 1].includes(Number(p[flag]))) throw Error("辅助训练开关无效");
    for (const field of ["warmup_text", "stretch_text"])
      if (typeof p[field] !== "string" || p[field].length > 2000)
        throw Error("辅助训练内容无效或过长");''',p)
    s=once(s,'''"UPDATE plans SET name=?,rest=?,version=version+1,updated_at=? WHERE id=?",
          [p.name, p.rest, now(), p.id],''','''"UPDATE plans SET name=?,rest=?,warmup_enabled=?,warmup_text=?,stretch_enabled=?,stretch_text=?,version=version+1,updated_at=? WHERE id=?",
          [p.name, p.rest, p.warmup_enabled, p.warmup_text,
            p.stretch_enabled, p.stretch_text, now(), p.id],''',p)
    s=once(s,'''"UPDATE plans SET name=?,rest=?,version=version+1,updated_at=? WHERE id=?",
          [p.name, p.rest, now(), target],''','''"UPDATE plans SET name=?,rest=?,warmup_enabled=?,warmup_text=?,stretch_enabled=?,stretch_text=?,version=version+1,updated_at=? WHERE id=?",
          [p.name, p.rest, p.warmup_enabled, p.warmup_text,
            p.stretch_enabled, p.stretch_text, now(), target],''',p)
    s=once(s,'''          status: "active",
          notes: "",
        });''','''          status: "active",
          notes: "",
          warmup_enabled: p.warmup_enabled,
          warmup_text: p.warmup_text,
          warmup_completed: 0,
          stretch_enabled: p.stretch_enabled,
          stretch_text: p.stretch_text,
          stretch_completed: 0,
        });''',p)
    s=once(s,'''  finish(id: string) {
''','''  setAuxCompleted(id: string, kind: "warmup" | "stretch", completed: number) {
    if (![0, 1].includes(completed) || !["warmup", "stretch"].includes(kind))
      throw Error("辅助训练状态无效");
    return this.write(() => this.r.tx(async () => {
      const rows = await this.r.all("SELECT * FROM sessions WHERE id=?", [id]);
      if (!rows.length || rows[0].status !== "active")
        throw Error("只能直接修改进行中训练的完成状态");
      if (!rows[0][`${kind}_enabled`]) throw Error("此辅助训练未启用");
      await this.r.run(`UPDATE sessions SET ${kind}_completed=? WHERE id=?`,
        [completed, id]);
    }));
  }
  finish(id: string) {
''',p)
    s=once(s,'''        await this.r.run("UPDATE sessions SET notes=? WHERE id=?", [
          s.notes,
          s.id,
        ]);''','''        if (![0, 1].includes(s.warmup_completed) ||
            ![0, 1].includes(s.stretch_completed))
          throw Error("辅助训练完成状态无效");
        await this.r.run("UPDATE sessions SET notes=?,warmup_completed=?,stretch_completed=? WHERE id=?", [
          s.notes, s.warmup_completed, s.stretch_completed, s.id,
        ]);''',p)
    s=once(s,'ss.side,se.notes,se.next_reminder_snapshot FROM session_sets', 'ss.side,se.notes,se.next_reminder_snapshot,s.warmup_enabled,s.warmup_completed,s.stretch_enabled,s.stretch_completed FROM session_sets',p)
    s=once(s,'''            "下次提醒",
          ],''','''            "下次提醒",
            "训前热身完成",
            "训后拉伸完成",
          ],''',p)
    s=once(s,'''            r.next_reminder_snapshot,
          ]),''','''            r.next_reminder_snapshot,
            r.warmup_enabled ? (r.warmup_completed ? "是" : "否") : "",
            r.stretch_enabled ? (r.stretch_completed ? "是" : "否") : "",
          ]),''',p)
    s=once(s,'''        ![1, 2, 3].includes(data.schema_version) ||''','''        ![1, 2, 3, 4].includes(data.schema_version) ||''',p)
    s=once(s,'''          if (
            !row ||
            typeof row !== "object" ||''','''          if (data.schema_version < 4 && row && typeof row === "object" && !Array.isArray(row))
            for (const [key, value] of Object.entries(v4Defaults[table] ?? {}))
              if (!(key in row)) row[key] = value;
          if (
            !row ||
            typeof row !== "object" ||''',p)
    s=once(s,'''          for (const k of ["notes", "next_reminder", "next_reminder_snapshot"])''','''          for (const flag of ["warmup_enabled", "warmup_completed", "stretch_enabled", "stretch_completed"])
            if (row[flag] !== undefined && ![0, 1].includes(row[flag]))
              throw Error("辅助训练状态无效");
          for (const field of ["warmup_text", "stretch_text"])
            if (row[field] !== undefined &&
              (typeof row[field] !== "string" || row[field].length > 2000))
              throw Error("辅助训练文字无效");
          for (const k of ["notes", "next_reminder", "next_reminder_snapshot"])''',p)
    return s
edit('src/service.ts',service)

def ui(s):
    p='src/main.tsx'
    warm='''const warmupByDay: Record<number, string> = ''' + jsobj(DEFAULT_WARMUP) + ''';
const stretchByDay: Record<number, string> = ''' + jsobj(DEFAULT_STRETCH) + ''';
'''
    # repr uses single quoted JS string; literals have unicode and escaped newlines: valid JS.
    s=once(s,'const weekdays = ["一", "二", "三", "四", "五", "六", "日"];','const weekdays = ["一", "二", "三", "四", "五", "六", "日"];\n'+warm,p)
    s=once(s,'''  const mutateSession = async (fn: () => Promise<any>) =>''','''  const toggleAux = (kind: "warmup" | "stretch", completed: boolean) => {
    const key = `${kind}_completed`;
    if (historical) {
      setSession((current: any) => ({ ...current, [key]: completed ? 1 : 0 }));
      setDirty(true);
      return;
    }
    void action(async () => {
      await service.setAuxCompleted(session.id, kind, completed ? 1 : 0);
      await loadSession(session.id);
      setMessage("已保存");
    });
  };
  const mutateSession = async (fn: () => Promise<any>) =>''',p)
    aux_warm='''          {!!session.warmup_enabled && (
            <section className="aux-panel">
              <details open>
                <summary>训前热身</summary>
                <p className="aux-hint">正式训练前完成，动作不计入正式组数</p>
                <div className="aux-text">{session.warmup_text}</div>
                <label className="aux-check">
                  <input type="checkbox" aria-label="已完成热身"
                    checked={!!session.warmup_completed}
                    onChange={(e) => toggleAux("warmup", e.target.checked)} />
                  已完成热身
                </label>
              </details>
            </section>
          )}
'''
    aux_stretch='''          {!!session.stretch_enabled && (
            <section className="aux-panel">
              <details open>
                <summary>训后拉伸</summary>
                <p className="aux-hint">放松与活动度练习，不计入力量训练进度</p>
                <div className="aux-text">{session.stretch_text}</div>
                <label className="aux-check">
                  <input type="checkbox" aria-label="已完成拉伸"
                    checked={!!session.stretch_completed}
                    onChange={(e) => toggleAux("stretch", e.target.checked)} />
                  已完成拉伸
                </label>
              </details>
            </section>
          )}
'''
    s=once(s,'''          <Progress session={session} />
          {session.exercises.map''','''          <Progress session={session} />
'''+aux_warm+'''          {session.exercises.map''',p)
    s=once(s,'''          {historical ? (
            <section>
              <label>
                训练备注''',aux_stretch+'''          {historical ? (
            <section>
              <label>
                训练备注''',p)
    plan_aux='''          {([
            { kind: "warmup", title: "训前热身", list: warmupByDay },
            { kind: "stretch", title: "训后拉伸", list: stretchByDay },
          ] as const).map(({ kind, title, list }) => {
            const enabledKey = `${kind}_enabled`;
            const textKey = `${kind}_text`;
            const enabled = !!plan[enabledKey];
            return (
              <div key={kind} className="aux-editor">
                <label className="row rest-switch">
                  <input role="switch" aria-label={title} type="checkbox"
                    checked={enabled}
                    onChange={(event) => {
                      setPlan({ ...plan,
                        [enabledKey]: event.target.checked ? 1 : 0,
                        [textKey]: event.target.checked && !plan[textKey]
                          ? list[plan.weekday] : plan[textKey],
                      });
                      setDirty(true);
                    }} />
                  <span>{title}<small>{kind === "warmup" ? "力量训练开始前" : "所有正式训练动作之后"}</small></span>
                </label>
                {enabled && <details className="aux-editor-content" open>
                  <summary>{title}内容（点击展开 / 收起）</summary>
                  <textarea aria-label={`${title}动作清单`} rows={5}
                    value={plan[textKey] || ""}
                    maxLength={2000}
                    onChange={(event) => {
                      setPlan({ ...plan, [textKey]: event.target.value });
                      setDirty(true);
                    }} />
                  <small>每行一个动作或提示；训练时只需在末尾勾选一次完成。</small>
                </details>}
              </div>
            );
          })}
'''
    s=once(s,'''          <label className="row rest-switch">
            <input
              role="switch"
              aria-label="设为休息日"''',plan_aux+'''          <label className="row rest-switch">
            <input
              role="switch"
              aria-label="设为休息日"''',p)
    s=once(s,'FitLog<span>V1.3.3</span>','FitLog<span>V1.3.4</span>',p)
    s=once(s,'数据库 v3 · 应用 1.0.0（V1.3.3）','数据库 v4 · 应用 1.0.0（V1.3.4）',p)
    return s
edit('src/main.tsx',ui)

def css(s):
    return s+'''
/* V1.3.4 optional warmup and stretch modules */
.aux-panel summary, .aux-editor-content summary {
  cursor: pointer; font-weight: 650; padding: 6px 0; color: #eef1f6;
}
.aux-panel .aux-text {
  white-space: pre-wrap; overflow-wrap: anywhere; color: #d5ddea;
  line-height: 1.75; padding: 10px 0;
}
.aux-check { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.aux-check input { width: 24px; min-height: 24px; flex: 0 0 24px; }
.aux-editor-content { padding: 8px 12px 14px; background: #1c2028; border-radius: 12px; margin: 4px 0 10px; }
.aux-editor-content textarea { margin-top: 10px; min-height: 110px; }
.aux-hint { margin: 4px 0 0; }
'''
edit('src/style.css',css)

# Keep existing test suite up to date with version bump, add new integration tests.
def tests(s):
    p='tests/fitlog.test.ts'
    s=once(s,'toBe(3);\n    expect((await rows(id))[0].completed)', 'toBe(4);\n    expect((await rows(id))[0].completed)',p)
    s=once(s,'sqlite.pragma("user_version=4");','sqlite.pragma("user_version=5");',p)
    s=once(s,'expect(old.pragma("user_version", { simple: true })).toBe(3);',
      'expect(old.pragma("user_version", { simple: true })).toBe(4);',p)
    s=once(s,'import { schema, v3Defaults, tables } from "../src/schema";',
      'import { schema, v3Defaults, v4Defaults, tables } from "../src/schema";',p)
    # Emulated V1/V2 databases cannot contain new columns.
    s=once(s,'for (const key of Object.keys(v3Defaults[t] ?? {})) delete copy[key];',
      'for (const key of Object.keys(v3Defaults[t] ?? {})) delete copy[key];\n        for (const key of Object.keys(v4Defaults[t] ?? {})) delete copy[key];',p)
    s=once(s,'for (const key of Object.keys(v3Defaults[table] ?? {})) delete copy[key];',
      'for (const key of Object.keys(v3Defaults[table] ?? {})) delete copy[key];\n      for (const key of Object.keys(v4Defaults[table] ?? {})) delete copy[key];',p)
    s=once(s,'for (const key of Object.keys(v3Defaults[t] ?? {})) delete row[key];',
      'for (const key of Object.keys(v3Defaults[t] ?? {})) delete row[key];\n        for (const key of Object.keys(v4Defaults[t] ?? {})) delete row[key];',p)
    s+='''

describe("V4 warmup/stretch workflow", () => {
  it("saves plan options and session snapshots independent of later plan edits", async () => {
    const p = await prep([30]);
    const plan = await svc.plan(p);
    plan.warmup_enabled = 1;
    plan.warmup_text = "快走3分钟\\n卧推热身";
    plan.stretch_enabled = 1;
    plan.stretch_text = "胸肌拉伸30秒";
    await svc.savePlan(plan);
    const id = await svc.start(p);
    const first = await svc.session(id);
    expect(first.warmup_text).toBe("快走3分钟\\n卧推热身");
    expect(first.warmup_completed).toBe(0);
    plan.warmup_text = "修改后的计划";
    await svc.savePlan(plan);
    expect((await svc.session(id)).warmup_text).toBe(first.warmup_text);
    await svc.setAuxCompleted(id, "warmup", 1);
    expect((await svc.session(id)).warmup_completed).toBe(1);
    await svc.setAuxCompleted(id, "warmup", 0);
    expect((await svc.session(id)).warmup_completed).toBe(0);
    await complete(id, [30]); // No need to tick aux modules to finish.
    expect((await svc.session(id)).status).toBe("completed");
  });

  it("legacy V3 backup restores with disabled auxiliary options", async () => {
    const id = await monday();
    const backup = JSON.parse(await svc.exportJSON());
    backup.schema_version = 3;
    for (const row of backup.plans)
      for (const key of ["warmup_enabled", "warmup_text", "stretch_enabled", "stretch_text"])
        delete row[key];
    for (const row of backup.sessions)
      for (const key of ["warmup_enabled", "warmup_text", "warmup_completed", "stretch_enabled", "stretch_text", "stretch_completed"])
        delete row[key];
    await svc.restore(JSON.stringify(backup));
    const plan = await svc.plan(id);
    expect(plan.warmup_enabled).toBe(0);
    expect(plan.stretch_enabled).toBe(0);
  });

  it("copies both configurations between weekday plans", async () => {
    const p = await monday();
    const plan = await svc.plan(p);
    plan.warmup_enabled = 1;
    plan.warmup_text = "动态热身";
    plan.stretch_enabled = 1;
    plan.stretch_text = "静态拉伸";
    await svc.savePlan(plan);
    const target = (await svc.r.all("SELECT id FROM plans WHERE weekday=2"))[0].id;
    await svc.copyPlan(p, target);
    const cloned = await svc.plan(target);
    expect(cloned.warmup_text).toBe("动态热身");
    expect(cloned.stretch_text).toBe("静态拉伸");
    expect(cloned.warmup_enabled).toBe(1);
  });
});
'''
    return s
edit('tests/fitlog.test.ts',tests)

def readme(s):
    return s+'''\n\n## V1.3.4 热身与拉伸模块\n\n每日编辑中可选择是否启用训前热身与训后拉伸，支持独立展开编辑文字清单。\n开始训练时会生成计划快照，两块模块分别在力量动作前后展示；只记录模块完成勾选，不计入力量训练组数。\n已开始训练不受以后计划修改影响；历史完成状态须通过“保存历史修改”提交。\n数据库升级至 v4，并可恢复 v1/v2/v3/v4 完整备份。\n**签名提醒**：没有与旧 APK 相同的签名不能覆盖安装保留数据库；请先备份 JSON，不要先卸载旧版。\n'''
edit('README.md',readme)

# Atomic-ish: verify every anchor before modifying any file.
if args.dry_run:
    for path,(old,new) in changes.items():
        print(f'{path}: {len(old)} → {len(new)} characters')
else:
    for path,(old,new) in changes.items():
        (root/path).write_text(new,encoding='utf-8')
        print(f'UPDATED {path}')
    print('Patch applied. MUST run npm ci, npm test, npm run build, npm run test:ui and Android build before release.')
