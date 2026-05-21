export const products = [
  {
    name: "Family Locator",
    shortName: "FL",
    type: "App",
    assets: 12,
    toneClass: "",
    summary: "实时位置共享、异常提醒、家庭安全场景，面向父母、儿童和老人照护者。",
    painPoints: "孩子放学未联系、老人走失、家人临时失联、跨城市照护焦虑。",
    templateSlots: {
      benefit_1: "real-time family location",
      benefit_2: "arrival notifications",
      benefit_3: "simple safety check-ins",
      cta: "Download Family Locator today",
      headline: "Know your family is safe",
      install_cta: "Install Family Locator free today",
      main_benefit: "real-time location and arrival alerts",
      pain_point: "parents cannot confirm whether their child arrived safely after school",
      product_name: "Family Locator",
      proof: "arrival alerts and live map confirmation"
    }
  },
  {
    name: "Baby Bottle Brand",
    shortName: "BB",
    type: "Ecommerce",
    assets: 7,
    toneClass: "warm",
    summary: "安全材质、便携保温、夜间喂养效率。",
    painPoints: "新手父母担心材质安全、温度控制和夜间操作。",
    templateSlots: {
      cta: "Shop the safer feeding bottle today",
      headline: "Make every night feed easier",
      main_benefit: "safer material and easier night feeding",
      pain_point: "new parents struggle with safe temperature control at night",
      product_name: "Baby Bottle Brand",
      proof: "clear temperature indicator and leak-resistant design"
    }
  },
  {
    name: "Game App",
    shortName: "GA",
    type: "Game",
    assets: 9,
    toneClass: "cool",
    summary: "轻度闯关、即时反馈、短局胜利爽感。",
    painPoints: "用户需要快速进入、短时间获得挑战和奖励。",
    templateSlots: {
      cta: "Play free now",
      headline: "Beat the level in one minute",
      install_cta: "Install and try the challenge",
      main_benefit: "fast challenges with instant rewards",
      pain_point: "players want a quick challenge that feels satisfying fast",
      product_name: "Game App",
      proof: "short levels, instant feedback, and rewarding wins"
    }
  }
];

export type ProductPack = (typeof products)[number];
export type ProductTemplateSlotMap = Record<string, string | undefined>;

export function getProductPack(productName: string) {
  return products.find((product) => product.name === productName) ?? products[0];
}

export function getProductTemplateSlotValues(productName: string): ProductTemplateSlotMap {
  return getProductPack(productName).templateSlots;
}

export const productAssets = [
  { title: "Logo / Icon", tag: "locked", thumbClass: "logo-thumb", label: "FL" },
  { title: "App UI 截图", tag: "product_asset", thumbClass: "ui-thumb" },
  { title: "泰国母亲人物参考", tag: "character_reference", thumbClass: "person-thumb" },
  { title: "曼谷街景", tag: "scene_reference", thumbClass: "scene-thumb" },
  { title: "竞品视频", tag: "competitor_asset", thumbClass: "video-thumb" },
  { title: "C1 分镜视频", tag: "shot_video", thumbClass: "result-thumb" }
];
