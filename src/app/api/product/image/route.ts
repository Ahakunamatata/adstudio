import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const IMAGE_FETCH_TIMEOUT_MS = 8500;
const MAX_IMAGE_BYTES = 5_000_000;

function isPrivateIpAddress(address: string) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return false;
}

async function assertPublicImageUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported image URL.");
  if (!url.hostname || url.username || url.password) throw new Error("Invalid image URL.");
  if (/^(localhost|127\.|0\.0\.0\.0$)|\.local$/i.test(url.hostname)) throw new Error("Local image URLs are not allowed.");

  const literalIpVersion = isIP(url.hostname);
  if (literalIpVersion && isPrivateIpAddress(url.hostname)) throw new Error("Private image URLs are not allowed.");
  if (literalIpVersion) return;

  const addresses = await lookup(url.hostname, { all: true, verbatim: false });
  if (!addresses.length || addresses.some((address) => isPrivateIpAddress(address.address))) {
    throw new Error("Private image URLs are not allowed.");
  }
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const rawUrl = requestUrl.searchParams.get("url") ?? "";
    const imageUrl = new URL(rawUrl);
    await assertPublicImageUrl(imageUrl);

    if (imageUrl.hostname === "play-lh.googleusercontent.com") {
      return NextResponse.redirect(imageUrl.toString(), { status: 307 });
    }

    const response = await fetch(imageUrl.toString(), {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        referer: `${imageUrl.protocol}//${imageUrl.hostname}/`,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS)
    });

    if (!response.ok) throw new Error(`Image fetch failed: HTTP ${response.status}`);

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) throw new Error("URL is not an image.");

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_IMAGE_BYTES) throw new Error("Image is too large.");

    const imageBuffer = await response.arrayBuffer();
    if (imageBuffer.byteLength > MAX_IMAGE_BYTES) throw new Error("Image is too large.");

    return new Response(imageBuffer, {
      headers: {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "Content-Type": contentType
      }
    });
  } catch {
    return NextResponse.json({ error: "Image unavailable." }, { status: 400 });
  }
}
