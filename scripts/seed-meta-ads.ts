/**
 * Seed 14 条 Meta-Ad-Library 格式的 mock 广告进 ads 表。
 *
 * 用途：在 Meta Identity Verification 通过前，让"我的产品爆款"Tab 也能跑出
 * 真 DB 链路（API 路由 + UI 渲染）。等 verification 通过 + MetaFetcher 上线后
 * 这些 seed 可以直接被真数据替换 / 共存（id 不冲突）。
 *
 * 跑法：
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/seed-meta-ads.ts
 *
 * 幂等：upsertAd 已经处理重复 ID 的更新逻辑。
 */

import { upsertAd } from "../src/lib/db/upsertAd";
import type { ScrapedAdRecord } from "../src/lib/fetchers/types";

const NOW = new Date("2026-05-15T00:00:00Z");
function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86400_000);
}

// 14 条精心构造的 mock，覆盖：
//   - 防盗 / 设备安全 / app-lock / find-my (匹配 Phone Alarm 这个 demo 产品)
//   - 通用 mobile app 工具 (作为相关性测试的"边缘相关"参照)
//   - 一些与防盗无关的电商广告 (相关性 rerank 应该排得低)
const SEED: ScrapedAdRecord[] = [
  {
    source: "meta",
    sourceId: "1842857419201001",
    advertiserName: "PhoneGuard Anti-Theft",
    advertiserPageId: "100087421033201",
    adCreativeBodies: [
      "Worried about phone theft? PhoneGuard turns any movement into an alarm. Set it once, walk away with peace of mind.",
      "Don't let pickpockets win. Loud siren + flash + vibration the moment your phone is touched."
    ],
    adCreativeTitles: ["Stop Phone Theft Cold"],
    adCreativeLinkDescriptions: ["#1 anti-theft alarm app · 10M+ downloads"],
    adCreativeLinkCaptions: ["play.google.com"],
    videoUrl: null,
    thumbnailUrl: null,
    snapshotUrl: "https://www.facebook.com/ads/library/?id=1842857419201001",
    region: "DE",
    publisherPlatforms: ["facebook", "instagram", "audience_network"],
    languages: ["en", "de"],
    deliveryStartAt: daysAgo(14),
    deliveryStopAt: null,
    raw: { synthetic: true, note: "seed-2026-05-20" }
  },
  {
    source: "meta",
    sourceId: "1842857419201002",
    advertiserName: "VaultLock - App Lock",
    advertiserPageId: "100087421033202",
    adCreativeBodies: [
      "Lock any app on your phone with fingerprint or PIN. Photos, chats, banking — all secured."
    ],
    adCreativeTitles: ["Hide What Matters"],
    adCreativeLinkDescriptions: ["Privacy you control"],
    adCreativeLinkCaptions: ["vaultlock.app"],
    videoUrl: null,
    thumbnailUrl: null,
    snapshotUrl: "https://www.facebook.com/ads/library/?id=1842857419201002",
    region: "FR",
    publisherPlatforms: ["facebook", "instagram"],
    languages: ["fr", "en"],
    deliveryStartAt: daysAgo(9),
    deliveryStopAt: null,
    raw: { synthetic: true, note: "seed-2026-05-20" }
  },
  {
    source: "meta",
    sourceId: "1842857419201003",
    advertiserName: "FindMyDevice Pro",
    advertiserPageId: "100087421033203",
    adCreativeBodies: [
      "Lost your phone? Track its exact location in real-time. Works even when offline. No subscription, free forever.",
      "I found my stolen phone in 3 minutes. This app is wild."
    ],
    adCreativeTitles: ["Never Lose Your Phone Again"],
    adCreativeLinkDescriptions: ["Real-time GPS tracking"],
    adCreativeLinkCaptions: ["findmydevice.pro"],
    videoUrl: null,
    thumbnailUrl: null,
    snapshotUrl: "https://www.facebook.com/ads/library/?id=1842857419201003",
    region: "IT",
    publisherPlatforms: ["facebook", "instagram"],
    languages: ["it"],
    deliveryStartAt: daysAgo(21),
    deliveryStopAt: null,
    raw: { synthetic: true, note: "seed-2026-05-20" }
  },
  {
    source: "meta",
    sourceId: "1842857419201004",
    advertiserName: "SafeZone Family Locator",
    advertiserPageId: "100087421033204",
    adCreativeBodies: [
      "Know exactly where your kids are. Real-time location sharing for the whole family. No more 'where are you?' texts."
    ],
    adCreativeTitles: ["Family Safety, Simplified"],
    adCreativeLinkDescriptions: ["Trusted by 5M+ parents"],
    adCreativeLinkCaptions: ["safezone.app"],
    videoUrl: null,
    thumbnailUrl: null,
    snapshotUrl: "https://www.facebook.com/ads/library/?id=1842857419201004",
    region: "ES",
    publisherPlatforms: ["facebook", "messenger"],
    languages: ["es", "en"],
    deliveryStartAt: daysAgo(6),
    deliveryStopAt: null,
    raw: { synthetic: true, note: "seed-2026-05-20" }
  },
  {
    source: "meta",
    sourceId: "1842857419201005",
    advertiserName: "WhisperVPN",
    advertiserPageId: "100087421033205",
    adCreativeBodies: [
      "Browse safely on public WiFi. Military-grade encryption, 90+ countries. Activate with one tap."
    ],
    adCreativeTitles: ["Private Internet, Anywhere"],
    adCreativeLinkDescriptions: ["7-day free trial"],
    adCreativeLinkCaptions: ["whispervpn.com"],
    videoUrl: null,
    thumbnailUrl: null,
    snapshotUrl: "https://www.facebook.com/ads/library/?id=1842857419201005",
    region: "NL",
    publisherPlatforms: ["facebook", "instagram"],
    languages: ["nl", "en"],
    deliveryStartAt: daysAgo(11),
    deliveryStopAt: null,
    raw: { synthetic: true, note: "seed-2026-05-20" }
  },
  {
    source: "meta",
    sourceId: "1842857419201006",
    advertiserName: "RingGuard Smart Doorbell",
    advertiserPageId: "100087421033206",
    adCreativeBodies: [
      "Catch porch pirates red-handed. AI-powered motion detection + 4K video with night vision."
    ],
    adCreativeTitles: ["Home Security, Reinvented"],
    adCreativeLinkDescriptions: ["30% off this week"],
    adCreativeLinkCaptions: ["ringguard.store"],
    videoUrl: null,
    thumbnailUrl: null,
    snapshotUrl: "https://www.facebook.com/ads/library/?id=1842857419201006",
    region: "DE",
    publisherPlatforms: ["facebook", "instagram"],
    languages: ["de"],
    deliveryStartAt: daysAgo(3),
    deliveryStopAt: null,
    raw: { synthetic: true, note: "seed-2026-05-20" }
  },
  {
    source: "meta",
    sourceId: "1842857419201007",
    advertiserName: "EduPlay Kids Learning",
    advertiserPageId: "100087421033207",
    adCreativeBodies: [
      "Math, reading, science — your child will love learning. Ages 4-12. First lesson free!"
    ],
    adCreativeTitles: ["Make Screen Time Count"],
    adCreativeLinkDescriptions: ["10,000+ interactive lessons"],
    adCreativeLinkCaptions: ["eduplay.app"],
    videoUrl: null,
    thumbnailUrl: null,
    snapshotUrl: "https://www.facebook.com/ads/library/?id=1842857419201007",
    region: "FR",
    publisherPlatforms: ["facebook", "instagram"],
    languages: ["fr"],
    deliveryStartAt: daysAgo(18),
    deliveryStopAt: null,
    raw: { synthetic: true, note: "seed-2026-05-20" }
  },
  {
    source: "meta",
    sourceId: "1842857419201008",
    advertiserName: "BlackForest Coffee Co.",
    advertiserPageId: "100087421033208",
    adCreativeBodies: [
      "Fresh-roasted, single-origin beans delivered weekly. From Munich to your door. €15 off first order."
    ],
    adCreativeTitles: ["Coffee Subscription, Reimagined"],
    adCreativeLinkDescriptions: ["Free shipping over €30"],
    adCreativeLinkCaptions: ["blackforestcoffee.de"],
    videoUrl: null,
    thumbnailUrl: null,
    snapshotUrl: "https://www.facebook.com/ads/library/?id=1842857419201008",
    region: "DE",
    publisherPlatforms: ["facebook", "instagram"],
    languages: ["de", "en"],
    deliveryStartAt: daysAgo(7),
    deliveryStopAt: null,
    raw: { synthetic: true, note: "seed-2026-05-20" }
  },
  {
    source: "meta",
    sourceId: "1842857419201009",
    advertiserName: "Aurora Yoga Studio",
    advertiserPageId: "100087421033209",
    adCreativeBodies: [
      "Find your calm. 1000+ guided sessions, beginner to advanced. Try Aurora free for 14 days."
    ],
    adCreativeTitles: ["Yoga at Your Pace"],
    adCreativeLinkDescriptions: ["#1 mindfulness app in EU"],
    adCreativeLinkCaptions: ["aurorayoga.app"],
    videoUrl: null,
    thumbnailUrl: null,
    snapshotUrl: "https://www.facebook.com/ads/library/?id=1842857419201009",
    region: "IT",
    publisherPlatforms: ["instagram", "facebook"],
    languages: ["it", "en"],
    deliveryStartAt: daysAgo(13),
    deliveryStopAt: null,
    raw: { synthetic: true, note: "seed-2026-05-20" }
  },
  {
    source: "meta",
    sourceId: "1842857419201010",
    advertiserName: "PhoneShield - Anti-Theft",
    advertiserPageId: "100087421033210",
    adCreativeBodies: [
      "Phone moved while charging? Triggered alarm scares the thief and notifies you instantly. Works without internet."
    ],
    adCreativeTitles: ["Café-Proof Your Phone"],
    adCreativeLinkDescriptions: ["Coffee shop · library · gym safe"],
    adCreativeLinkCaptions: ["phoneshield.io"],
    videoUrl: null,
    thumbnailUrl: null,
    snapshotUrl: "https://www.facebook.com/ads/library/?id=1842857419201010",
    region: "PL",
    publisherPlatforms: ["facebook", "instagram"],
    languages: ["pl", "en"],
    deliveryStartAt: daysAgo(5),
    deliveryStopAt: null,
    raw: { synthetic: true, note: "seed-2026-05-20" }
  },
  {
    source: "meta",
    sourceId: "1842857419201011",
    advertiserName: "AlarmBox Pro",
    advertiserPageId: "100087421033211",
    adCreativeBodies: [
      "The loudest phone alarm on the App Store. 130dB pure terror for would-be thieves."
    ],
    adCreativeTitles: ["When Volume Becomes a Weapon"],
    adCreativeLinkDescriptions: ["Top 10 utility app"],
    adCreativeLinkCaptions: ["alarmboxpro.com"],
    videoUrl: null,
    thumbnailUrl: null,
    snapshotUrl: "https://www.facebook.com/ads/library/?id=1842857419201011",
    region: "DE",
    publisherPlatforms: ["facebook"],
    languages: ["de"],
    deliveryStartAt: daysAgo(2),
    deliveryStopAt: null,
    raw: { synthetic: true, note: "seed-2026-05-20" }
  },
  {
    source: "meta",
    sourceId: "1842857419201012",
    advertiserName: "Wallet Watch",
    advertiserPageId: "100087421033212",
    adCreativeBodies: [
      "GPS tracker the size of a credit card. Slip it in your wallet, suitcase, or bag. Track for life — no subscription."
    ],
    adCreativeTitles: ["Never Lose Your Stuff Again"],
    adCreativeLinkDescriptions: ["Battery lasts 12 months"],
    adCreativeLinkCaptions: ["walletwatch.eu"],
    videoUrl: null,
    thumbnailUrl: null,
    snapshotUrl: "https://www.facebook.com/ads/library/?id=1842857419201012",
    region: "ES",
    publisherPlatforms: ["facebook", "instagram"],
    languages: ["es"],
    deliveryStartAt: daysAgo(16),
    deliveryStopAt: null,
    raw: { synthetic: true, note: "seed-2026-05-20" }
  },
  {
    source: "meta",
    sourceId: "1842857419201013",
    advertiserName: "Match3 Bliss",
    advertiserPageId: "100087421033213",
    adCreativeBodies: [
      "Only 2% finish level 50. Are you in the club? Free match-3 with no annoying ads."
    ],
    adCreativeTitles: ["Train Your Brain in 60 Seconds"],
    adCreativeLinkDescriptions: ["Free to play"],
    adCreativeLinkCaptions: ["match3bliss.game"],
    videoUrl: null,
    thumbnailUrl: null,
    snapshotUrl: "https://www.facebook.com/ads/library/?id=1842857419201013",
    region: "NL",
    publisherPlatforms: ["facebook", "audience_network"],
    languages: ["nl", "en"],
    deliveryStartAt: daysAgo(4),
    deliveryStopAt: null,
    raw: { synthetic: true, note: "seed-2026-05-20" }
  },
  {
    source: "meta",
    sourceId: "1842857419201014",
    advertiserName: "Pocket Theft Sensor",
    advertiserPageId: "100087421033214",
    adCreativeBodies: [
      "Place your phone in your pocket. If someone takes it out without permission — instant alarm. Library-friendly."
    ],
    adCreativeTitles: ["Pocket Sensor Mode"],
    adCreativeLinkDescriptions: ["For commuters, students, travelers"],
    adCreativeLinkCaptions: ["pockettheftsensor.app"],
    videoUrl: null,
    thumbnailUrl: null,
    snapshotUrl: "https://www.facebook.com/ads/library/?id=1842857419201014",
    region: "FR",
    publisherPlatforms: ["facebook", "instagram", "messenger"],
    languages: ["fr"],
    deliveryStartAt: daysAgo(1),
    deliveryStopAt: null,
    raw: { synthetic: true, note: "seed-2026-05-20" }
  }
];

async function main() {
  let inserted = 0;
  let updated = 0;
  for (const record of SEED) {
    const wasInserted = await upsertAd(record);
    if (wasInserted) inserted += 1;
    else updated += 1;
    console.log(`  ${wasInserted ? "+" : "↻"} ${record.source}-${record.sourceId} (${record.advertiserName})`);
  }
  console.log(`\n✅ seed done: ${inserted} inserted, ${updated} updated, ${SEED.length} total`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ seed failed:", error);
    process.exit(1);
  });
