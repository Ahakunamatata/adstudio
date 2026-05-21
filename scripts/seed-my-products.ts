/**
 * 一次性 seed：把 Phone Alarm 演示产品写进 my_products 表。
 *
 * 跑法：
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/seed-my-products.ts
 *
 * 幂等：检测 DB 里如果已有同名产品就跳过，不会重复插入。
 */

import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";

const DEMO_USER = "demo-user";

const SEED = {
  name: "Phone Alarm – Anti-Theft",
  type: "App" as const,
  intro:
    "想寻找一种简单有效的方法来阻止未经授权的触摸、拿起或盗窃行为吗？这款防盗手机报警应用能将您的设备变成主动安全助手——一旦有人试图移动或拿走您的设备，它会立即发出警报。",
  painPoints:
    "用户在公共场合担心设备被未经授权触碰、拿起或盗走，缺乏简单可靠的实时威慑手段。",
  url: "https://play.google.com/store/apps/details?id=com.dayzeroglobal.phonealarm",
  images: [
    "/assets/templates/phone-alarm-1.png",
    "/assets/templates/phone-alarm-2.png",
    "/assets/templates/phone-alarm-3.png"
  ],
  inferredIndustry: "app" as const,
  inferredKeywords: [
    "anti-theft alarm",
    "phone security",
    "device theft protection",
    "motion detection alarm",
    "theft deterrent",
    "phone anti-theft",
    "theft alarm app"
  ],
  cleanedIntro:
    "这款应用能将手机变成防盗报警设备，当检测到设备被移动或拿起时立即发出警报声。",
  cleanedPainPoints:
    "用户在咖啡馆、图书馆等公共场所担心手机被未经授权触碰或盗走，缺乏简单有效的实时威慑和报警手段。"
};

async function main() {
  const existing = await db
    .select()
    .from(schema.myProducts)
    .where(
      and(
        eq(schema.myProducts.createdBy, DEMO_USER),
        eq(schema.myProducts.name, SEED.name)
      )
    );

  if (existing.length > 0) {
    console.log(
      `✓ Phone Alarm seed already present (id=${existing[0].id}). skipping.`
    );
    return;
  }

  const [inserted] = await db
    .insert(schema.myProducts)
    .values({
      name: SEED.name,
      type: SEED.type,
      intro: SEED.intro,
      painPoints: SEED.painPoints,
      url: SEED.url,
      images: SEED.images,
      inferredIndustry: SEED.inferredIndustry,
      inferredKeywords: SEED.inferredKeywords,
      cleanedIntro: SEED.cleanedIntro,
      cleanedPainPoints: SEED.cleanedPainPoints,
      useForCloning: 1,
      createdBy: DEMO_USER
    })
    .returning({ id: schema.myProducts.id });

  console.log(`✅ inserted Phone Alarm seed id=${inserted.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ seed failed:", error);
    process.exit(1);
  });
