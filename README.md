# 비플페이 지도

구획 이름(도로명, 동 이름, 지명)이나 자연어로 검색하면 그 구획의 식당 지도를 만들고, 사용자들이 비플페이 가능 여부를 함께 표시하는 웹서비스입니다.

- 가능: 형광 테두리 깜빡임 / 불가능: 회색 / 미확인: 파란색
- 식당별로 최신 응답을 따르고, 모든 사용자에게 실시간으로 반영됩니다.

## 구조

```
브라우저 → Vercel(Next.js) → Supabase에 수집 요청 등록
                                  ↓
          Mac의 수집 프로그램(worker) → Aside로 네이버 지도 수집 → Supabase 저장
```

| 입력 | 구획 |
|---|---|
| 동 이름 | 네이버 지도 폴리곤 |
| 도로명 | OpenStreetMap 도로 선의 양옆 100m |
| 지명 | 그 위치가 속한 동의 네이버 지도 폴리곤 |

자연어 검색과 업종 분류는 Vercel 서버에서 Gemini API로 처리합니다.

## 설정

1. Supabase SQL Editor에서 `supabase/schema.sql`을 실행합니다.
2. `.env.example`을 `.env.local`로 복사하고 값을 채웁니다. 키는 `.env.example`에 넣지 마세요.
3. Vercel 환경 변수에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `WORKER_SECRET`을 넣습니다.
4. `.env.local`의 `SITE_URL`을 배포 주소로 바꿉니다.

## 실행

```bash
npm install
```

```bash
npm run dev
```

새 구획을 수집하려면 Mac에서 수집 프로그램을 켜 둡니다. Aside CLI가 설치되어 있고 Aside 창이 열려 있어야 합니다.

```bash
npm run worker
```

Supabase 없이 수집만 시험할 수 있습니다.

```bash
npm run collect:dry -- 을지로동
```

## 제약

- Mac과 Aside 창이 꺼져 있으면 새 구획은 대기합니다. 이미 수집한 구획은 볼 수 있습니다.
- 네이버 지도의 비공개 경로를 사용하므로 구조가 바뀌면 수집이 끊길 수 있습니다. 공개 전에 네이버 약관을 확인하세요.
- 가능/불가능 선택에는 로그인이 없습니다.
- OpenStreetMap 공식 타일 서버는 트래픽이 많은 서비스에 맞지 않습니다. `NEXT_PUBLIC_TILE_URL`로 다른 타일 제공처를 지정할 수 있습니다.
