import { NextResponse } from "next/server";
import { GeminiUnavailableError, matchCategories } from "@/lib/gemini";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const want = body?.want;
  const categories = body?.categories;
  if (
    typeof want !== "string" ||
    want.length > 60 ||
    !Array.isArray(categories) ||
    categories.length > 500 ||
    !categories.every((c) => typeof c === "string" && c.length <= 60)
  ) {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  try {
    const { matches } = await matchCategories(want, categories);
    return NextResponse.json({ matches: matches.filter((m) => categories.includes(m)) });
  } catch (e) {
    if (!(e instanceof GeminiUnavailableError)) throw e;
    console.error("Gemini category match failed:", e.message);
    return NextResponse.json({ error: "자연어 필터를 잠시 쓸 수 없어요." }, { status: 503 });
  }
}
