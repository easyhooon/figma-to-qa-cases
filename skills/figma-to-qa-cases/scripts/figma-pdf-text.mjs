#!/usr/bin/env node
/**
 * Figma 섹션 PDF 의 글자를 get_metadata 프레임 좌표로 화면별로 나눈다. (figma-to-qa-cases pdf 모드, references/input-modes.md 3장)
 *
 * 사용:
 *   node figma-pdf-text.mjs <snapshot 폴더> --pdf <섹션.pdf> --section "<섹션 이름 또는 노드 ID>"
 *   → <snapshot 폴더>/frames.json
 *
 * 전제:
 * - <snapshot 폴더>/metadata.xml 은 MCP get_metadata 결과(XML) 그대로다.
 * - PDF 는 Figma 에서 그 섹션 하나를 통째로 내보낸 1쪽짜리다. Figma PDF 좌표는 섹션 좌상단 기준 1pt = 1px 이라
 *   metadata 의 섹션 기준 좌표와 그대로 맞는다.
 * - pdftotext·pdftoppm(poppler) 가 필요하다. macOS: brew install poppler
 *
 * 출력 arrows.json: [{ id, box, certain, ends: [[끝점1 위치, 끝점2 위치], ...] }] 화면 사이 화살표. 방향은 이미지로 확인한다.
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
const section = opt("--section")
if (!dir || !pdf || !section) {
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
const find = (n) => {
  for (const c of n.children) {
    if (c.id === section || c.name === section) return c
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
    const titleFrame = g.children.find((c) => (c.children ?? []).some(isLabel))
    const label = titleFrame?.children.find(isLabel)
    return {
      ...G,
      label: label?.name,
      titleId: titleFrame?.id,
      areas: g.children.flatMap((c) => {
        // metadata 의 x, y 는 부모 기준이다
        const C = abs(c, G.ax, G.ay)
        // 2단계(영역): 텍스트가 아닌 자식이 있으면 그 자식들(화면 이미지·주석 패널), 없으면 자신
        const kids = (c.children ?? []).filter((k) => k.tag !== "text")
        if (!kids.length) return [C]
        return kids.map((k) => abs(k, C.ax, C.ay))
      }),
    }
  })

// ── 화살표(화면 이동 표시) ───────────────────────────────────────────
// metadata 의 vector 는 상자(x, y, w, h)만 있어 방향을 모른다. 양 끝점이 들어가는 화면·영역을 ends 로 준다.
// 가로·세로 선은 양 끝이 분명하다. 대각선은 상자 모서리 두 쌍 중 어느 쪽인지 몰라 certain: false 로 둔다.
const TOL = 12
const near = (p, b) =>
  p.x >= b.ax - TOL &&
  p.x <= b.ax + b.w + TOL &&
  p.y >= b.ay - TOL &&
  p.y <= b.ay + b.h + TOL
const whereIs = (p) => {
  for (const g of groups) {
    if (!near(p, g)) continue
    const a = g.areas.find((x) => near(p, x))
    return `${g.label ?? g.name}${a ? ` > ${a.name}` : ""}`
  }
  return null
}
const arrows = []
const walkVec = (n, ox, oy) => {
  for (const c of n.children ?? []) {
    const C = abs(c, ox, oy)
    if (c.tag === "vector" && Math.max(c.w, c.h) > 40) {
      const flat = Math.min(c.w, c.h) < 4
      const pairs = flat
        ? [
            c.w >= c.h
              ? [
                  { x: C.ax, y: C.ay + c.h / 2 },
                  { x: C.ax + c.w, y: C.ay + c.h / 2 },
                ]
              : [
                  { x: C.ax + c.w / 2, y: C.ay },
                  { x: C.ax + c.w / 2, y: C.ay + c.h },
                ],
          ]
        : [
            [
              { x: C.ax, y: C.ay },
              { x: C.ax + c.w, y: C.ay + c.h },
            ],
            [
              { x: C.ax, y: C.ay + c.h },
              { x: C.ax + c.w, y: C.ay },
            ],
          ]
      arrows.push({
        id: c.id,
        name: c.name,
        box: [
          Math.round(C.ax),
          Math.round(C.ay),
          Math.round(c.w),
          Math.round(c.h),
        ],
        certain: flat,
        ends: pairs.map((pr) => pr.map(whereIs)),
      })
    }
    if (c.tag !== "vector") walkVec(c, C.ax, C.ay)
  }
}
walkVec(sec, 0, 0)

// ── PDF 글자 줄과 좌표 ─────────────────────────────────────────────────
// pdftotext 의 줄을 그대로 쓴다. 단어 좌표로 직접 줄을 다시 만들면 Figma 자간 때문에 띄어쓰기가 사라지고
// 주석의 글자 조각 높이가 달라 줄이 섞인다(2026-11-16 첫 시범 실행에서 확인).
const html = execFileSync("pdftotext", ["-q", "-bbox-layout", pdf, "-"], {
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
  if (!g.label) continue
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
  const rest = o.areas.filter((a) => a.id !== titleId)
  const leftX = Math.min(...rest.map((a) => a.box[0]))
  for (const a of o.areas)
    a.kind = a.id === titleId ? "제목" : a.box[0] === leftX ? "시안" : "주석"
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
console.log(
  `   화면 ${screens.length}개 (화면이 아닌 묶음 ${out.length - 1 - screens.length}개)`,
)
for (const o of out)
  console.log(
    `   ${o.screen ? "" : "(화면 아님) "}${o.label ?? o.name}: ${count(o)}줄`,
  )
console.log(
  `✅ ${join(dir, "arrows.json")}  (화살표 ${arrows.length}개, 방향 모름. 대각선 ${arrows.filter((a) => !a.certain).length}개는 끝점 후보 2쌍)`,
)
