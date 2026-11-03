-- Supabase SQL Editor에서 한 번 실행합니다.

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  query text not null unique,
  name text not null,
  kind text not null check (kind in ('dong', 'road', 'place')),
  geojson jsonb not null,
  collected_at timestamptz not null default now()
);

create table public.restaurants (
  id text primary key,
  name text not null,
  category text,
  road_address text,
  lng double precision not null,
  lat double precision not null,
  is_restaurant boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.area_restaurants (
  area_id uuid not null references public.areas (id) on delete cascade,
  restaurant_id text not null references public.restaurants (id) on delete cascade,
  primary key (area_id, restaurant_id)
);

-- 식당당 한 행만 두어 최신 응답이 이전 응답을 덮어씁니다.
create table public.restaurant_status (
  restaurant_id text primary key references public.restaurants (id) on delete cascade,
  status text not null check (status in ('available', 'unavailable')),
  updated_at timestamptz not null default now()
);

create table public.collection_jobs (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'needs_choice')),
  area_id uuid references public.areas (id) on delete set null,
  candidates jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index collection_jobs_one_active_per_query
  on public.collection_jobs (query)
  where status in ('pending', 'running');

create index collection_jobs_pending on public.collection_jobs (created_at)
  where status = 'pending';

-- 누구나 읽을 수 있고, 쓰기는 서버(service role)만 합니다.
alter table public.areas enable row level security;
alter table public.restaurants enable row level security;
alter table public.area_restaurants enable row level security;
alter table public.restaurant_status enable row level security;
alter table public.collection_jobs enable row level security;

create policy "public read" on public.areas for select using (true);
create policy "public read" on public.restaurants for select using (true);
create policy "public read" on public.area_restaurants for select using (true);
create policy "public read" on public.restaurant_status for select using (true);
create policy "public read" on public.collection_jobs for select using (true);

alter publication supabase_realtime add table public.restaurant_status;
alter publication supabase_realtime add table public.collection_jobs;
