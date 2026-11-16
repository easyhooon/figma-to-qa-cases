#!/usr/bin/env node
/**
 * figma-to-qa-cases 의 draft.json 을 QA 케이스 엑셀로 만든다.
 * 열 구성은 프로젝트 설정(.qa-cases.json 의 columns)을 따른다. 없으면 기본 열을 쓴다.
 * 설정 형식은 references/config.md.
 *
 * 사용:
 *   node cases-to-xlsx.mjs <outputDir>/<이름>.draft.json [--config .qa-cases.json]   # → <outputDir>/<이름>.xlsx
 *   node cases-to-xlsx.mjs <outputDir>/<이름>.draft.json --out <경로>.xlsx
 *
 * draft.json 형식:
 * {
 *   "feature": "mission-join",
 *   "source": { "mode": "mcp" | "pdf", "ref": "Figma 링크 또는 PDF 경로", "readAt": "2026-11-16" },
 *   "gaps": [
 *     { "id": "G-01", "type": "상태 누락", "blocking": true, "frame": "12:345",
 *       "question": "목록 0건일 때 화면이 없음",
 *       "options": ["A (권장) 빈 화면 + 안내 문구", "B 목록 영역 숨김"],
 *       "recommended": "A", "basis": "D-01" | "노드 12:400" | "기존 화면 ○○",
 *       "deadline": "2026-11-20",
 *       "status": "open" | "confirmed" | "changed" | "dictionary", "answer": "(changed 일 때)" }
 *   ],
 *   "cases": [
 *     { "id": "MJ-01", "major": "미션", "minor": "참여", "screen": "/mission/:id",
 *       "precondition": "로그인", "steps": ["미션 상세 진입", "'참여하기' 탭"],
 *       "expected": "'참여 완료' 토스트 노출", "platform": "공통",
 *       "figmaNode": "12:345", "assumptions": ["G-01"], "note": "" }
 *   ]
 * }
 */
import { existsSync, readFileSync } from "node:fs"
import ExcelJS from "exceljs"

const args = process.argv.slice(2)
const FLAGS = ["--out", "--config"]
const input = args.find(
  (a, i) => !a.startsWith("--") && !FLAGS.includes(args[i - 1]),
)
const outIdx = args.indexOf("--out")
if (!input) {
  console.error("사용: node cases-to-xlsx.mjs <draft.json> [--config .qa-cases.json] [--out <xlsx>]")
  process.exit(1)
}
const out =
  outIdx >= 0
    ? args[outIdx + 1]
    : input.replace(/\.draft\.json$|\.json$/, ".xlsx")

const draft = JSON.parse(readFileSync(input, "utf8"))
const cfgIdx = args.indexOf("--config")
const cfgPath = cfgIdx >= 0 ? args[cfgIdx + 1] : ".qa-cases.json"
const config = existsSync(cfgPath)
  ? JSON.parse(readFileSync(cfgPath, "utf8"))
  : {}
const gaps = draft.gaps ?? []
const cases = draft.cases ?? []

// ── 검사: 틀린 데이터로 엑셀을 만들지 않는다 ───────────────────────────
const errors = []
const gapIds = new Set(gaps.map((g) => g.id))
const seen = new Set()
for (const c of cases) {
  if (!c.id) errors.push(`id 없는 케이스: ${JSON.stringify(c).slice(0, 60)}`)
  if (seen.has(c.id)) errors.push(`TC ID 중복: ${c.id}`)
  seen.add(c.id)
  if (!c.expected) errors.push(`${c.id}: expected(기대 결과) 없음`)
  for (const a of c.assumptions ?? []) {
    if (!gapIds.has(a))
      errors.push(`${c.id}: 없는 공백 ID ${a} 를 가정으로 참조`)
  }
}
for (const g of gaps) {
  if (!g.recommended) errors.push(`${g.id}: 권장값(recommended) 없음`)
}
if (errors.length) {
  console.error(
    "❌ draft.json 오류:\n" + errors.map((e) => "  - " + e).join("\n"),
  )
  process.exit(1)
}

// ── 엑셀 작성 ──────────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook()
const header = {
  font: { bold: true },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } },
}
const wrap = { alignment: { wrapText: true, vertical: "top" } }

// 시트 1: 프로젝트 설정의 열 구성
const DEFAULT_COLUMNS = [
  { header: "TC ID", field: "id", width: 12 },
  { header: "대분류", field: "major", width: 12 },
  { header: "중분류", field: "minor", width: 14 },
  { header: "화면/경로", field: "screen", width: 20 },
  { header: "사전조건", field: "precondition", width: 18 },
  { header: "테스트 절차", field: "steps", width: 40 },
  { header: "기대 결과", field: "expected", width: 40 },
  { header: "플랫폼", field: "platform", width: 8 },
  { header: "비고", field: "notes", width: 36 },
]
const columns = config.columns ?? DEFAULT_COLUMNS
const sheet = wb.addWorksheet(config.sheetName ?? "QA 케이스")
sheet.columns = columns.map((c) => ({ header: c.header, width: c.width ?? 16 }))
const openGaps = new Set(
  gaps.filter((g) => g.status === "open").map((g) => g.id),
)
const valueOf = (c, field) => {
  const assumptions = c.assumptions ?? []
  switch (field) {
    case "steps":
      return Array.isArray(c.steps)
        ? c.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")
        : (c.steps ?? "")
    case "notes":
      return [
        assumptions.length ? `가정: ${assumptions.join(", ")}` : "",
        c.figmaNode ? `Figma: ${c.figmaNode}` : "",
        c.note ?? "",
      ]
        .filter(Boolean)
        .join("\n")
    case "assumptions":
      return assumptions.join(", ")
    case "platform":
      return c.platform ?? "공통"
    default:
      return c[field] ?? ""
  }
}
for (const c of cases) {
  const row = sheet.addRow(columns.map((col) => valueOf(c, col.field)))
  row.eachCell((cell) => Object.assign(cell, wrap))
  // 답이 안 온 가정에 기댄 TC 는 첫 칸을 노란색으로 표시
  if ((c.assumptions ?? []).some((a) => openGaps.has(a))) {
    row.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFF2CC" },
    }
  }
}
sheet.getRow(1).eachCell((cell) => Object.assign(cell, header))
sheet.views = [{ state: "frozen", ySplit: 1 }]

// 시트 2: 기획 확인 (공백 목록)
const STATUS = {
  open: "답 대기",
  confirmed: "권장값 확정",
  changed: "변경됨",
  dictionary: "결정 사전 적용",
}
const gapSheet = wb.addWorksheet("기획 확인")
gapSheet.columns = [
  { header: "ID", width: 8 },
  { header: "구분", width: 8 },
  { header: "유형", width: 12 },
  { header: "Figma", width: 10 },
  { header: "공백 내용", width: 36 },
  { header: "선택지", width: 40 },
  { header: "권장", width: 6 },
  { header: "권장 근거", width: 20 },
  { header: "확정 기한", width: 12 },
  { header: "상태", width: 12 },
  { header: "답", width: 24 },
  { header: "영향 TC", width: 20 },
]
for (const g of gaps) {
  const affected = cases
    .filter((c) => (c.assumptions ?? []).includes(g.id))
    .map((c) => c.id)
  const row = gapSheet.addRow([
    g.id,
    g.blocking ? "차단형" : "비차단형",
    g.type,
    g.frame,
    g.question,
    (g.options ?? []).join("\n"),
    g.recommended,
    g.basis,
    g.deadline,
    STATUS[g.status] ?? g.status ?? "답 대기",
    g.answer ?? "",
    affected.join(", "),
  ])
  row.eachCell((cell) => Object.assign(cell, wrap))
}
gapSheet.getRow(1).eachCell((cell) => Object.assign(cell, header))
gapSheet.views = [{ state: "frozen", ySplit: 1 }]

await wb.xlsx.writeFile(out)

const blocking = gaps.filter((g) => g.blocking).length
const assumed = cases.filter((c) => (c.assumptions ?? []).length).length
console.log(`✅ ${out}`)
console.log(`   TC ${cases.length}개 (가정 포함 ${assumed}개)`)
console.log(
  `   공백 ${gaps.length}개: 차단형 ${blocking}, 비차단형 ${gaps.length - blocking}, 답 대기 ${openGaps.size}`,
)
