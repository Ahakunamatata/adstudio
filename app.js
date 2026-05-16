const pageTitles = {
  home: "Ad Studio",
  agent: "Agent",
  "agent-setup": "创建任务",
  workbench: "Agent Workbench",
  video: "Ad Video",
  image: "Ad Image",
  templates: "Templates",
  assets: "Products / Assets",
};

let setupMode = "clone";
let wizardIndex = 0;
let selectedProduct = "Family Locator";
let competitorUploaded = false;
let launcherMode = "agent";
let launcherAgentMode = "clone";
let agentPageMode = "clone";
let templateScrollFrame = null;
let agentSession = null;

const wizardOrders = {
  clone: ["product", "competitor", "focus", "specs", "confirm"],
  create: ["product", "creative", "specs", "confirm"],
};

const agentBoundaryLabels = {
  product: "产品包确认",
  competitor: "竞品素材",
  focus: "解析重点",
  creative: "创意目标",
  specs: "输出规格",
  confirm: "任务边界",
};

const defaultAgentSpecs = {
  language: "泰国 / 泰语",
  channel: "TikTok",
  ratio: "9:16",
  duration: "15s",
};

const wizardCopy = {
  product: {
    title: "选择你的产品",
    copy: "Agent 会基于产品包理解你的卖点、用户和痛点，后面生成时不能偏离这个上下文。",
  },
  competitor: {
    title: "上传竞品素材",
    copy: "这一步确定 Agent 要拆解的广告对象。素材会进入画布，成为后续解析和复刻的输入节点。",
  },
  focus: {
    title: "选择解析重点",
    copy: "告诉 Agent 你最关心 Hook、脚本、共鸣、画面还是 CTA，避免泛泛拆解。",
  },
  creative: {
    title: "输入创作目标",
    copy: "不用一次写完整脚本，只要说明广告目标，Agent 会先给多个创意方向让你选择。",
  },
  specs: {
    title: "设置输出规格",
    copy: "语言、渠道、比例和时长会影响脚本密度、字幕表达、画面构图和模型参数。",
  },
  confirm: {
    title: "确认任务边界",
    copy: "确认后进入工作台。左侧对话继续锁定决策，右侧画布沉淀节点和结果。",
  },
};

const launcherCopy = {
  agent: {
    clone: {
      kicker: "Agent + Canvas",
      title: "从竞品素材到可投放广告视频",
      copy: "上传竞品素材，锁定产品包和复刻重点，再进入左侧 Agent 对话与右侧画布工作台。",
      placeholder: "请上传你要复刻的竞品广告素材，并说明你想复刻的内容、重点和需要避开的地方。",
      cta: "创建复刻任务",
      pill: "深度工作流",
    },
    create: {
      kicker: "Agent + Canvas",
      title: "从产品包推导一条新广告",
      copy: "输入产品和创作目标，Agent 会先给多个广告方向，再推进脚本、锚点、分镜和视频。",
      placeholder: "请描述你想创作的新广告：目标市场、用户痛点、渠道、风格，或者你已经想到的创意方向。",
      cta: "创建生成任务",
      pill: "深度工作流",
    },
  },
  video: {
    kicker: "Ad Video",
    title: "快速生成广告视频",
    copy: "适合直接生视频、套模板、数字人口播或商品演示，不强制进入 Agent 工作台。",
    placeholder: "描述你想生成的广告视频，也可以上传参考图、产品图或短视频片段。",
    cta: "打开 Ad Video 表单",
    pill: "快速工具",
  },
  image: {
    kicker: "Ad Image",
    title: "快速生成广告图片",
    copy: "适合生成广告主图、App 素材、商品展示图或社媒投放图。",
    placeholder: "描述你想生成的广告图片，说明产品、画面主体、文案区域、比例和风格。",
    cta: "打开 Ad Image 表单",
    pill: "快速工具",
  },
};

const templates = {
  "tiktok-app": {
    route: "video",
    toast: "已套用 TikTok App 危机 Hook 模板",
    label: "APP ALERT VIDEO",
    prompt:
      "15s vertical TikTok app ad. Open with a tense hook: a parent checks why the child has not arrived home. Show a realistic phone alert, anxious expression, then relief after Family Locator confirms the location. Thai language, bold subtitles, cinematic handheld shots, clear CTA.",
  },
  "ugc-product": {
    route: "video",
    toast: "已套用商品演示 UGC 模板",
    label: "UGC PRODUCT DEMO",
    prompt:
      "one-take user-generated product demo in a bright home environment. Start with a surprising hook, show the product solving a concrete daily pain point, include natural hand movement, warm light, mobile-first vertical framing, end with a short CTA.",
  },
  avatar: {
    route: "video",
    toast: "已套用数字人口播模板",
    label: "AI AVATAR EXPLAINER",
    prompt:
      "AI avatar talking-head ad for an app. Confident spokesperson, direct opening hook, three short benefit points, on-screen captions, clean studio background, localized language, vertical 9:16, clear app CTA at the end.",
  },
  "image-demo": {
    route: "image",
    toast: "已套用电商产品主图模板",
    prompt:
      "high-converting ecommerce ad image, premium product packshot, strong offer badge, clean background, benefit-driven layout, space reserved for headline and CTA, 4:5 mobile ad composition.",
  },
  "youtube-review": {
    route: "video",
    toast: "已套用 YouTube 评测对比模板",
    label: "REVIEW COMPARISON",
    prompt:
      "YouTube Shorts review comparison ad. Split-screen setup, compare old way versus new way, fast cuts, creator-style commentary, credible visual proof, strong final recommendation and CTA.",
  },
  gameplay: {
    route: "video",
    toast: "已套用游戏试玩 Hook 模板",
    label: "GAMEPLAY HOOK",
    prompt:
      "vertical mobile game ad with immediate gameplay hook, clear challenge, fast progression, satisfying win moment, expressive captions, punchy sound cue moments, strong install CTA.",
  },
};

const nodes = {
  "product-pack": {
    type: "Product Pack",
    title: "产品资料包",
    status: "locked",
    model: "Product Parser",
    time: "12s",
    cost: "2 credits",
    input: "产品 URL：Family Locator App 页面。",
    output: "产品名、Logo/Icon、App UI、核心卖点、用户画像和痛点。",
  },
  "app-ui": {
    type: "Image",
    title: "App UI 与 Icon",
    status: "completed / locked",
    model: "GPT Image",
    time: "18s",
    cost: "8 credits",
    input: "产品资料包中的 App 名称、Logo、UI 描述和泰语本地化参数。",
    output: "后续 C4 CTA 镜头和 App 演示镜头的品牌锚点。",
  },
  "competitor-video": {
    type: "Video",
    title: "竞品视频",
    status: "uploaded",
    model: "User Asset",
    time: "0s",
    cost: "0 credits",
    input: "用户上传的竞品广告视频。",
    output: "用于多模态解析、节奏拆解和复刻方案映射。",
  },
  analysis: {
    type: "Script",
    title: "竞品客观拆解",
    status: "completed",
    model: "Gemini Multimodal",
    time: "21s",
    cost: "6 credits",
    input: "竞品视频 + 用户关注重点：Hook、脚本逻辑、CTA。",
    output: "Hook、情绪曲线、剧情结构、镜头节奏和 CTA 机制。",
  },
  "clone-plan": {
    type: "Plan",
    title: "迁移复刻方案 A",
    status: "waiting_user",
    model: "Ad Strategy Agent",
    time: "9s",
    cost: "3 credits",
    input: "产品包 + 竞品客观拆解 + 二次检查结果。",
    output: "把竞品的紧张开场和反转结构迁移到 Family Locator 的家庭安全场景。",
  },
  character: {
    type: "Image",
    title: "泰国母亲人物参考",
    status: "completed / locked",
    model: "GPT Image",
    time: "18s",
    cost: "8 credits",
    input: "脚本人物设定：40 岁左右泰国母亲，担忧但克制。",
    output: "所有有人物分镜图和图生视频的参考输入。",
  },
  scene: {
    type: "Image",
    title: "曼谷街景场景",
    status: "completed",
    model: "GPT Image",
    time: "16s",
    cost: "8 credits",
    input: "泰国市场、本地街景、夜晚通勤氛围。",
    output: "用于 C1/C2 场景镜头和背景一致性。",
  },
  "shot-prompt": {
    type: "Prompt",
    title: "C1 分镜 Prompt",
    status: "checked",
    model: "Prompt Guard",
    time: "2s",
    cost: "1 credit",
    input: "分镜脚本 + 锁定人物 + 锁定场景。",
    output: "单镜头自洽 prompt，不含“上一镜头”“继续”等上下文依赖词。",
  },
  storyboard: {
    type: "Image",
    title: "C1 分镜图",
    status: "completed",
    model: "GPT Image",
    time: "12s",
    cost: "5 credits",
    input: "C1 prompt + 人物参考 + 曼谷街景参考。",
    output: "进入视频模型前的视觉确认图。",
  },
  "final-video": {
    type: "Video",
    title: "最终广告视频",
    status: "pending",
    model: "Seedance 2.0",
    time: "占位",
    cost: "占位",
    input: "分镜图、单镜头 prompt、字幕和 App UI 锚点。",
    output: "15s 9:16 可预览广告视频。",
  },
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getAgentOrder(mode = setupMode) {
  return wizardOrders[mode === "create" ? "create" : "clone"];
}

function getLauncherPrompt(source) {
  const inputId = source === "agent-page" ? "agent-page-prompt" : "launcher-prompt";
  return document.getElementById(inputId)?.value.trim() || "";
}

function getCreativeSeed(promptText) {
  const existing = document.getElementById("creative-goal")?.value.trim();
  if (promptText) return promptText;
  return existing || "我想做一条 TikTok 竖版广告，突出 Family Locator 解决父母担心孩子放学安全的问题，希望开头足够抓人。";
}

function createAgentSession(mode, promptText = "") {
  const normalizedMode = mode === "create" ? "create" : "clone";
  return {
    mode: normalizedMode,
    currentStepIndex: 0,
    locked: false,
    product: selectedProduct || "Family Locator",
    competitor: "",
    focus: ["Hook", "脚本逻辑"],
    creativeGoal: getCreativeSeed(promptText),
    specs: { ...defaultAgentSpecs },
    originalPrompt: promptText,
  };
}

function formatSessionSpecs(session = agentSession) {
  if (!session) return "泰语 / TikTok / 9:16 / 15s";
  const language = session.specs.language.split(" / ").pop();
  return `${language} / ${session.specs.channel} / ${session.specs.ratio} / ${session.specs.duration}`;
}

function buildAgentBrief(session = agentSession) {
  if (!session) return "Family Locator · 竞品复刻 · 待确认边界";
  const workType = session.mode === "clone" ? "竞品复刻" : "从 0 生成广告";
  const middle = session.mode === "clone" ? session.focus.join("、") : "创意目标待确认";
  const status = session.locked ? formatSessionSpecs(session) : "边界确认中";
  return `${session.product} · ${workType} · ${middle} · ${status}`;
}

function getCurrentAgentStep(session = agentSession) {
  if (!session || session.locked) return null;
  return getAgentOrder(session.mode)[session.currentStepIndex];
}

function startAgentSession(mode, promptText = "") {
  setupMode = mode === "create" ? "create" : "clone";
  competitorUploaded = false;
  agentSession = createAgentSession(setupMode, promptText);
  renderAgentWorkbench();
  setRoute("workbench");
}

function setRoute(route) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === route);
  });

  document.querySelectorAll(".rail-btn").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.route === route);
  });

  const title = document.getElementById("page-title");
  title.textContent = pageTitles[route] || "Ad Studio";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setActiveTemplateCategory(categoryId) {
  document.querySelectorAll("[data-template-jump]").forEach((button) => {
    const isActive = button.dataset.templateJump === categoryId;
    button.classList.toggle("is-selected", isActive);
    button.setAttribute("aria-current", isActive ? "true" : "false");
  });
}

function getCurrentTemplateCategory() {
  const categories = Array.from(document.querySelectorAll("[data-template-category]"));
  if (!categories.length) return null;

  const markerY = 132;
  let current = categories[0];

  categories.forEach((category) => {
    if (category.getBoundingClientRect().top <= markerY) {
      current = category;
    }
  });

  return current.dataset.templateCategory;
}

function syncTemplateCategoryOnScroll() {
  const homeView = document.getElementById("home");
  if (!homeView?.classList.contains("is-active")) return;

  const currentCategory = getCurrentTemplateCategory();
  if (currentCategory) setActiveTemplateCategory(currentCategory);
}

function queueTemplateCategorySync() {
  if (templateScrollFrame !== null) return;

  templateScrollFrame = window.requestAnimationFrame(() => {
    templateScrollFrame = null;
    syncTemplateCategoryOnScroll();
  });
}

function scrollToTemplateCategory(categoryId) {
  const target = document.querySelector(`[data-template-category="${categoryId}"]`);
  if (!target) return;

  const tabs = document.querySelector(".template-tabs");
  const offset = (tabs?.offsetHeight || 0) + 18;
  const top = window.scrollY + target.getBoundingClientRect().top - offset;

  setActiveTemplateCategory(categoryId);
  window.scrollTo({ top, behavior: "smooth" });
}

function setLauncherMode(mode) {
  launcherMode = mode;
  document.querySelectorAll("[data-launcher-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.launcherMode === mode);
  });
  renderLauncher();
}

function setLauncherAgentMode(mode) {
  launcherAgentMode = mode;
  document.querySelectorAll("[data-agent-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.agentMode === mode);
  });
  document.getElementById("agent-type-menu").hidden = true;
  renderLauncher();
}

function setSlotText(selector, title, detail) {
  const slot = document.querySelector(selector);
  if (!slot) return;
  slot.querySelector("strong").textContent = title;
  slot.querySelector("small").textContent = detail;
}

function renderLauncher() {
  const isAgent = launcherMode === "agent";
  const copy = isAgent ? launcherCopy.agent[launcherAgentMode] : launcherCopy[launcherMode];
  const typePicker = document.getElementById("agent-type-picker");
  const competitorSlot = document.getElementById("competitor-slot");

  document.getElementById("launcher-kicker").textContent = copy.kicker;
  document.getElementById("launcher-title").textContent = copy.title;
  document.getElementById("launcher-prompt").placeholder = copy.placeholder;
  document.getElementById("launcher-cta").setAttribute("aria-label", copy.cta);
  document.getElementById("launcher-cta").setAttribute("title", copy.cta);
  document.getElementById("launcher-pill").textContent = copy.pill;
  typePicker.hidden = !isAgent;
  document.getElementById("agent-type-label").textContent = launcherAgentMode === "clone" ? "复刻广告" : "创作广告";
  document.querySelectorAll("#agent-type-menu [data-agent-mode]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.agentMode === launcherAgentMode);
  });

  if (isAgent && launcherAgentMode === "clone") {
    competitorSlot.hidden = false;
    setSlotText(".product-slot", "产品包", "Family Locator");
    setSlotText(".competitor-slot", "竞品素材", "图片 / 视频");
    setSlotText(".optional-slot", "参考素材", "可选");
  } else if (isAgent) {
    competitorSlot.hidden = true;
    setSlotText(".product-slot", "产品包", "Family Locator");
    setSlotText(".optional-slot", "创意参考", "可选");
  } else if (launcherMode === "video") {
    competitorSlot.hidden = false;
    setSlotText(".product-slot", "参考图", "产品 / 人物");
    setSlotText(".competitor-slot", "参考视频", "可选");
    setSlotText(".optional-slot", "产品资产", "可选引用");
  } else {
    competitorSlot.hidden = false;
    setSlotText(".product-slot", "产品图", "可选");
    setSlotText(".competitor-slot", "人物图", "可选");
    setSlotText(".optional-slot", "参考图", "可选");
  }
}

function setAgentPageMode(mode) {
  agentPageMode = mode === "create" ? "create" : "clone";
  renderAgentPageLauncher();
}

function renderAgentPageLauncher() {
  const copy = launcherCopy.agent[agentPageMode];
  const isClone = agentPageMode === "clone";
  const competitorSlot = document.getElementById("agent-page-competitor-slot");
  const refSlot = document.getElementById("agent-page-ref-slot");

  if (!competitorSlot || !refSlot) return;

  document.getElementById("agent-page-kicker").textContent = copy.kicker;
  document.getElementById("agent-page-title").textContent = copy.title;
  document.getElementById("agent-page-prompt").placeholder = copy.placeholder;
  document.getElementById("agent-page-cta").setAttribute("aria-label", copy.cta);
  document.getElementById("agent-page-cta").setAttribute("title", copy.cta);
  document.getElementById("agent-page-type-label").textContent = isClone ? "复刻广告" : "创作广告";
  document.querySelectorAll("#agent-page-type-menu [data-agent-page-mode]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.agentPageMode === agentPageMode);
  });

  competitorSlot.hidden = !isClone;
  refSlot.querySelector("strong").textContent = isClone ? "参考素材" : "创意参考";
  refSlot.querySelector("small").textContent = "可选";
  document.getElementById("agent-page-type-menu").hidden = true;
}

function runLauncherAction() {
  if (launcherMode === "agent") {
    startAgentSession(launcherAgentMode, getLauncherPrompt("home"));
    return;
  }
  setRoute(launcherMode);
}

function runAgentPageAction() {
  startAgentSession(agentPageMode, getLauncherPrompt("agent-page"));
}

function showAgentSetup(mode) {
  setupMode = mode === "create" ? "create" : "clone";
  wizardIndex = 0;
  competitorUploaded = false;
  document.getElementById("upload-state").textContent = "还没有上传竞品素材";
  document.getElementById("upload-preview").hidden = true;
  renderWizard();
  setRoute("agent-setup");
}

function getWizardOrder() {
  return wizardOrders[setupMode];
}

function renderWizard() {
  const order = getWizardOrder();
  const step = order[wizardIndex];
  const isClone = setupMode === "clone";
  const copy = wizardCopy[step];

  document.getElementById("setup-mode-label").textContent = isClone ? "Agent Clone" : "Agent Create";
  document.getElementById("setup-title").textContent = isClone ? "创建竞品复刻任务" : "创建广告生成任务";
  document.getElementById("setup-intro").textContent = isClone
    ? "先把产品、竞品素材、解析重点和输出规格锁定，Agent 才会进入工作台开始拆解和复刻。"
    : "先把产品、创作目标和输出规格锁定，Agent 才会进入工作台给出广告方向。";

  document.querySelectorAll(".clone-only, .clone-summary, .clone-copy").forEach((element) => {
    element.hidden = !isClone;
  });
  document.querySelectorAll(".create-only, .create-summary, .create-copy").forEach((element) => {
    element.hidden = isClone;
  });

  document.querySelectorAll(".wizard-step").forEach((section) => {
    section.classList.toggle("is-active", section.dataset.step === step);
  });

  document.querySelectorAll("[data-wizard-step]").forEach((item) => {
    const itemStep = item.dataset.wizardStep;
    const itemIndex = order.indexOf(itemStep);
    item.hidden = itemIndex === -1;
    item.classList.toggle("is-current", itemStep === step);
    item.classList.toggle("is-done", itemIndex > -1 && itemIndex < wizardIndex);
  });

  document.getElementById("wizard-count").textContent = `Step ${wizardIndex + 1} / ${order.length}`;
  document.getElementById("wizard-step-title").textContent = copy.title;
  document.getElementById("wizard-step-copy").textContent = copy.copy;
  document.getElementById("wizard-lock-state").textContent = `边界锁定 ${wizardIndex + 1}/${order.length}`;

  const prev = document.getElementById("wizard-prev");
  const next = document.getElementById("wizard-next");
  prev.disabled = wizardIndex === 0;
  next.textContent = step === "confirm" ? "开始解析并进入工作台" : "下一步";

  updateSummary();
}

function collectFocus() {
  const selected = Array.from(document.querySelectorAll(".analysis-choice input:checked")).map((input) => input.value);
  return selected.length > 0 ? selected.join("、") : "待选择";
}

function collectSpecs() {
  const language = document.getElementById("spec-language").value.split(" / ").pop();
  const channel = document.getElementById("spec-channel").value;
  const ratio = document.getElementById("spec-ratio").value;
  const duration = document.getElementById("spec-duration").value;
  return `${language} / ${channel} / ${ratio} / ${duration}`;
}

function updateSummary() {
  const focus = collectFocus();
  const specs = collectSpecs();
  const creative = document.getElementById("creative-goal").value.trim() || "让 Agent 先给方向";
  const competitor = competitorUploaded ? "1 条视频" : "待上传";

  document.getElementById("summary-product").textContent = selectedProduct;
  document.getElementById("summary-competitor").textContent = competitor;
  document.getElementById("summary-focus").textContent = focus;
  document.getElementById("summary-creative").textContent = creative.slice(0, 26) + (creative.length > 26 ? "..." : "");
  document.getElementById("summary-specs").textContent = specs;

  document.getElementById("confirm-product").textContent = selectedProduct;
  document.getElementById("confirm-competitor").textContent = competitorUploaded ? "1 条竞品视频" : "进入工作台前建议上传";
  document.getElementById("confirm-focus").textContent = focus;
  document.getElementById("confirm-creative").textContent = creative;
  document.getElementById("confirm-specs").textContent = specs;
}

function moveWizard(delta) {
  const order = getWizardOrder();
  wizardIndex = Math.max(0, Math.min(order.length - 1, wizardIndex + delta));
  renderWizard();
}

function startWorkbench() {
  const focus = collectFocus();
  const specs = collectSpecs();
  const isClone = setupMode === "clone";
  const [language, channel, ratio, duration] = specs.split(" / ");
  agentSession = createAgentSession(setupMode, document.getElementById("creative-goal").value.trim());
  agentSession.product = selectedProduct;
  agentSession.focus = focus === "待选择" ? [] : focus.split("、");
  agentSession.competitor = competitorUploaded ? "competitor_ad_15s.mp4" : "";
  agentSession.specs = {
    language,
    channel,
    ratio,
    duration,
  };
  agentSession.locked = true;
  agentSession.currentStepIndex = getAgentOrder(setupMode).length;
  renderAgentWorkbench();
  setRoute("workbench");
}

function renderAgentWorkbench() {
  if (!agentSession) {
    agentSession = createAgentSession("clone");
  }

  const isClone = agentSession.mode === "clone";
  document.getElementById("workbench-title").textContent = isClone ? "复刻广告工作台" : "生成广告工作台";
  document.getElementById("workbench-cost").textContent = agentSession.locked ? "Cost 42 cr" : "Cost 0 cr";
  document.getElementById("workbench-brief-label").textContent = agentSession.locked ? "任务已锁定" : "需求草稿";
  document.getElementById("workbench-brief").textContent = buildAgentBrief(agentSession);
  document.getElementById("canvas-project-title").textContent = `${agentSession.product} 广告工作流画布`;
  document.getElementById("canvas-project-subtitle").textContent = agentSession.locked
    ? "节点可查看详情、重跑、替换输入、锁定和分支对比。"
    : "确认后的边界会逐步沉淀为节点，未确认内容先保持待定。";

  renderAgentPhaseList();
  renderAgentChat();
  renderWorkbenchCanvasState();
}

function renderAgentPhaseList() {
  const list = document.getElementById("agent-phase-list");
  const order = getAgentOrder(agentSession.mode);
  list.innerHTML = order
    .map((step, index) => {
      let state = "";
      if (agentSession.locked || index < agentSession.currentStepIndex) state = "done";
      if (!agentSession.locked && index === agentSession.currentStepIndex) state = "current";
      return `<span class="${state}">${agentBoundaryLabels[step]}</span>`;
    })
    .join("");
}

function renderAgentChat() {
  const stream = document.getElementById("agent-chat-stream");
  const firstMessage = agentSession.locked
    ? getLockedAgentMessage()
    : getDraftAgentMessage();
  stream.innerHTML = `
    <article class="message agent-message">
      <span class="speaker">创意总监</span>
      <p id="workbench-first-message">${escapeHtml(firstMessage)}</p>
    </article>
    ${agentSession.locked ? renderLockedAgentCards() : renderDraftAgentCards()}
  `;

  const input = document.getElementById("agent-composer-input");
  input.value = agentSession.locked ? "确认方案 A，继续生成脚本" : "可以直接补充或修改当前边界";
}

function getDraftAgentMessage() {
  const modeText = agentSession.mode === "clone" ? "复刻广告" : "创作广告";
  const prompt = agentSession.originalPrompt ? `我已收到你的需求：“${agentSession.originalPrompt}”。` : "";
  return `${prompt}我会把${modeText}拆成几个边界确认，不需要你一次填完所有字段。`;
}

function getLockedAgentMessage() {
  if (agentSession.mode === "clone") {
    return `任务边界已锁定。我会先客观拆解竞品素材，检查是否覆盖「${agentSession.focus.join("、") || "重点未指定"}」，再结合 ${agentSession.product} 生成 3 个复刻方向。`;
  }
  return `任务边界已锁定。我会先结合 ${agentSession.product} 和输出规格生成 3 个广告方向，等你选择后再进入脚本、锚点和分镜生产。`;
}

function renderDraftAgentCards() {
  return `
    ${renderConfirmedBoundarySummary()}
    ${renderCurrentBoundaryCard()}
    <article class="progress-card">
      <h3>当前进度</h3>
      <ul>
        ${renderBoundaryProgressItems()}
      </ul>
    </article>
  `;
}

function renderConfirmedBoundarySummary() {
  const order = getAgentOrder(agentSession.mode);
  const doneSteps = order.slice(0, agentSession.currentStepIndex);
  if (!doneSteps.length) return "";

  return `
    <article class="boundary-summary">
      <span>已确认</span>
      <strong>${doneSteps.map((step) => agentBoundaryLabels[step]).join("、")}</strong>
    </article>
  `;
}

function renderBoundaryProgressItems() {
  const order = getAgentOrder(agentSession.mode);
  return order
    .map((step, index) => {
      const className = index < agentSession.currentStepIndex ? "ok" : index === agentSession.currentStepIndex ? "run" : "";
      const suffix = index < agentSession.currentStepIndex ? "已确认" : index === agentSession.currentStepIndex ? "等待确认" : "待处理";
      return `<li class="${className}">${agentBoundaryLabels[step]}：${suffix}</li>`;
    })
    .join("");
}

function renderCurrentBoundaryCard() {
  const step = getCurrentAgentStep();
  if (step === "product") return renderProductBoundaryCard();
  if (step === "competitor") return renderCompetitorBoundaryCard();
  if (step === "focus") return renderFocusBoundaryCard();
  if (step === "creative") return renderCreativeBoundaryCard();
  if (step === "specs") return renderSpecsBoundaryCard();
  return renderConfirmBoundaryCard();
}

function renderProductBoundaryCard() {
  return `
    <article class="boundary-card">
      <div class="card-meta"><span>Step ${agentSession.currentStepIndex + 1}</span><span>产品包</span></div>
      <h3>这次广告服务哪个产品？</h3>
      <p>我会先用产品包约束卖点、用户和痛点，避免后续脚本创造不存在的功能。</p>
      <div class="boundary-option-grid">
        <button class="boundary-option ${agentSession.product === "Family Locator" ? "is-selected" : ""}" type="button" data-boundary-product="Family Locator">
          <strong>Family Locator</strong>
          <span>App · 家庭安全 · 已解析</span>
        </button>
        <button class="boundary-option ${agentSession.product === "新产品 URL" ? "is-selected" : ""}" type="button" data-boundary-product="新产品 URL">
          <strong>输入产品 URL</strong>
          <span>支持 App Store、商品页、官网</span>
        </button>
      </div>
      <button class="small-btn is-selected" type="button" data-boundary-action="confirm-step">确认产品，下一步</button>
    </article>
  `;
}

function renderCompetitorBoundaryCard() {
  const hasCompetitor = Boolean(agentSession.competitor);
  return `
    <article class="boundary-card">
      <div class="card-meta"><span>Step ${agentSession.currentStepIndex + 1}</span><span>竞品素材</span></div>
      <h3>要复刻哪条竞品广告？</h3>
      <p>素材会进入右侧画布，成为客观拆解和复刻迁移的输入节点。也可以先跳过，进入工作台后再补。</p>
      <button class="upload-box compact-upload" type="button" data-boundary-action="upload-competitor">
        <span class="upload-icon">${hasCompetitor ? "✓" : "＋"}</span>
        <strong>${hasCompetitor ? "competitor_ad_15s.mp4" : "添加竞品图片或视频"}</strong>
        <small>${hasCompetitor ? "已作为竞品素材节点" : "Demo 先使用占位素材"}</small>
      </button>
      <div class="boundary-actions">
        <button class="small-btn" type="button" data-boundary-action="confirm-step">稍后补充，继续</button>
        <button class="small-btn is-selected" type="button" data-boundary-action="upload-and-confirm">使用该素材，下一步</button>
      </div>
    </article>
  `;
}

function renderFocusBoundaryCard() {
  const options = [
    ["Hook", "前 3 秒怎么抓人"],
    ["脚本逻辑", "段落、转折和卖点植入"],
    ["剧情共鸣", "用户为什么代入"],
    ["画面构图", "镜头和视觉重心"],
    ["节奏", "剪辑速度和信息密度"],
    ["CTA", "最后如何促成行动"],
  ];

  return `
    <article class="boundary-card">
      <div class="card-meta"><span>Step ${agentSession.currentStepIndex + 1}</span><span>解析重点</span></div>
      <h3>最想让我拆解什么？</h3>
      <p>这一步只保留有限选项，用来避免泛泛解析。</p>
      <div class="choice-grid chat-choice-grid">
        ${options
          .map(([value, detail]) => {
            const checked = agentSession.focus.includes(value);
            return `<label class="analysis-choice ${checked ? "is-selected" : ""}"><input type="checkbox" value="${value}" data-boundary-focus ${checked ? "checked" : ""} /> <strong>${value}</strong><span>${detail}</span></label>`;
          })
          .join("")}
      </div>
      <button class="small-btn is-selected" type="button" data-boundary-action="confirm-step">确认重点，下一步</button>
    </article>
  `;
}

function renderCreativeBoundaryCard() {
  return `
    <article class="boundary-card">
      <div class="card-meta"><span>Step ${agentSession.currentStepIndex + 1}</span><span>创意目标</span></div>
      <h3>这条广告想解决什么问题？</h3>
      <p>不用写完整脚本，只要确认目标，Agent 会先给多个方向让你选。</p>
      <textarea id="agent-creative-goal">${escapeHtml(agentSession.creativeGoal)}</textarea>
      <div class="boundary-actions">
        <button class="small-btn" type="button" data-creative-template="痛点放大型">痛点放大型</button>
        <button class="small-btn" type="button" data-creative-template="生活化 UGC">生活化 UGC</button>
        <button class="small-btn" type="button" data-creative-template="产品演示型">产品演示型</button>
      </div>
      <button class="small-btn is-selected" type="button" data-boundary-action="confirm-step">确认目标，下一步</button>
    </article>
  `;
}

function renderSpecsBoundaryCard() {
  return `
    <article class="boundary-card">
      <div class="card-meta"><span>Step ${agentSession.currentStepIndex + 1}</span><span>输出规格</span></div>
      <h3>最终要生成什么规格？</h3>
      <p>语言、渠道、比例和时长会影响脚本密度、字幕表达和画面构图。</p>
      <div class="field-grid chat-field-grid">
        ${renderSpecSelect("language", "国家/语言", ["泰国 / 泰语", "美国 / 英语", "日本 / 日语"])}
        ${renderSpecSelect("channel", "渠道", ["TikTok", "Meta Reels", "YouTube Shorts"])}
        ${renderSpecSelect("ratio", "比例", ["9:16", "1:1", "16:9"])}
        ${renderSpecSelect("duration", "时长", ["15s", "30s", "60s"])}
      </div>
      <button class="small-btn is-selected" type="button" data-boundary-action="confirm-step">确认规格，下一步</button>
    </article>
  `;
}

function renderSpecSelect(key, label, options) {
  return `
    <label>
      ${label}
      <select data-boundary-spec="${key}">
        ${options.map((option) => `<option ${agentSession.specs[key] === option ? "selected" : ""}>${option}</option>`).join("")}
      </select>
    </label>
  `;
}

function renderConfirmBoundaryCard() {
  const competitorText = agentSession.mode === "clone" ? agentSession.competitor || "进入工作台后补充" : "不需要竞品素材";
  const goalRow =
    agentSession.mode === "create"
      ? `<div class="summary-row"><span>创意目标</span><strong>${escapeHtml(agentSession.creativeGoal)}</strong></div>`
      : `<div class="summary-row"><span>解析重点</span><strong>${escapeHtml(agentSession.focus.join("、") || "待选择")}</strong></div>`;

  return `
    <article class="boundary-card">
      <div class="card-meta"><span>Step ${agentSession.currentStepIndex + 1}</span><span>任务边界</span></div>
      <h3>最后确认一下任务边界</h3>
      <p>确认后我再开始解析或生成方向，右侧画布会沉淀对应节点。</p>
      <div class="brief-card compact-brief">
        <div class="summary-row"><span>产品</span><strong>${escapeHtml(agentSession.product)}</strong></div>
        <div class="summary-row"><span>${agentSession.mode === "clone" ? "竞品素材" : "任务类型"}</span><strong>${escapeHtml(competitorText)}</strong></div>
        ${goalRow}
        <div class="summary-row"><span>输出规格</span><strong>${escapeHtml(formatSessionSpecs(agentSession))}</strong></div>
      </div>
      <button class="small-btn is-selected" type="button" data-boundary-action="confirm-task">确认任务，开始${agentSession.mode === "clone" ? "解析" : "生成方向"}</button>
    </article>
  `;
}

function renderLockedAgentCards() {
  if (agentSession.mode === "create") {
    return `
      <article class="decision-card">
        <div class="card-meta"><span>方向 A</span><span>痛点放大</span></div>
        <h3>父母发现孩子未按时到家，用定位快速确认安全</h3>
        <p>以真实焦虑开场，用产品能力承接解决方案，适合 TikTok 高转化短视频。</p>
        <button class="small-btn is-selected">已选择</button>
      </article>
      <article class="decision-card muted">
        <div class="card-meta"><span>方向 B</span><span>生活化 UGC</span></div>
        <h3>妈妈日常分享：放学路上终于不用一直打电话</h3>
        <button class="small-btn">切换</button>
      </article>
      ${renderLockedProgressCard("已生成 3 个创意方向", "等待确认广告方向")}
    `;
  }

  return `
    <article class="decision-card">
      <div class="card-meta"><span>方案 A</span><span>高强度 Hook</span></div>
      <h3>孩子没回家，母亲用 App 定位确认安全</h3>
      <p>保留竞品的紧张开场和反转释然，用家庭安全痛点替换原商品卖点。</p>
      <button class="small-btn is-selected">已选择</button>
    </article>
    <article class="decision-card muted">
      <div class="card-meta"><span>方案 B</span><span>生活化 UGC</span></div>
      <h3>妈妈日常分享：放学路上终于不用一直打电话</h3>
      <button class="small-btn">切换</button>
    </article>
    ${renderLockedProgressCard("竞品客观拆解已完成", "等待确认复刻方案")}
  `;
}

function renderLockedProgressCard(secondItem, thirdItem) {
  return `
    <article class="progress-card">
      <h3>当前进度</h3>
      <ul>
        <li class="ok">产品资料包已锁定</li>
        <li class="ok">${secondItem}</li>
        <li class="run">${thirdItem}</li>
        <li>下一步生成脚本与锚点资产</li>
      </ul>
    </article>
  `;
}

function setFlowNodeState(nodeId, state, summary, title) {
  const node = document.querySelector(`[data-node="${nodeId}"]`);
  if (!node) return;
  node.classList.toggle("is-pending", state === "pending");
  node.classList.toggle("is-current", state === "current");
  node.classList.toggle("is-done", state === "done");
  if (title) node.querySelector("strong").textContent = title;
  if (summary) node.querySelector("small").textContent = summary;
}

function renderWorkbenchCanvasState() {
  const allNodes = ["product-pack", "app-ui", "competitor-video", "analysis", "clone-plan", "character", "scene", "shot-prompt", "storyboard", "final-video"];
  allNodes.forEach((nodeId) => setFlowNodeState(nodeId, "pending", "等待前序确认"));

  const step = getCurrentAgentStep();
  const order = getAgentOrder(agentSession.mode);
  const completedSteps = agentSession.locked ? order.length : agentSession.currentStepIndex;

  setFlowNodeState("product-pack", completedSteps > 0 || agentSession.locked ? "done" : "current", completedSteps > 0 || agentSession.locked ? "产品资料包已确认" : "等待确认产品包", "产品资料包");
  setFlowNodeState("app-ui", agentSession.locked ? "done" : "pending", agentSession.locked ? "locked · GPT Image" : "锁定产品后可用", "App UI 与 Icon");

  if (agentSession.mode === "clone") {
    setFlowNodeState("competitor-video", step === "competitor" ? "current" : completedSteps > 1 || agentSession.locked ? "done" : "pending", agentSession.competitor ? "15s · uploaded" : "等待上传或稍后补充", "竞品视频");
    setFlowNodeState("analysis", agentSession.locked ? "done" : step === "focus" ? "current" : "pending", agentSession.locked ? "Gemini · 21s · 6 cr" : "确认重点后解析", "客观拆解");
    setFlowNodeState("clone-plan", agentSession.locked ? "current" : step === "confirm" || step === "specs" ? "current" : "pending", agentSession.locked ? "等待用户确认" : "确认任务边界后生成", "迁移复刻方案 A");
  } else {
    setFlowNodeState("competitor-video", step === "creative" ? "current" : completedSteps > 1 || agentSession.locked ? "done" : "pending", completedSteps > 1 || agentSession.locked ? "创意目标已确认" : "等待确认创意目标", "创意目标");
    setFlowNodeState("analysis", agentSession.locked ? "done" : step === "creative" ? "current" : "pending", agentSession.locked ? "3 个方向已生成" : "确认目标后生成方向", "创意方向生成");
    setFlowNodeState("clone-plan", agentSession.locked ? "current" : step === "confirm" || step === "specs" ? "current" : "pending", agentSession.locked ? "等待用户选择" : "确认任务边界后生成", "方向 A：痛点放大");
  }

  if (agentSession.locked) {
    setFlowNodeState("character", "pending", "等待方向确认", "人物参考");
    setFlowNodeState("scene", "pending", "等待方向确认", "场景参考");
    setFlowNodeState("shot-prompt", "pending", "等待脚本确认", "分镜 Prompt");
    setFlowNodeState("storyboard", "pending", "等待 Prompt 确认", "分镜图");
    setFlowNodeState("final-video", "pending", "15s · pending", "最终广告视频");
  }
}

function applyTemplate(templateId) {
  const template = templates[templateId];
  if (!template) return;

  if (template.route === "video") {
    document.getElementById("video-prompt").value = template.prompt;
  }

  if (template.route === "image") {
    document.getElementById("image-prompt").value = template.prompt;
  }

  updateGeneratorState(template.route);
  setRoute(template.route);
  showToast(template.toast);
}

function closeComposerPopovers(exceptId) {
  document.querySelectorAll(".composer-menu.open").forEach((menu) => {
    if (menu.id !== exceptId) menu.classList.remove("open");
  });
  document.querySelectorAll(".advanced-panel.open").forEach((panel) => {
    if (panel.id !== exceptId) panel.classList.remove("open");
  });
  document.querySelectorAll("[data-menu-toggle], [data-advanced-toggle]").forEach((button) => {
    const targetId = button.dataset.menuToggle || button.dataset.advancedToggle;
    const isOpen = targetId === exceptId;
    button.classList.toggle("active", isOpen);
    if (button.hasAttribute("aria-expanded")) {
      button.setAttribute("aria-expanded", String(isOpen));
    }
  });
}

function toggleComposerMenu(menuId) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const willOpen = !menu.classList.contains("open");
  closeComposerPopovers(willOpen ? menuId : null);
  menu.classList.toggle("open", willOpen);
  document.querySelectorAll(`[data-menu-toggle="${menuId}"]`).forEach((button) => {
    button.classList.toggle("active", willOpen);
  });
}

function toggleAdvancedPanel(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const willOpen = !panel.classList.contains("open");
  closeComposerPopovers(willOpen ? panelId : null);
  panel.classList.toggle("open", willOpen);
  document.querySelectorAll(`[data-advanced-toggle="${panelId}"]`).forEach((button) => {
    button.classList.toggle("active", willOpen);
    button.setAttribute("aria-expanded", String(willOpen));
  });
}

function setDropdownSelection(button) {
  const dropdown = button.closest(".composer-dropdown");
  if (!dropdown) return;
  dropdown.querySelectorAll(".dropdown-item").forEach((item) => {
    item.classList.toggle("active", item === button);
    item.querySelectorAll("span").forEach((span) => {
      if (span.textContent === "✓") span.remove();
    });
  });
  const check = document.createElement("span");
  check.textContent = "✓";
  button.appendChild(check);
}

function setComposerLabel(dropdown, value) {
  const label = dropdown.querySelector(".pill-btn span:not(.dot):not(.chevron)");
  if (label) label.textContent = value;
}

function getGeneratorPrompt(route) {
  return document.getElementById(`${route}-prompt`);
}

function updateGeneratorState(route) {
  const prompt = getGeneratorPrompt(route);
  const composer = document.querySelector(`[data-composer="${route}"]`);
  if (!prompt || !composer) return;

  const hasPrompt = prompt.value.trim().length > 0;
  const credit = route === "video" ? 18 : 8;
  const submit = composer.querySelector("[data-submit-generator]");
  const creditCount = composer.querySelector("[data-credit-count]");

  if (submit) submit.disabled = !hasPrompt;
  if (creditCount) creditCount.textContent = hasPrompt ? String(credit) : "0";
}

function updateAllGeneratorStates() {
  updateGeneratorState("video");
  updateGeneratorState("image");
}

function addSlotDemo(slot) {
  slot.classList.add("has-upload");
  const plus = slot.querySelector(".slot-upload-plus");
  if (plus) plus.textContent = "✓";
  showToast("已添加参考素材占位");
}

function buildHistoryTask({ route, prompt, model }) {
  const card = document.createElement("article");
  card.className = "history-task-card";

  const head = document.createElement("div");
  head.className = "history-task-head";

  const type = document.createElement("span");
  type.textContent = route === "video" ? "Video generation" : "Image generation";

  const status = document.createElement("small");
  status.textContent = "queued";
  head.append(type, status);

  const promptText = document.createElement("p");
  promptText.className = "history-task-prompt";
  promptText.textContent = prompt;

  const output = document.createElement("div");
  output.className = "history-task-output";
  output.textContent = "生成结果占位";

  const meta = document.createElement("div");
  meta.className = "history-task-meta";

  const modelText = document.createElement("small");
  modelText.textContent = model;
  const costText = document.createElement("small");
  costText.textContent = route === "video" ? "18 credits" : "8 credits";
  meta.append(modelText, costText);

  card.append(head, promptText, output, meta);
  return card;
}

function submitGenerator(route) {
  const prompt = getGeneratorPrompt(route);
  const composer = document.querySelector(`[data-composer="${route}"]`);
  const history = document.getElementById(`${route}-history`);
  if (!prompt || !composer || !history || !prompt.value.trim()) return;

  const model = composer.querySelector("[data-model-label]")?.textContent || "Default model";
  const task = document.createElement("div");
  task.className = "history-task";
  task.appendChild(buildHistoryTask({ route, prompt: prompt.value.trim(), model }));

  history.replaceChildren(task);
  showToast(route === "video" ? "已提交视频生成任务" : "已提交图片生成任务");
}

function showToast(text) {
  const toast = document.getElementById("toast");
  toast.textContent = text;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
}

function openNode(nodeId) {
  const node = nodes[nodeId];
  if (!node) return;

  document.getElementById("drawer-type").textContent = node.type;
  document.getElementById("drawer-title").textContent = node.title;
  document.getElementById("drawer-status").textContent = node.status;
  document.getElementById("drawer-model").textContent = node.model;
  document.getElementById("drawer-time").textContent = node.time;
  document.getElementById("drawer-cost").textContent = node.cost;
  document.getElementById("drawer-input").textContent = node.input;
  document.getElementById("drawer-output").textContent = node.output;

  const preview = document.getElementById("drawer-preview");
  preview.className = `drawer-preview drawer-${nodeId}`;
  preview.style.background = "";

  const drawer = document.getElementById("node-drawer");
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
}

function closeNodeDrawer() {
  const drawer = document.getElementById("node-drawer");
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
}

function syncAgentCreativeGoal() {
  const input = document.getElementById("agent-creative-goal");
  if (agentSession && input) agentSession.creativeGoal = input.value.trim() || "让 Agent 先给方向";
}

function confirmCurrentBoundaryStep() {
  if (!agentSession || agentSession.locked) return;
  syncAgentCreativeGoal();
  const order = getAgentOrder(agentSession.mode);
  agentSession.currentStepIndex = Math.min(order.length - 1, agentSession.currentStepIndex + 1);
  renderAgentWorkbench();
}

function lockAgentTask() {
  if (!agentSession) return;
  syncAgentCreativeGoal();
  agentSession.locked = true;
  agentSession.currentStepIndex = getAgentOrder(agentSession.mode).length;
  renderAgentWorkbench();
}

function handleBoundaryAction(action) {
  if (!agentSession) return;

  if (action === "upload-competitor") {
    agentSession.competitor = "competitor_ad_15s.mp4";
    competitorUploaded = true;
    renderAgentWorkbench();
    return;
  }

  if (action === "upload-and-confirm") {
    agentSession.competitor = "competitor_ad_15s.mp4";
    competitorUploaded = true;
    confirmCurrentBoundaryStep();
    return;
  }

  if (action === "confirm-task") {
    lockAgentTask();
    return;
  }

  if (action === "confirm-step") {
    confirmCurrentBoundaryStep();
  }
}

document.addEventListener("click", (event) => {
  const launcherModeButton = event.target.closest("[data-launcher-mode]");
  if (launcherModeButton) {
    setLauncherMode(launcherModeButton.dataset.launcherMode);
  }

  if (event.target.closest("#agent-type-trigger")) {
    const menu = document.getElementById("agent-type-menu");
    menu.hidden = !menu.hidden;
  }

  if (event.target.closest("#agent-page-type-trigger")) {
    const menu = document.getElementById("agent-page-type-menu");
    menu.hidden = !menu.hidden;
  }

  const launcherAgentButton = event.target.closest("[data-agent-mode]");
  if (launcherAgentButton) {
    setLauncherAgentMode(launcherAgentButton.dataset.agentMode);
  }

  const agentPageModeButton = event.target.closest("[data-agent-page-mode]");
  if (agentPageModeButton) {
    setAgentPageMode(agentPageModeButton.dataset.agentPageMode);
  }

  if (event.target.closest("#launcher-cta")) {
    runLauncherAction();
  }

  if (event.target.closest("#agent-page-cta")) {
    runAgentPageAction();
  }

  const boundaryAction = event.target.closest("[data-boundary-action]");
  if (boundaryAction) {
    handleBoundaryAction(boundaryAction.dataset.boundaryAction);
    return;
  }

  const boundaryProduct = event.target.closest("[data-boundary-product]");
  if (boundaryProduct && agentSession) {
    agentSession.product = boundaryProduct.dataset.boundaryProduct;
    selectedProduct = agentSession.product;
    renderAgentWorkbench();
    return;
  }

  const creativeTemplate = event.target.closest("[data-creative-template]");
  if (creativeTemplate && agentSession) {
    syncAgentCreativeGoal();
    agentSession.creativeGoal = `${agentSession.creativeGoal}。创意倾向：${creativeTemplate.dataset.creativeTemplate}`;
    renderAgentWorkbench();
    return;
  }

  const menuToggle = event.target.closest("[data-menu-toggle]");
  if (menuToggle) {
    toggleComposerMenu(menuToggle.dataset.menuToggle);
    return;
  }

  const advancedToggle = event.target.closest("[data-advanced-toggle]");
  if (advancedToggle) {
    toggleAdvancedPanel(advancedToggle.dataset.advancedToggle);
    return;
  }

  const generatorRoute = event.target.closest("[data-generator-route]");
  if (generatorRoute) {
    setRoute(generatorRoute.dataset.generatorRoute);
    closeComposerPopovers(null);
    return;
  }

  const modelOption = event.target.closest("[data-model-option]");
  if (modelOption) {
    const dropdown = modelOption.closest(".composer-dropdown");
    setDropdownSelection(modelOption);
    setComposerLabel(dropdown, modelOption.dataset.modelOption);
    closeComposerPopovers(null);
    return;
  }

  const summaryOption = event.target.closest("[data-summary-option]");
  if (summaryOption) {
    const dropdown = summaryOption.closest(".composer-dropdown");
    setDropdownSelection(summaryOption);
    setComposerLabel(dropdown, summaryOption.dataset.summaryOption);
    closeComposerPopovers(null);
    return;
  }

  const slotDemo = event.target.closest("[data-slot-demo]");
  if (slotDemo) {
    addSlotDemo(slotDemo);
    closeComposerPopovers(null);
    return;
  }

  const submitButton = event.target.closest("[data-submit-generator]");
  if (submitButton) {
    submitGenerator(submitButton.dataset.submitGenerator);
    closeComposerPopovers(null);
    return;
  }

  if (event.target.closest("[data-return-bottom]")) {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    closeComposerPopovers(null);
    return;
  }

  const templateJump = event.target.closest("[data-template-jump]");
  if (templateJump) {
    scrollToTemplateCategory(templateJump.dataset.templateJump);
    closeComposerPopovers(null);
    return;
  }

  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    setRoute(routeButton.dataset.route);
  }

  const entryButton = event.target.closest("[data-entry]");
  if (entryButton) {
    startAgentSession(entryButton.dataset.entry);
  }

  const templateCard = event.target.closest("[data-template]");
  if (templateCard) {
    applyTemplate(templateCard.dataset.template);
  }

  const nodeButton = event.target.closest("[data-node]");
  if (nodeButton) {
    openNode(nodeButton.dataset.node);
  }

  const productChoice = event.target.closest(".product-choice");
  if (productChoice) {
    document.querySelectorAll(".product-choice").forEach((choice) => choice.classList.remove("is-selected"));
    productChoice.classList.add("is-selected");
    selectedProduct = productChoice.dataset.productName;
    updateSummary();
  }

  const uploadDemo = event.target.closest("[data-upload-demo]");
  if (uploadDemo) {
    competitorUploaded = true;
    document.getElementById("upload-state").textContent = "已添加 competitor_ad_15s.mp4";
    document.getElementById("upload-preview").hidden = false;
    updateSummary();
  }

  if (!event.target.closest(".composer-dropdown, .advanced-wrap")) {
    closeComposerPopovers(null);
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#agent-type-picker")) {
    document.getElementById("agent-type-menu").hidden = true;
  }
  if (!event.target.closest("#agent-page-type-picker")) {
    document.getElementById("agent-page-type-menu").hidden = true;
  }
});

document.getElementById("drawer-close").addEventListener("click", closeNodeDrawer);
document.getElementById("wizard-prev").addEventListener("click", () => moveWizard(-1));
document.getElementById("wizard-next").addEventListener("click", () => {
  const order = getWizardOrder();
  if (order[wizardIndex] === "confirm") {
    startWorkbench();
    return;
  }
  moveWizard(1);
});

document.querySelectorAll(".analysis-choice input").forEach((input) => {
  input.addEventListener("change", () => {
    input.closest(".analysis-choice").classList.toggle("is-selected", input.checked);
    updateSummary();
  });
});

document.addEventListener("change", (event) => {
  if (!agentSession || agentSession.locked) return;

  if (event.target.matches("[data-boundary-focus]")) {
    agentSession.focus = Array.from(document.querySelectorAll("[data-boundary-focus]:checked")).map((input) => input.value);
    event.target.closest(".analysis-choice").classList.toggle("is-selected", event.target.checked);
    renderAgentWorkbench();
  }

  if (event.target.matches("[data-boundary-spec]")) {
    agentSession.specs[event.target.dataset.boundarySpec] = event.target.value;
    renderAgentWorkbench();
  }
});

document.addEventListener("input", (event) => {
  if (!agentSession || agentSession.locked) return;
  if (event.target.id === "agent-creative-goal") {
    agentSession.creativeGoal = event.target.value;
    document.getElementById("workbench-brief").textContent = buildAgentBrief(agentSession);
  }
});

["spec-language", "spec-channel", "spec-ratio", "spec-duration", "creative-goal"].forEach((id) => {
  document.getElementById(id).addEventListener("input", updateSummary);
  document.getElementById(id).addEventListener("change", updateSummary);
});

document.querySelectorAll(".composer-prompt").forEach((prompt) => {
  const route = prompt.id.replace("-prompt", "");
  prompt.addEventListener("input", () => updateGeneratorState(route));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeNodeDrawer();
    closeComposerPopovers(null);
  }
});

window.addEventListener("scroll", queueTemplateCategorySync, { passive: true });
window.addEventListener("resize", queueTemplateCategorySync);

renderWizard();
renderLauncher();
renderAgentPageLauncher();
renderAgentWorkbench();
updateAllGeneratorStates();
syncTemplateCategoryOnScroll();
