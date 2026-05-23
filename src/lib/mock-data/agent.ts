import type { AgentMode, AgentSpecs, AgentStep } from "@/lib/domain/schemas";

export const wizardOrders: Record<AgentMode, AgentStep[]> = {
  clone: ["product", "competitor", "focus", "specs", "confirm"],
  create: ["product", "creative", "specs", "confirm"]
};

export const agentBoundaryLabels: Record<AgentStep, string> = {
  product: "产品包确认",
  competitor: "竞品素材",
  focus: "解析重点",
  creative: "创意目标",
  specs: "输出规格",
  confirm: "任务边界"
};

export const defaultAgentSpecs: AgentSpecs = {
  language: "泰国 / 泰语",
  channel: "TikTok",
  ratio: "9:16",
  duration: "15s"
};

export const defaultCreativeGoal =
  "我想做一条 TikTok 竖版广告，突出 Family Locator 解决父母担心孩子放学安全的问题，希望开头足够抓人。";

export const focusOptions = [
  ["Hook", "前 3 秒怎么抓人"],
  ["脚本逻辑", "段落、转折和卖点植入"],
  ["剧情共鸣", "用户为什么代入"],
  ["画面构图", "镜头和视觉重心"],
  ["节奏", "剪辑速度和信息密度"],
  ["CTA", "最后如何促成行动"]
] as const;

export const specOptions = {
  language: ["泰国 / 泰语", "美国 / 英语", "日本 / 日语"],
  channel: ["TikTok", "Meta Reels", "YouTube Shorts"],
  ratio: ["9:16", "1:1", "16:9"],
  duration: ["15s", "30s", "60s"]
};

export const wizardCopy: Record<AgentStep, { title: string; copy: string }> = {
  product: {
    title: "选择你的产品",
    copy: "Agent 会基于产品包理解你的卖点、用户和痛点，后面生成时不能偏离这个上下文。"
  },
  competitor: {
    title: "上传竞品素材",
    copy: "这一步确定 Agent 要拆解的广告对象。素材会进入画布，成为后续解析和复刻的输入节点。"
  },
  focus: {
    title: "选择解析重点",
    copy: "告诉 Agent 你最关心 Hook、脚本、共鸣、画面还是 CTA，避免泛泛拆解。"
  },
  creative: {
    title: "输入创作目标",
    copy: "不用一次写完整脚本，只要说明广告目标，Agent 会先给多个创意方向让你选择。"
  },
  specs: {
    title: "设置输出规格",
    copy: "语言、渠道、比例和时长会影响脚本密度、字幕表达、画面构图和模型参数。"
  },
  confirm: {
    title: "确认任务边界",
    copy: "确认后进入工作台。左侧对话继续锁定决策，右侧画布沉淀节点和结果。"
  }
};

export const launcherCopy = {
  agent: {
    clone: {
      kicker: "Agent + Canvas",
      title: "从竞品素材到可投放广告视频",
      placeholder: "请上传你要复刻的竞品广告素材，并说明你想复刻的内容、重点和需要避开的地方。",
      cta: "创建复刻任务",
      pill: "深度工作流"
    },
    create: {
      kicker: "Agent + Canvas",
      title: "从产品包推导一条新广告",
      placeholder: "请描述你想创作的新广告：目标市场、用户痛点、渠道、风格，或者你已经想到的创意方向。",
      cta: "创建生成任务",
      pill: "深度工作流"
    }
  },
  video: {
    kicker: "Ad Video",
    title: "快速生成广告视频",
    placeholder: "描述你想生成的广告视频，也可以上传参考图、产品图或短视频片段。",
    cta: "生成视频",
    pill: "快速工具"
  },
  image: {
    kicker: "Ad Image",
    title: "快速生成广告图片",
    placeholder: "描述你想生成的广告图片，说明产品、画面主体、文案区域、比例和风格。",
    cta: "生成图片",
    pill: "快速工具"
  }
};
