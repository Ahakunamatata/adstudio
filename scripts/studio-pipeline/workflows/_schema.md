# workflow.json schema 速查

每个 workflow 文件描述**一个 batch**（典型 = 一个母模板的全部变体）。

## 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `batch_id` | string | ✓ | 唯一 ID，用作 `runs/{batch_id}/` 目录名 |
| `description` | string | | 人类备注 |
| `template_id` | string | | 母模板 ID（commit 时决定 public/assets/templates/ 下哪个子目录） |
| `tasks` | TaskInput[] | ✓ | 任务列表 |

## TaskInput 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✓ | 任务 ID。变体级，如 `M2-v2a` |
| `step` | `"keyframe"` \| `"motion"` | ✓ | 同一变体的两阶段。**`id:step` 共同组成唯一 key** |
| `stage` | `"t2i"` \| `"i2v"` \| `"t2v"` | ✓ | 生成阶段 |
| `model` | string | ✓ | `gpt-image-2-manual` / `seedance-2.0` / `seedance-2.0-fast` / `seedance-2.0-fal` |
| `prompt` | string | ✓ | prompt 文本，可含 `{{slot}}` 占位 |
| `slots` | `Record<string,string>` | | 槽位变量；运行时替换 `{{name}}` |
| `depends_on` | string[] | | 依赖的 task key（格式 `id:step`） |
| `keyframe` | string | | i2v 的参考图。**有 `depends_on` 时自动从上游拿，否则需填 http URL** |
| `params.aspect` | `"9:16"` 等 | | 默认 `9:16` |
| `params.duration_seconds` | number | | 默认 `10`，范围 4-15 |
| `params.resolution` | `"720p"` \| `"1080p"` \| `"2k"` | | 默认 `1080p` |
| `params.n_candidates` | number | | 默认 `4`。一次跑几条候选供后续挑选 |
| `notes` | string | | 人类备注 |

## 槽位（绿色变量）用法

prompt 里写 `{{name}}`，`slots` 里填值：

```json
{
  "prompt": "...reads \"{{brand}}\" in serif caps...",
  "slots": { "brand": "AURELIA" }
}
```

未填的 slot 在运行时会**报错**，避免 prompt 残留占位字符。

## 常见错误

- **没填 slot** → `prompt 还有未填的 slot: brand`
- **i2v 没 keyframe** → 要么加 `depends_on: ["M2-v2a:keyframe"]`，要么 `keyframe: "https://..."`
- **provider 没配 API key** → `ARK_API_KEY 未配置` 或 `FAL_KEY 未配置`
