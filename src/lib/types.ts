import type { GeoJsonObject } from "geojson";

export type PayStatus = "available" | "unavailable";

export type Area = {
  id: string;
  query: string;
  name: string;
  kind: "dong" | "road" | "place";
  geojson: GeoJsonObject;
};

export type Restaurant = {
  id: string;
  name: string;
  category: string | null;
  road_address: string | null;
  lng: number;
  lat: number;
};

export type Job = {
  id: string;
  query: string;
  status: "pending" | "running" | "done" | "failed" | "needs_choice";
  area_id: string | null;
  candidates: string[] | null;
  error: string | null;
};

export type SearchResponse = {
  areaId?: string;
  jobId?: string;
  query: string;
  want: string | null;
};
