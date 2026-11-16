#!/usr/bin/env node
/**
 * Figma 섹션 PDF 의 글자를 get_metadata 프레임 좌표로 화면별로 나눈다. (figma-to-qa-cases pdf 모드, references/input-modes.md 3장)
 *
 * 사용:
 *   node figma-pdf-text.mjs <snapshot 폴더> --pdf <섹션.pdf> --section "<섹션 이름 또는 노드 ID>"
 *   → <snapshot 폴더>/frames.json, arrows.json, frame-<화면 ID>.png
 *
 * 테스트용:
 *   node figma-pdf-text.mjs <폴더> --bbox <pdftotext -bbox-layout 결과.html> --section "<섹션>" --no-images
 *   PDF 대신 미리 뽑은 글자 좌표를 읽고, 이미지는 만들지 않는다(poppler 없이 돈다). test/figma-pdf-text.test.mjs 참고.
 *
 * 전제:
 * - <snapshot 폴더>/metadata.xml 은 MCP get_metadata 결과(XML) 그대로다.
 * - PDF 는 Figma 에서 그 섹션 하나를 통째로 내보낸 1쪽짜리다. Figma PDF 좌표는 섹션 좌상단 기준 1pt = 1px 이라
 *   metadata 의 섹션 기준 좌표와 그대로 맞는다.
 * - pdftotext·pdftoppm(poppler) 가 필요하다. macOS: brew install poppler
 *
 * 출력 arrows.json: [{ id, box, shape, resolved, ends: [[끝점1 위치, 끝점2 위치], ...] }] 화면 사이 화살표.
 *   resolved: true 면 양 끝 화면이 하나로 정해진 것이다. 방향은 이미지로 확인한다(출발 쪽에 점이 있다).
 * 출력 frames.json: [{ id, name, label, screen, box, image, areas: [{ id, name, box, lines: ["..."] }] }]
 * - 섹션 바로 아래 프레임 = 화면 묶음(화면 + 오른쪽 주석). 그 안의 2단계 프레임 = 영역. 영역마다 kind(제목, 시안, 주석)를 붙인다.
 * - 글자 줄은 가운데 점이 들어가는 가장 작은 영역에 붙는다. 어디에도 안 들어가면 "(프레임 밖)" 으로 모은다(화살표 라벨·분기 설명).
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const args = process.argv.slice(2)
const dir = args[0]
const opt = (k) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const pdf = opt("--pdf")
const bbox = opt("--bbox")
const noImages = args.includes("--no-images")
const section = opt("--section")
if (!dir || !(pdf || bbox) || !section || (!pdf && !noImages)) {
  console.error(
    '사용: node figma-pdf-text.mjs <snapshot 폴더> --pdf <섹션.pdf> --section "<섹션 이름 또는 노드 ID>"',
  )
  process.exit(1)
}

// ── metadata.xml: 태그 열고 닫기만 따라가는 최소 파서 ─────────────────
const xml = readFileSync(join(dir, "metadata.xml"), "utf8")
const attr = (s, k) => {
  const m = s.match(new RegExp(`\\s${k}="([^"]*)"`))
  return m ? m[1] : undefined
}
const unescape = (s) =>
  s
    ?.replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
const root = { children: [] }
const stack = [root]
for (const m of xml.matchAll(/<(\/?)([a-z-]+)([^>]*?)(\/?)>/g)) {
  const [, close, tag, rest, selfClose] = m
  if (close) {
    stack.pop()
    continue
  }
  const node = {
    tag,
    id: attr(rest, "id"),
    name: unescape(attr(rest, "name")),
    x: Number(attr(rest, "x")),
    y: Number(attr(rest, "y")),
    w: Number(attr(rest, "width")),
    h: Number(attr(rest, "height")),
    children: [],
  }
  stack.at(-1).children.push(node)
  if (!selfClose) stack.push(node)
}
// 섹션은 글자 노드가 아닌 것 중에서 찾는다. 섹션 제목 배너 안에 같은 이름의 글자 노드가 있다.
const find = (n) => {
  for (const c of n.children) {
    if (c.tag !== "text" && (c.id === section || c.name === section)) return c
    const r = find(c)
    if (r) return r
  }
}
const sec = find(root)
if (!sec) {
  console.error(`metadata.xml 에서 섹션 "${section}" 을 찾지 못했습니다.`)
  process.exit(1)
}

// 섹션 기준 절대 좌표로 펼친다
const abs = (n, ox, oy) => ({ ...n, ax: ox + n.x, ay: oy + n.y })
const groups = sec.children
  .filter(
    (c) => c.tag === "frame" || c.tag === "instance" || c.tag === "symbol",
  )
  .map((g) => {
    const G = abs(g, 0, 0)
    const isLabel = (t) =>
      t.tag === "text" && /^\[[A-Z]+-[\d-]+\]$/.test(t.name ?? "")
    // 화면 ID 글자는 묶음의 자식 프레임 아래 몇 단계 안쪽에 있을 수 있다
    // (예: 묶음 > Frame 1739347706 > Frame > [HL-02-86]). 깊이 4 까지 찾는다.
    const findLabel = (n, depth) => {
      for (const c of n.children ?? []) {
        if (isLabel(c)) return c
        if (depth > 0 && c.tag !== "text") {
          const r = findLabel(c, depth - 1)
          if (r) return r
        }
      }
    }
    const titleFrame = g.children.find(
      (c) => c.tag !== "text" && findLabel(c, 3),
    )
    const label = titleFrame && findLabel(titleFrame, 3)
    return {
      ...G,
      label: label?.name,
      titleId: titleFrame?.id,
      areas: g.children.flatMap((c) => {
        // metadata 의 x, y 는 부모 기준이다
        const C = abs(c, G.ax, G.ay)
        // 2단계(영역): 텍스트가 아닌 자식이 있으면 그 자식들(화면 이미지, 주석 패널), 없으면 자신.
        // parentId 는 묶음 바로 아래 프레임 ID 다(제목 영역 판정에 쓴다)
        const kids = (c.children ?? []).filter((k) => k.tag !== "text")
        if (!kids.length) return [{ ...C, parentId: c.id }]
        return kids.map((k) => ({ ...abs(k, C.ax, C.ay), parentId: c.id }))
      }),
    }
  })

// ── 화살표(화면 이동 표시) ───────────────────────────────────────────
// metadata 의 vector 는 상자(x, y, w, h)만 있어 선 모양과 방향을 모른다.
// - straight: 가로나 세로 직선. 양 끝이 상자 양쪽 가운데다.
// - bent: 상자가 넓고 높다. 기획서에서는 대부분 ㄱ자 꺾은선이고, 양 끝은 상자의 마주 보는 모서리 한 쌍이다.
//   두 쌍(왼쪽 위와 오른쪽 아래, 왼쪽 아래와 오른쪽 위) 중 양 끝이 모두 화면에 닿는 쌍을 고른다.
// 화살촉은 대상 화면 앞에서 끝나는 경우가 많아(체중 기록 시범에서 약 60pt), 가장 가까운 화면을 NEAR 안에서 찾는다.
// 방향(출발과 도착)은 이미지로 확인한다. 기획서에서는 출발 쪽에 점이 찍혀 있다.
const NEAR = 100
const dist = (p, b) => {
  const dx = Math.max(b.ax - p.x, 0, p.x - (b.ax + b.w))
  const dy = Math.max(b.ay - p.y, 0, p.y - (b.ay + b.h))
  return Math.hypot(dx, dy)
}
const whereIs = (p) => {
  let best = null
  for (const g of groups) {
    const d = dist(p, g)
    if (d <= NEAR && (!best || d < best.d)) best = { g, d }
  }
  if (!best) return null
  const g = best.g
  const a = g.areas
    .map((x) => ({ x, d: dist(p, x) }))
    .sort((m, n) => m.d - n.d)[0]
  return `${g.label ?? g.name}${a && a.d <= NEAR ? ` > ${a.x.name}` : ""}`
}
const arrows = []
const walkVec = (n, ox, oy) => {
  for (const c of n.children ?? []) {
    const C = abs(c, ox, oy)
    if (c.tag === "vector" && Math.max(c.w, c.h) > 40) {
      const straight = Math.min(c.w, c.h) < 4
      const L = C.ax,
        T = C.ay,
        R = C.ax + c.w,
        B = C.ay + c.h
      const pairs = straight
        ? [
            c.w >= c.h
              ? [
                  { x: L, y: T + c.h / 2 },
                  { x: R, y: T + c.h / 2 },
                ]
              : [
                  { x: L + c.w / 2, y: T },
                  { x: L + c.w / 2, y: B },
                ],
          ]
        : [
            [
              { x: L, y: T },
              { x: R, y: B },
            ],
            [
              { x: L, y: B },
              { x: R, y: T },
            ],
          ]
      const ends = pairs.map((pr) => pr.map(whereIs))
      // 양 끝이 모두 서로 다른 화면에 닿는 쌍만 후보로 남긴다. 하나만 남으면 확정이다
      const uniq = [
        ...new Map(ends.map((e) => [JSON.stringify(e), e])).values(),
      ]
      const ok = uniq.filter(
        ([a, b]) => a && b && a.split(" > ")[0] !== b.split(" > ")[0],
      )
      arrows.push({
        id: c.id,
        name: c.name,
        box: [Math.round(L), Math.round(T), Math.round(c.w), Math.round(c.h)],
        shape: straight ? "straight" : "bent",
        resolved: ok.length === 1,
        ends: ok.length ? ok : uniq,
      })
    }
    if (c.tag !== "vector") walkVec(c, C.ax, C.ay)
  }
}
walkVec(sec, 0, 0)

// ── PDF 글자 줄과 좌표 ─────────────────────────────────────────────────
// pdftotext 의 줄을 그대로 쓴다. 단어 좌표로 직접 줄을 다시 만들면 Figma 자간 때문에 띄어쓰기가 사라지고
// 주석의 글자 조각 높이가 달라 줄이 섞인다(2026-11-16 첫 시범 실행에서 확인).
const html = bbox
  ? readFileSync(bbox, "utf8")
  : execFileSync("pdftotext", ["-q", "-bbox-layout", pdf, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
const lines = []
for (const m of html.matchAll(
  /<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g,
)) {
  const words = [...m[5].matchAll(/<word[^>]*>([^<]*)<\/word>/g)].map((w) =>
    unescape(w[1]).trim(),
  )
  lines.push({
    cx: (Number(m[1]) + Number(m[3])) / 2,
    cy: (Number(m[2]) + Number(m[4])) / 2,
    y: Number(m[2]),
    x: Number(m[1]),
    text: words.filter(Boolean).join(" "),
  })
}

const inside = (l, b) =>
  l.cx >= b.ax && l.cx <= b.ax + b.w && l.cy >= b.ay && l.cy <= b.ay + b.h
const out = groups.map((g) => ({
  id: g.id,
  name: g.name,
  label: g.label,
  // 화면 ID 표시([HL-02-25] 형태)가 있는 묶음만 화면이다. 섹션 제목 배너 등은 false
  screen: Boolean(g.label),
  box: [Math.round(g.ax), Math.round(g.ay), g.w, g.h],
  image: undefined,
  areas: g.areas.map((a) => ({
    id: a.id,
    parentId: a.parentId,
    name: a.name,
    box: [Math.round(a.ax), Math.round(a.ay), a.w, a.h],
    lines: [],
  })),
  lines: [],
}))
const outside = { id: null, name: "(프레임 밖)", lines: [] }
for (const l of lines.sort((a, b) => a.y - b.y || a.x - b.x)) {
  if (!l.text) continue
  const gi = groups.findIndex((g) => inside(l, g))
  if (gi < 0) {
    outside.lines.push(l.text)
    continue
  }
  const ai = groups[gi].areas.findIndex((a) => inside(l, a))
  ;(ai >= 0 ? out[gi].areas[ai] : out[gi]).lines.push(l.text)
}

// ── 화면 묶음별 이미지 (문구를 눈으로 확인할 때 쓴다, 2배율) ─────────────
const SCALE = 2
for (const [i, g] of groups.entries()) {
  if (!g.label || noImages) continue
  const file = `frame-${(g.label ?? g.id).replace(/[^\w-]/g, "")}`
  execFileSync("pdftoppm", [
    "-q",
    "-png",
    "-singlefile",
    "-r",
    String(72 * SCALE),
    "-x",
    String(Math.round(g.ax * SCALE)),
    "-y",
    String(Math.round(g.ay * SCALE)),
    "-W",
    String(Math.round(g.w * SCALE)),
    "-H",
    String(Math.round(g.h * SCALE)),
    pdf,
    join(dir, file),
  ])
  out[i].image = `${file}.png`
}
// 영역 종류: metadata 에서 화면 ID 글자를 담은 프레임이 "제목", 남은 영역 중 가장 왼쪽이 "시안", 나머지는 "주석".
// (PDF 글자로 찾지 않는다. 화면 ID 가 "[HL-02-8 ]" 처럼 깨져 나올 수 있다)
// 기획서가 "제목 위, 시안 왼쪽, 주석 오른쪽" 배치를 쓴다는 가정이다. 배치가 다르면 kind 를 믿지 말고 이미지로 본다.
for (const [i, o] of out.entries()) {
  if (!o.screen) continue
  const titleId = groups[i].titleId
  const isTitle = (a) => a.id === titleId || a.parentId === titleId
  const rest = o.areas.filter((a) => !isTitle(a))
  const leftX = Math.min(...rest.map((a) => a.box[0]))
  for (const a of o.areas)
    a.kind = isTitle(a) ? "제목" : a.box[0] === leftX ? "시안" : "주석"
}
out.push(outside)
writeFileSync(join(dir, "frames.json"), JSON.stringify(out, null, 2))
writeFileSync(join(dir, "arrows.json"), JSON.stringify(arrows, null, 2))

const count = (o) =>
  o.lines.length + (o.areas ?? []).reduce((s, a) => s + a.lines.length, 0)
console.log(
  `✅ ${join(dir, "frames.json")}  (섹션: ${sec.name}, 글자 줄 ${lines.length}개)`,
)
const screens = out.filter((o) => o.screen)
const suspicious = out.filter((o) => o.id && !o.screen && count(o) >= 30)
console.log(
  `   화면 ${screens.length}개 (화면이 아닌 묶음 ${out.length - 1 - screens.length}개)`,
)
if (suspicious.length)
  console.log(
    `⚠️  화면 ID 를 찾지 못했는데 글자가 많은 묶음 ${suspicious.length}개: ${suspicious.map((o) => o.name).join(", ")}. metadata.xml 에서 화면 ID 위치를 확인한다`,
  )
for (const o of out)
  console.log(
    `   ${o.screen ? "" : "(화면 아님) "}${o.label ?? o.name}: ${count(o)}줄`,
  )
console.log(
  `✅ ${join(dir, "arrows.json")}  (화살표 ${arrows.length}개, 양 끝 확정 ${arrows.filter((a) => a.resolved).length}개. 방향은 이미지로 확인)`,
)
