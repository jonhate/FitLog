export const version = 2;
export const tables = [
  "exercises",
  "plans",
  "plan_exercises",
  "plan_sets",
  "sessions",
  "session_exercises",
  "session_sets",
] as const;
export const schema = `
CREATE TABLE IF NOT EXISTS exercises(id TEXT PRIMARY KEY,name TEXT NOT NULL,muscle_group TEXT NOT NULL DEFAULT '',equipment TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,name TEXT NOT NULL,weekday INTEGER NOT NULL UNIQUE CHECK(weekday BETWEEN 1 AND 7),version INTEGER NOT NULL DEFAULT 1,rest INTEGER NOT NULL DEFAULT 0 CHECK(rest IN(0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plan_exercises(id TEXT PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,exercise_id TEXT NOT NULL REFERENCES exercises(id),sort_order INTEGER NOT NULL,target_sets INTEGER NOT NULL CHECK(target_sets>0),target_reps_min INTEGER,target_reps_max INTEGER);
CREATE TABLE IF NOT EXISTS plan_sets(id TEXT PRIMARY KEY,plan_exercise_id TEXT NOT NULL REFERENCES plan_exercises(id) ON DELETE CASCADE,set_index INTEGER NOT NULL CHECK(set_index>0),default_weight REAL CHECK(default_weight>=0),UNIQUE(plan_exercise_id,set_index));
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,plan_name_snapshot TEXT NOT NULL,started_at TEXT NOT NULL,completed_at TEXT,status TEXT NOT NULL CHECK(status IN('active','completed')),notes TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS session_exercises(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,exercise_id TEXT NOT NULL REFERENCES exercises(id),exercise_name_snapshot TEXT NOT NULL,sort_order INTEGER NOT NULL,skipped INTEGER NOT NULL DEFAULT 0 CHECK(skipped IN(0,1)));
CREATE TABLE IF NOT EXISTS session_sets(id TEXT PRIMARY KEY,session_exercise_id TEXT NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,set_index INTEGER NOT NULL CHECK(set_index>0),weight REAL CHECK(weight>=0),reps INTEGER CHECK(reps>=0 AND reps=CAST(reps AS INTEGER)),rir INTEGER CHECK(rir>=0 AND rir=CAST(rir AS INTEGER)),completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1)),weight_source TEXT NOT NULL CHECK(weight_source IN('manual','history','previous','plan','empty')),default_weight REAL CHECK(default_weight>=0),updated_at TEXT NOT NULL,CHECK(completed=0 OR (weight IS NOT NULL AND reps>0)),UNIQUE(session_exercise_id,set_index));
CREATE INDEX IF NOT EXISTS idx_sessions_time ON sessions(status,completed_at);
CREATE INDEX IF NOT EXISTS idx_se_exercise ON session_exercises(exercise_id,session_id);
CREATE INDEX IF NOT EXISTS idx_sets_parent ON session_sets(session_exercise_id,set_index);
CREATE INDEX IF NOT EXISTS idx_pe_plan ON plan_exercises(plan_id,sort_order);
PRAGMA user_version=1;`;
