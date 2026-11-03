import { createClient } from "@supabase/supabase-js";
import { classify, CollectFailed, collectArea, NeedsChoice } from "./collect.mjs";

const POLL_MS = 5000;

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const updateJob = (id, fields) =>
  db.from("collection_jobs").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);

async function must(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

async function saveArea({ area, restaurants }) {
  const saved = await must(
    db
      .from("areas")
      .upsert(
        { query: area.query, name: area.name, kind: area.kind, geojson: area.geojson, collected_at: new Date().toISOString() },
        { onConflict: "query" },
      )
      .select("id")
      .single(),
  );
  if (restaurants.length > 0) {
    await must(db.from("restaurants").upsert(
      restaurants.map((r) => ({ ...r, is_restaurant: true, updated_at: new Date().toISOString() })),
    ));
    await must(db.from("area_restaurants").upsert(
      restaurants.map((r) => ({ area_id: saved.id, restaurant_id: r.id })),
    ));
  }
  return saved.id;
}

async function claimNext() {
  const pending = await must(
    db.from("collection_jobs").select("id,query").eq("status", "pending").order("created_at").limit(1),
  );
  if (pending.length === 0) return null;
  const claimed = await must(
    db
      .from("collection_jobs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", pending[0].id)
      .eq("status", "pending")
      .select("id,query"),
  );
  return claimed[0] ?? null;
}

async function processJob(job) {
  console.log(`[${job.query}] 시작`);
  try {
    const result = await collectArea(job.query, {
      onProgress: (message) => console.log(`[${job.query}] ${message}`),
    });
    result.restaurants = await classify(result.restaurants);
    const areaId = await saveArea(result);
    await must(updateJob(job.id, { status: "done", area_id: areaId }));
    console.log(`[${job.query}] 완료: ${result.restaurants.length}곳`);
  } catch (e) {
    if (e instanceof NeedsChoice) {
      await must(updateJob(job.id, { status: "needs_choice", candidates: e.candidates }));
      return;
    }
    console.error(`[${job.query}] 실패:`, e);
    const message = e instanceof CollectFailed ? e.message : "수집 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
    await must(updateJob(job.id, { status: "failed", error: message }));
  }
}

// 지난 실행이 중간에 멈춘 작업을 다시 대기열에 넣습니다.
await must(db.from("collection_jobs").update({ status: "pending" }).eq("status", "running"));
console.log("수집 프로그램 시작. Aside 창을 열어 두세요.");

for (;;) {
  try {
    const job = await claimNext();
    if (job) {
      await processJob(job);
      continue;
    }
  } catch (e) {
    console.error("대기열 확인 실패:", e.message);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
