// Supabase 없이 수집만 테스트합니다: npm run collect:dry -- 을지로
import { writeFile } from "node:fs/promises";
import { collectArea, NeedsChoice } from "./collect.mjs";

const [query, outFile] = [process.argv[2], process.argv[3]];
if (!query) {
  console.error("사용법: npm run collect:dry -- <구획 이름> [결과 파일]");
  process.exit(1);
}
try {
  const { area, restaurants } = await collectArea(query, { onProgress: console.log });
  console.log(`구획: ${area.name} (${area.kind}), 식당 ${restaurants.length}곳`);
  console.table(restaurants.slice(0, 10).map(({ name, category, road_address }) => ({ name, category, road_address })));
  if (outFile) await writeFile(outFile, JSON.stringify({ area, restaurants }));
} catch (e) {
  if (e instanceof NeedsChoice) console.log("후보:", e.candidates);
  else throw e;
}
