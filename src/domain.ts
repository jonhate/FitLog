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
  let previous: number | null = null;
  return rows.map((r) => {
    let s = { ...r };
    if (!s.completed && !["manual", "history"].includes(s.weight_source)) {
      Object.assign(s, initialWeight(null, previous, s.default_weight));
    }
    previous = s.weight;
    return s;
  });
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
