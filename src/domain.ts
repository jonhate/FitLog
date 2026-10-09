export type SetRow = {
  id: string;
  set_index: number;
  weight: number | null;
  reps: number | null;
  rir: number | null;
  completed: number;
  weight_source: string;
  default_weight: number | null;
  [key: string]: any;
};
export function initialWeight(
  history: number | null | undefined,
  previous: number | null | undefined,
  preset: number | null | undefined,
) {
  if (history != null) return { weight: history, weight_source: "history" };
  if (previous != null) return { weight: previous, weight_source: "previous" };
  if (preset != null) return { weight: preset, weight_source: "plan" };
  return { weight: null, weight_source: "empty" };
}
export function propagate(rows: SetRow[]) {
  const previous: Record<string, number | null> = {};
  return rows.map((r) => {
    const s = { ...r },
      side = s.side ?? "both";
    if (!s.completed && !["manual", "history"].includes(s.weight_source))
      Object.assign(s, initialWeight(null, previous[side], s.default_weight));
    previous[side] = s.weight;
    return s;
  });
}
export function groups(rows: SetRow[]) {
  const result = new Map<number, SetRow[]>();
  for (const row of rows)
    result.set(row.set_index, [...(result.get(row.set_index) ?? []), row]);
  return [...result.values()];
}
export function targetLabel(min: number | null, max: number | null) {
  if (min == null && max == null) return "";
  if (min != null && max === min) return `目标 ${min} 次`;
  if (min == null) return `目标最多 ${max} 次`;
  if (max == null) return `目标至少 ${min} 次`;
  return `目标 ${min}–${max} 次`;
}

export function valid(s: SetRow) {
  return (
    s.weight != null &&
    Number.isFinite(s.weight) &&
    s.weight >= 0 &&
    s.reps != null &&
    Number.isInteger(s.reps) &&
    s.reps > 0 &&
    (s.rir == null || (Number.isInteger(s.rir) && s.rir >= 0))
  );
}
export function numberInput(value: string, integer = false) {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n)))
    throw Error("请输入非负" + (integer ? "整数" : "数字"));
  return n;
}
