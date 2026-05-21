# Studio Pipeline

Ad Studio 素材生成流水线。把"22 条变体散落对话里跑"这件事固化成可断点续跑的 CLI。

**Provider：fal.ai**（默认）· 用官方 `@fal-ai/client` SDK。

## 能做什么

- **`run`** 一个 batch，按 workflow.json 的依赖图自动跑：
  - **t2i 半自动**：CLI 打印 prompt → 你在 ChatGPT GPT Image 2.0 生成 → 把图丢到指定路径 → 回车 → pipeline 自动上传到 fal storage
  - **i2v 全自动**：调 fal.ai Seedance 2.0 image-to-video，N 条候选并行跑，自动下载
- **`status`** 看任何一个 batch 的进度
- **`review`** 从 N 条候选里挑出最好的那条
- **`commit`** 把 chosen 候选拷贝到 `public/assets/templates/{母模板}/videos/{变体}.mp4`，告诉你下一步在哪儿改 mock-data
- **`list`** 列出所有 batch

## 5 分钟跑通一条 M2-v2a

```bash
cd adstudio_proto/adstudio/scripts/studio-pipeline
npm install
cp .env.example .env
# 编辑 .env，填入 FAL_KEY=fal_xxxxxx
# 获取 key：https://fal.ai/dashboard/keys

# 只跑 v2a（keyframe + motion 2 个 task）
npm run studio -- run workflows/M2-full.json --only=M2-v2a

#   ↓ CLI 打印 v2a keyframe 的 prompt
#   ↓ 你复制到 ChatGPT GPT Image 2.0 生成（4:5）
#   ↓ 下载图，重命名 keyframe.png，放到 CLI 提示的路径
#   ↓ 回车
#   ↓ pipeline 自动调 fal.storage.upload → 拿 https://v3.fal.media/... URL
#   ↓ 并行提交 4 条 Seedance 2.0 image-to-video 任务
#   ↓ fal SDK 自动轮询 + 完成后下载 → c1-c4.mp4

# 看进度
npm run studio -- status M2-full-2026-05-21

# 挑选最好的候选
npm run studio -- review M2-full-2026-05-21 M2-v2a:motion        # 列出 4 个文件路径
npm run studio -- review M2-full-2026-05-21 M2-v2a:motion 2      # 选 c2

# 入库（拷贝到 public/assets/templates/M2-ecom-tvc/videos/v2a.mp4）
npm run studio -- commit M2-full-2026-05-21 M2-v2a:motion

# CLI 会告诉你下一步：改 src/lib/mock-data/templates.ts
```

## 跑整个 batch（M2 全部 3 变体）

```bash
npm run studio -- run workflows/M2-full.json
```

会按拓扑序：
1. 你跑 v2a keyframe（手工 ChatGPT）→ 自动上传 fal
2. 并发跑 v2a motion（4 候选）**+** v2c motion（4 候选，复用 v2a keyframe）
3. 你跑 v2b keyframe → 自动上传
4. 跑 v2b motion（4 候选）

中途 Ctrl+C → 下次 `studio run` 同 workflow 自动 resume，已 `succeeded` 的 task 跳过。

## Seedance 2.0 (fal) 的参数限制

| 参数 | 可选值 | workflow 默认 |
|---|---|---|
| `resolution` | `"480p"` / `"720p"`（**没有 1080p**） | `720p` |
| `duration` | `"auto"` 或 `"4"`-`"15"` | `10` |
| `aspect_ratio` | `auto` / `21:9` / `16:9` / `4:3` / `1:1` / `3:4` / `9:16` | `9:16` |
| `generate_audio` | bool | **false**（TVC 默认关声） |

定价（截至 2026-05）：720p **$0.30 / 秒**，10 秒 ≈ $3。M2 三变体各 4 候选 = 12 条 ≈ $36。

## 公网图片托管

fal SDK 自带 storage：默认 `--upload=fal_storage`，自动调 `fal.storage.upload` 拿 `https://v3.fal.media/...` URL。**你不用搞图床**。

其他策略（基本用不到）：
- `--upload=public_dir`：拷贝到 `adstudio/public/assets/...`，需要 `PUBLIC_BASE_URL`
- `--upload=manual_url`：让你手粘图床 URL（兜底）

## 切换 provider

默认 fal.ai。如果要切回火山方舟（需要企业认证）：

```bash
# .env 改
VIDEO_PROVIDER=ark
ARK_API_KEY=xxx
```

⚠ 当前版本 ark adapter 尚未在新代码路径接入（`seedance-ark.ts.bak`），会报错。需要切 ark 时告诉我，我接一下。

## 状态文件结构

```
runs/M2-full-2026-05-21/
├── state.json                    # 整个 batch 的状态机
├── M2-v2a/
│   ├── keyframe.png              # 你跑的 GPT Image 图
│   └── candidates/
│       ├── c1.mp4
│       ├── c2.mp4
│       ├── c3.mp4
│       └── c4.mp4
├── M2-v2b/...
└── M2-v2c/...
```

`state.json` 是单一可信源。删掉 `runs/{batch_id}/` 就是从头跑。

## 跟主仓库的关系

放在 `adstudio_proto/adstudio/scripts/studio-pipeline/`，独立 mini package：

- 自己的 `package.json` / `node_modules`，不污染主项目依赖
- `commit` 命令写 `../../public/assets/...`，跟主项目静态资源目录对接
- `runs/` 被 `.gitignore`

## TS / Node 版本

- Node ≥ 18（用了 native fetch、native Blob）
- TypeScript 5.x
- `tsx` 直接跑，不需要 build

## 后续期二（不在本次范围）

- Next.js Web 调度台
- DGX Spark 部署 Qwen2.5-VL 自动给 candidates 打分
- 接 Ark adapter 到新代码路径

期一稳定跑通再做期二。
