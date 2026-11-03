import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const ASIDE = process.env.ASIDE_BIN || join(homedir(), ".local/bin/aside");
const RESULT_MARK = "@@RESULT@@";
const MAX_PAGES = 5;

// Aside Browser 안에서 실행되는 코드입니다. 결과는 표시 줄 뒤에 JSON으로 출력합니다.
async function repl(code) {
  const { stdout } = await run(ASIDE, ["repl", code], {
    timeout: 118_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = stdout.split("\n").find((l) => l.includes(RESULT_MARK));
  if (!line) throw new Error(`Aside returned no result: ${stdout.slice(-500)}`);
  return JSON.parse(line.slice(line.indexOf(RESULT_MARK) + RESULT_MARK.length));
}

const searchUrl = (query) =>
  `https://map.naver.com/p/search/${encodeURIComponent(query)}`;

export async function fetchPolygon(query) {
  return repl(`
    const pg = await openTab(${JSON.stringify(searchUrl(query))});
    let out = null;
    try {
      await sleep(6000);
      const data = await pg.evaluate(async () => {
        const url = performance.getEntriesByType('resource').map(e => e.name).find(u => u.includes('/p/api/polygon'));
        if (!url) return null;
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
      });
      if (data) out = { title: (await pg.title()).replace(/ - 네이버지도$/, ''), geojson: data };
    } finally { await closeTab(pg); }
    console.log(${JSON.stringify(RESULT_MARK)} + JSON.stringify(out));
  `);
}

// 첫 페이지는 내장 데이터에서, 다음 페이지는 목록의 GraphQL 응답에서 읽습니다.
export async function fetchPlaces(query) {
  return repl(`
    const pg = await openTab(${JSON.stringify(searchUrl(query))});
    let out = { places: [], blocked: false };
    try {
      await sleep(7000);
      const frame = pg.frames().find(f => /pcmap\\.place\\.naver\\.com\\/[a-z]+\\/list/.test(f.url()));
      if (!frame) {
        out.blocked = await pg.evaluate(() => /captcha|자동입력/i.test(document.body.innerText));
      } else {
        out.places = await frame.evaluate(async (maxPages) => {
          const found = new Map();
          const add = (v) => { if (v && v.id && v.x && v.y && v.name) found.set(v.id, { id: v.id, name: v.name, category: v.category ?? null, road_address: v.roadAddress ?? v.address ?? null, lng: Number(v.x), lat: Number(v.y) }); };
          const walk = (node) => {
            if (Array.isArray(node)) { node.forEach(walk); return; }
            if (node && typeof node === 'object') {
              if (node.__typename === 'PlaceListBusinessesItem') add(node);
              Object.values(node).forEach(walk);
            }
          };
          const sleepIn = (ms) => new Promise(r => setTimeout(r, ms));
          const script = [...document.scripts].map(x => x.textContent || '').find(t => t.includes('__APOLLO_STATE__')) || '';
          const start = script.indexOf('{', script.indexOf('__APOLLO_STATE__'));
          let depth = 0, inStr = false, esc = false, end = -1;
          for (let j = start; start >= 0 && j < script.length; j++) {
            const c = script[j];
            if (inStr) { if (esc) esc = false; else if (c === String.fromCharCode(92)) esc = true; else if (c === '"') inStr = false; continue; }
            if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
          }
          if (end > 0) walk(JSON.parse(script.slice(start, end + 1)));

          const realFetch = window.fetch;
          window.fetch = async (...args) => {
            const res = await realFetch(...args);
            if (String(args[0]?.url ?? args[0]).includes('graphql')) res.clone().json().then(walk).catch(() => {});
            return res;
          };
          const RealOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            if (String(url).includes('graphql')) this.addEventListener('load', () => { try { walk(JSON.parse(this.responseText)); } catch {} });
            return RealOpen.call(this, method, url, ...rest);
          };
          for (let page = 2; page <= maxPages; page++) {
            const link = [...document.querySelectorAll('a')].find(a => a.textContent.trim() === String(page));
            if (!link) break;
            link.click();
            await sleepIn(3500);
          }
          return [...found.values()];
        }, ${MAX_PAGES});
      }
    } finally { await closeTab(pg); }
    console.log(${JSON.stringify(RESULT_MARK)} + JSON.stringify(out));
  `);
}
