"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CircleMarker, GeoJSON as GeoJsonLayer, Map as LeafletMap } from "leaflet";
import { supabase } from "@/lib/supabase-browser";
import type { Area, Job, PayStatus, Restaurant, SearchResponse } from "@/lib/types";

type LeafletModule = typeof import("leaflet");

const COLORS = { unknown: "#2f6fed", unavailable: "#8a8f8c", neon: "#39ff14" };
const PAGE_SIZE = 1000;

function markerStyle(status: PayStatus | undefined) {
  if (status === "available") {
    return { color: COLORS.neon, weight: 5, fillColor: COLORS.unknown, fillOpacity: 1, radius: 9, className: "marker-available" };
  }
  if (status === "unavailable") {
    return { color: "#ffffff", weight: 1.5, fillColor: COLORS.unavailable, fillOpacity: 0.95, radius: 7, className: "" };
  }
  return { color: "#ffffff", weight: 1.5, fillColor: COLORS.unknown, fillOpacity: 0.95, radius: 7, className: "" };
}

function popupContent(
  restaurant: Restaurant,
  status: PayStatus | undefined,
  onChoose: (id: string, status: PayStatus) => void,
) {
  const root = document.createElement("div");
  const name = document.createElement("div");
  name.className = "popup-name";
  name.textContent = restaurant.name;
  const meta = document.createElement("div");
  meta.className = "popup-meta";
  meta.textContent = [restaurant.category, restaurant.road_address].filter(Boolean).join(" · ");
  const buttons = document.createElement("div");
  buttons.className = "popup-buttons";
  for (const [value, label] of [["available", "비플페이 가능"], ["unavailable", "불가능"]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (status === value) button.className = `selected-${value}`;
    button.addEventListener("click", () => onChoose(restaurant.id, value));
    buttons.append(button);
  }
  root.append(name, meta, buttons);
  return root;
}

// restaurant_status는 식당 수만큼 늘어나므로 현재 구획의 식당만 나눠서 읽습니다.
async function loadStatuses(ids: string[]) {
  const result: Record<string, PayStatus> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("restaurant_status")
      .select("restaurant_id,status")
      .in("restaurant_id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const row of data) result[row.restaurant_id] = row.status as PayStatus;
  }
  return result;
}

async function loadRestaurants(areaId: string) {
  const { data, error } = await supabase
    .from("area_restaurants")
    .select("restaurants!inner(id,name,category,road_address,lng,lat,is_restaurant)")
    .eq("area_id", areaId)
    .eq("restaurants.is_restaurant", true)
    .limit(PAGE_SIZE);
  if (error) throw error;
  return data.map((row) => row.restaurants as unknown as Restaurant);
}

export default function MapApp() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const areaLayerRef = useRef<GeoJsonLayer | null>(null);
  const markersRef = useRef(new Map<string, CircleMarker>());
  const statusesRef = useRef<Record<string, PayStatus>>({});

  const [mapReady, setMapReady] = useState(false);
  const [input, setInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [statuses, setStatuses] = useState<Record<string, PayStatus>>({});
  const [want, setWant] = useState<string | null>(null);
  const [wantCategories, setWantCategories] = useState<string[] | null>(null);

  useEffect(() => {
    statusesRef.current = statuses;
  }, [statuses]);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !mapElement.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(mapElement.current, { zoomControl: false }).setView([37.5665, 126.978], 13);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer(process.env.NEXT_PUBLIC_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  const openArea = useCallback(async (areaId: string) => {
    setError(null);
    const { data, error: areaError } = await supabase
      .from("areas")
      .select("id,query,name,kind,geojson")
      .eq("id", areaId)
      .single();
    if (areaError) throw areaError;
    const list = await loadRestaurants(areaId);
    const loaded = await loadStatuses(list.map((r) => r.id));
    setArea(data as Area);
    setRestaurants(list);
    setStatuses(loaded);
  }, []);

  const choose = useCallback(async (restaurantId: string, status: PayStatus) => {
    const previous = statusesRef.current[restaurantId];
    setStatuses((current) => ({ ...current, [restaurantId]: status }));
    const res = await fetch("/api/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ restaurantId, status }),
    }).catch(() => null);
    if (!res?.ok) {
      setStatuses((current) => {
        const next = { ...current };
        if (previous) next[restaurantId] = previous;
        else delete next[restaurantId];
        return next;
      });
      setError("선택을 저장하지 못했어요. 다시 시도해 주세요.");
    }
  }, []);

  // 다른 사용자의 선택도 바로 반영합니다.
  useEffect(() => {
    const channel = supabase
      .channel("restaurant-status")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "restaurant_status" },
        (payload) => {
          const row = payload.new as { restaurant_id?: string; status?: PayStatus };
          if (row.restaurant_id && row.status) {
            setStatuses((current) => ({ ...current, [row.restaurant_id!]: row.status! }));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 수집 진행 상황은 Realtime으로 받고, 연결이 끊겨도 멈추지 않게 주기적으로도 확인합니다.
  const jobId = job?.id;
  const jobActive = job?.status === "pending" || job?.status === "running";
  useEffect(() => {
    if (!jobId || !jobActive) return;
    const apply = (next: Job) => setJob(next);
    const channel = supabase
      .channel(`job-${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "collection_jobs", filter: `id=eq.${jobId}` },
        (payload) => apply(payload.new as Job),
      )
      .subscribe();
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("collection_jobs")
        .select("id,query,status,area_id,candidates,error")
        .eq("id", jobId)
        .single();
      if (data) apply(data as Job);
    }, 5000);
    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [jobId, jobActive]);

  useEffect(() => {
    if (job?.status === "done" && job.area_id) {
      openArea(job.area_id).catch(() => setError("지도를 불러오지 못했어요."));
    }
  }, [job?.status, job?.area_id, openArea]);

  // 자연어 검색이면 구획의 업종 중 원하는 음식에 맞는 것만 남깁니다.
  useEffect(() => {
    setWantCategories(null);
    if (!want || restaurants.length === 0) return;
    const categories = [...new Set(restaurants.map((r) => r.category).filter((c): c is string => !!c))];
    let cancelled = false;
    fetch("/api/filter-categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ want, categories }),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError("음식 종류 필터를 쓸 수 없어 전체 식당을 보여드려요.");
          return;
        }
        setWantCategories((await res.json()).matches);
      })
      .catch(() => {
        if (!cancelled) setError("음식 종류 필터를 쓸 수 없어 전체 식당을 보여드려요.");
      });
    return () => {
      cancelled = true;
    };
  }, [want, restaurants]);

  const visible = useMemo(() => {
    if (!wantCategories) return restaurants;
    const allowed = new Set(wantCategories);
    return restaurants.filter((r) => r.category && allowed.has(r.category));
  }, [restaurants, wantCategories]);

  // 구획 폴리곤
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!mapReady || !L || !map) return;
    areaLayerRef.current?.remove();
    areaLayerRef.current = null;
    if (!area) return;
    const layer = L.geoJSON(area.geojson, {
      style: { color: "#0a7a4b", weight: 2, fillColor: "#0a7a4b", fillOpacity: 0.07 },
      interactive: false,
    }).addTo(map);
    areaLayerRef.current = layer;
    map.fitBounds(layer.getBounds(), { padding: [24, 24] });
  }, [area, mapReady]);

  // 식당 마커: 구획이나 필터가 바뀔 때 다시 그립니다.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!mapReady || !L || !map) return;
    const markers = markersRef.current;
    markers.forEach((marker) => marker.remove());
    markers.clear();
    for (const restaurant of visible) {
      const marker = L.circleMarker([restaurant.lat, restaurant.lng], markerStyle(statusesRef.current[restaurant.id]));
      marker.bindTooltip(restaurant.name);
      marker.bindPopup(() => popupContent(restaurant, statusesRef.current[restaurant.id], choose));
      marker.addTo(map);
      markers.set(restaurant.id, marker);
    }
  }, [visible, mapReady, choose]);

  // 상태만 바뀌면 해당 마커의 모양만 바꿉니다.
  useEffect(() => {
    const byId = new Map(restaurants.map((r) => [r.id, r]));
    markersRef.current.forEach((marker, id) => {
      const style = markerStyle(statuses[id]);
      marker.setStyle(style);
      marker.setRadius(style.radius);
      marker.getElement()?.classList.toggle("marker-available", statuses[id] === "available");
      const restaurant = byId.get(id);
      if (marker.isPopupOpen() && restaurant) {
        marker.setPopupContent(popupContent(restaurant, statuses[id], choose));
      }
    });
  }, [statuses, restaurants, choose]);

  async function search(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    setJob(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: trimmed }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "검색하지 못했어요.");
        return;
      }
      const found = body as SearchResponse;
      setWant(found.want);
      if (found.areaId) {
        await openArea(found.areaId);
      } else if (found.jobId) {
        setJob({ id: found.jobId, query: found.query, status: "pending", area_id: null, candidates: null, error: null });
      }
    } catch {
      setError("검색하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSearching(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    search(input);
  }

  return (
    <main className="app">
      <div ref={mapElement} className="map" />
      <div className="panel">
        <form className="search" onSubmit={onSubmit}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="을지로, 을지로동, 을지로 근처 한식집"
            aria-label="구획 이름 또는 찾는 식당"
            maxLength={60}
          />
          <button type="submit" disabled={searching}>
            {searching ? "검색 중" : "검색"}
          </button>
        </form>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {job?.status === "pending" && (
          <div className="notice" role="status">
            &lsquo;{job.query}&rsquo; 수집을 기다리는 중이에요. 수집 PC가 켜져 있으면 곧 시작돼요.
          </div>
        )}
        {job?.status === "running" && (
          <div className="notice" role="status">
            &lsquo;{job.query}&rsquo; 구획과 식당을 수집하고 있어요. 몇 분 걸릴 수 있어요.
          </div>
        )}
        {job?.status === "failed" && (
          <div className="notice error" role="alert">
            {job.error ?? "수집하지 못했어요."}
          </div>
        )}
        {job?.status === "needs_choice" && (
          <div className="notice">
            &lsquo;{job.query}&rsquo;이(가) 여러 지역에 있어요. 어느 곳을 찾으세요?
            <div className="choices">
              {(job.candidates ?? []).map((candidate) => (
                <button
                  type="button"
                  key={candidate}
                  onClick={() => {
                    setInput(candidate);
                    search(candidate);
                  }}
                >
                  {candidate}
                </button>
              ))}
            </div>
          </div>
        )}
        {area && (
          <div className="notice" role="status">
            <strong>{area.name}</strong> · 식당 {visible.length}곳
            {want && wantCategories && ` (${want})`}
          </div>
        )}
      </div>
      <div className="legend" aria-label="범례">
        <span><i className="dot unknown" />미확인</span>
        <span><i className="dot available" />가능</span>
        <span><i className="dot unavailable" />불가능</span>
      </div>
    </main>
  );
}
