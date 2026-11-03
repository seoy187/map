import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const restaurantId = body?.restaurantId;
  const status = body?.status;
  if (typeof restaurantId !== "string" || !["available", "unavailable"].includes(status)) {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from("restaurant_status")
    .upsert({ restaurant_id: restaurantId, status, updated_at: new Date().toISOString() });
  if (error) {
    console.error("Status update failed:", error.message);
    return NextResponse.json({ error: "저장하지 못했어요." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
