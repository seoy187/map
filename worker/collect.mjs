import {
  clusterCenter,
  clusterWays,
  fetchRoadWays,
  geocodePlace,
  placesInside,
  regionLabel,
  reverseGeocode,
  roadPolygon,
} from "./geo.mjs";
import { fetchPlaces, fetchPolygon } from "./naver.mjs";

// 한 번의 검색 목록에는 상한이 있어 음식 종류별로 나눠 검색합니다.
const FOOD_KEYWORDS = ["음식점", "한식", "일식", "중식", "양식", "분식", "주점"];
// Gemini를 쓸 수 없을 때도 명백한 비식당은 걸러냅니다.
const NON_RESTAURANT = /호텔|모텔|숙박|병원|의원|약국|미용|은행|마트|편의점|부동산|학원|공인중개/;

export class NeedsChoice extends Error {
  constructor(candidates) {
    super("needs choice");
    this.candidates = candidates;
  }
}

export class CollectFailed extends Error {}

async function resolveArea(query) {
  const tokens = query.split(" ");
  const last = tokens.at(-1);

  const polygon = await fetchPolygon(query);
  if (polygon) {
    return { query, name: polygon.title || query, kind: "dong", geojson: polygon.geojson, searchName: polygon.title || query };
  }

  const ways = await fetchRoadWays(last);
  if (ways.length > 0) {
    const labelled = [];
    for (const cluster of clusterWays(ways)) {
      const address = await reverseGeocode(clusterCenter(cluster));
      labelled.push({ cluster, label: regionLabel(address, last) });
    }
    const prefix = tokens.slice(0, -1);
    const matching = labelled.filter((c) => prefix.every((t) => c.label.includes(t)));
    if (matching.length > 1) throw new NeedsChoice([...new Set(matching.map((c) => c.label))]);
    if (matching.length === 1) {
      const { cluster, label } = matching[0];
      return { query, name: label, kind: "road", geojson: roadPolygon(cluster), searchName: label };
    }
  }

  // 지명은 네이버 폴리곤이 없으므로 그 위치가 속한 동의 폴리곤을 씁니다.
  const point = await geocodePlace(query);
  if (point) {
    const address = await reverseGeocode(point);
    const dong = address.suburb || address.quarter || address.neighbourhood;
    if (dong) {
      const city = address.city || address.province || "";
      const district = address.borough || address.county || "";
      const dongQuery = [city, district, dong].filter(Boolean).join(" ");
      const dongPolygon = await fetchPolygon(dongQuery);
      if (dongPolygon) {
        return { query, name: `${query} (${dong})`, kind: "place", geojson: dongPolygon.geojson, searchName: dongQuery };
      }
    }
  }
  throw new CollectFailed(`'${query}' 구획을 찾지 못했어요. 도로명이나 동 이름으로 다시 검색해 주세요.`);
}

export async function collectArea(query, { onProgress = () => {} } = {}) {
  const area = await resolveArea(query);
  onProgress(`구획 확인: ${area.name} (${area.kind})`);

  const collected = new Map();
  let failures = 0;
  for (const keyword of FOOD_KEYWORDS) {
    const { places, blocked } = await fetchPlaces(`${area.searchName} ${keyword}`).catch((e) => {
      failures += 1;
      onProgress(`'${keyword}' 수집 실패: ${e.message}`);
      return { places: [], blocked: false };
    });
    // 자동화 확인 화면이 나오면 우회하지 않고 멈춥니다.
    if (blocked) throw new CollectFailed("네이버 수집이 일시적으로 제한됐어요. 잠시 후 다시 시도해 주세요.");
    const inside = placesInside(places, area.geojson);
    for (const place of inside) collected.set(place.id, place);
    onProgress(`'${keyword}': 전체 ${places.length}곳, 구획 안 ${inside.length}곳, 누적 ${collected.size}곳`);
  }
  if (collected.size === 0 && failures > 0) {
    throw new CollectFailed("식당 정보를 수집하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }

  const restaurants = [...collected.values()].filter((r) => !NON_RESTAURANT.test(r.category ?? ""));
  return { area, restaurants };
}

export async function classify(restaurants) {
  const site = process.env.SITE_URL;
  const secret = process.env.WORKER_SECRET;
  const categories = [...new Set(restaurants.map((r) => r.category).filter(Boolean))];
  const allow = (restaurant, allowed) => !restaurant.category || allowed.has(restaurant.category);
  if (!site || !secret || categories.length === 0) return restaurants;

  const res = await fetch(`${site}/api/classify`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-secret": secret },
    body: JSON.stringify({ categories }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  // Gemini 한도를 넘겨도 수집은 계속합니다. 기본 규칙으로 걸러진 결과를 그대로 씁니다.
  if (!res?.ok) return restaurants;
  const allowed = new Set((await res.json()).restaurants);
  return restaurants.filter((r) => allow(r, allowed));
}
