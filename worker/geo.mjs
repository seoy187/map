import buffer from "@turf/buffer";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";

const USER_AGENT = "map-beeple-collector/0.1 (https://github.com/seoy187/map)";
const ROAD_BUFFER_METERS = 100;
const CLUSTER_GAP_METERS = 3000;
const KOREA_BBOX = "33,124,39,132";
const OVERPASS_TIMEOUT_MS = 110_000;

function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6_371_000;
}

async function getJson(url, init, timeoutMs = 30_000) {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...init?.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.json();
}

// 한글 도로명은 큰따옴표와 역슬래시만 없으면 Overpass 문자열로 안전합니다.
export async function fetchRoadWays(name) {
  if (/["\\]/.test(name)) return [];
  const query = `[out:json][timeout:100];way["highway"]["name"="${name}"](${KOREA_BBOX});out geom;`;
  for (let attempt = 1; ; attempt++) {
    try {
      const data = await getJson(
        "https://overpass-api.de/api/interpreter",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }),
        },
        OVERPASS_TIMEOUT_MS,
      );
      return data.elements.filter((w) => w.geometry?.length >= 2);
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// 이름이 같은 도로가 서로 떨어져 있으면 다른 도로로 나눕니다.
export function clusterWays(ways) {
  const clusters = [];
  for (const way of ways) {
    const near = clusters.filter((c) =>
      c.some((other) =>
        other.geometry.some((p) => way.geometry.some((q) => distanceMeters(p, q) < CLUSTER_GAP_METERS)),
      ),
    );
    const merged = [way, ...near.flat()];
    for (const c of near) clusters.splice(clusters.indexOf(c), 1);
    clusters.push(merged);
  }
  return clusters;
}

export function clusterCenter(ways) {
  const points = ways.flatMap((w) => w.geometry);
  return points[Math.floor(points.length / 2)];
}

export async function reverseGeocode({ lat, lon }) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ko&zoom=16&lat=${lat}&lon=${lon}`;
  const data = await getJson(url);
  await new Promise((r) => setTimeout(r, 1100)); // Nominatim 사용 정책: 초당 1회
  return data.address ?? {};
}

export async function geocodePlace(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language=ko&countrycodes=kr&limit=1&q=${encodeURIComponent(query)}`;
  const data = await getJson(url);
  await new Promise((r) => setTimeout(r, 1100));
  return data[0] ? { lat: Number(data[0].lat), lon: Number(data[0].lon) } : null;
}

export function regionLabel(address, road) {
  const city = address.city || address.province || address.state || "";
  const district = address.borough || address.county || address.city_district || "";
  return [city, district, road].filter(Boolean).join(" ");
}

export function roadPolygon(ways) {
  const line = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "MultiLineString",
      coordinates: ways.map((w) => w.geometry.map((p) => [p.lon, p.lat])),
    },
  };
  const result = buffer(line, ROAD_BUFFER_METERS, { units: "meters" });
  return { type: "FeatureCollection", features: [result] };
}

export function placesInside(places, geojson) {
  const areas = (geojson.features ?? [geojson]).filter(
    (f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
  );
  return places.filter((p) =>
    areas.some((f) => booleanPointInPolygon([p.lng, p.lat], f)),
  );
}
