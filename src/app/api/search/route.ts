import { NextResponse } from "next/server";
import { GeminiUnavailableError, parseSearch } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { SearchResponse } from "@/lib/types";

const MAX_QUEUE = 20;
// "을지로", "서울 중구 을지로", "을지로동", "강남역"처럼 구획 이름만 입력한 경우
const AREA_NAME = /^[가-힣0-9]+(?: [가-힣0-9]+){0,3}$/;
const AREA_SUFFIX = /(로|길|동|가|읍|면|리|구|역)$/;

function isPlainAreaName(q: string) {
  return AREA_NAME.test(q) && AREA_SUFFIX.test(q);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const input = typeof body?.q === "string" ? body.q.trim().replace(/\s+/g, " ") : "";
  if (!input || input.length > 60) {
    return NextResponse.json({ error: "검색어를 60자 이내로 입력해 주세요." }, { status: 400 });
  }

  let area = input;
  let want: string | null = null;
  if (!isPlainAreaName(input)) {
    try {
      const parsed = await parseSearch(input);
      if (!parsed.area) {
        return NextResponse.json({ error: "지역 이름을 함께 입력해 주세요." }, { status: 400 });
      }
      area = parsed.area.trim();
      want = parsed.want?.trim() || null;
    } catch (e) {
      if (!(e instanceof GeminiUnavailableError)) throw e;
      console.error("Gemini search failed:", e.message);
      return NextResponse.json(
        { error: "자연어 검색을 잠시 쓸 수 없어요. '을지로'처럼 구획 이름으로 검색해 주세요." },
        { status: 503 },
      );
    }
  }

  const db = supabaseAdmin();
  const found = await db.from("areas").select("id").eq("query", area).maybeSingle();
  if (found.error) throw found.error;
  if (found.data) {
    return NextResponse.json<SearchResponse>({ areaId: found.data.id, query: area, want });
  }

  const active = await db
    .from("collection_jobs")
    .select("id")
    .eq("query", area)
    .in("status", ["pending", "running"])
    .maybeSingle();
  if (active.error) throw active.error;
  if (active.data) {
    return NextResponse.json<SearchResponse>({ jobId: active.data.id, query: area, want });
  }

  const queued = await db
    .from("collection_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (queued.error) throw queued.error;
  if ((queued.count ?? 0) >= MAX_QUEUE) {
    return NextResponse.json({ error: "수집 요청이 많아요. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  const job = await db.from("collection_jobs").insert({ query: area }).select("id").single();
  if (job.error) throw job.error;
  return NextResponse.json<SearchResponse>({ jobId: job.data.id, query: area, want });
}
