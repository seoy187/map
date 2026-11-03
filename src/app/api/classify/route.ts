import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { classifyCategories, GeminiUnavailableError } from "@/lib/gemini";

function authorized(req: Request) {
  const secret = process.env.WORKER_SECRET;
  const given = req.headers.get("x-worker-secret");
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 수집 프로그램 전용: 업종 목록 중 식당에 해당하는 것을 돌려줍니다.
export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const categories = body?.categories;
  if (!Array.isArray(categories) || !categories.every((c) => typeof c === "string")) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  try {
    const { restaurants } = await classifyCategories(categories);
    return NextResponse.json({ restaurants });
  } catch (e) {
    if (!(e instanceof GeminiUnavailableError)) throw e;
    console.error("Gemini classify failed:", e.message);
    return NextResponse.json({ error: "classifier unavailable" }, { status: 503 });
  }
}
