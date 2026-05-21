// ============================================================
// 槽位渲染：把 prompt 里的 {{slot_name}} 替换成具体值
// ============================================================
// 这跟 Ad Studio 站内 UI 的「绿色高亮可编辑变量」是同一个机制。
// 在 workflow.json 里：
//   prompt: "A bottle reading {{brand}} with light from {{direction}}"
//   slots:  { brand: "AURELIA", direction: "upper-left" }
// 渲染后：
//   "A bottle reading AURELIA with light from upper-left"

export function renderPrompt(
  template: string,
  slots: Record<string, string> | undefined
): string {
  if (!slots) return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k) => {
    if (k in slots) return slots[k]!;
    // 未填的槽位保留原样，调用方决定是否报错
    return m;
  });
}

/** 检查 prompt 里还有没有未填的槽位 */
export function findUnfilledSlots(rendered: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rendered))) out.push(m[1]!);
  return out;
}
