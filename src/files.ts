import { registerPlugin, Capacitor } from "@capacitor/core";
const Files = registerPlugin<{
  save(o: {
    name: string;
    mime: string;
    text: string;
  }): Promise<{ saved: boolean }>;
  open(): Promise<{ text: string }>;
}>("FitLogFiles");
export async function saveFile(name: string, mime: string, text: string) {
  if (!Capacitor.isNativePlatform()) throw Error("文件导出需Android应用");
  const r = await Files.save({ name, mime, text });
  if (!r.saved) throw Error("已取消保存");
}
export async function openFile() {
  return (await Files.open()).text;
}
