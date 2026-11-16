#!/usr/bin/env node
/**
 * figma-to-qa-cases 의 draft.json 을 QA 케이스 엑셀로 만든다.
 * 열 구성은 프로젝트 설정(.qa-cases.json 의 columns)을 따른다. 없으면 기본 열을 쓴다. 설정 형식은 references/config.md.
 *
 * 사용:
 *   node cases-to-xlsx.mjs <outputDir>/<이름>.draft.json [--config .qa-cases.json]   # → <outputDir>/<이름>.xlsx
 *   node cases-to-xlsx.mjs <outputDir>/<이름>.draft.json --out <경로>.xlsx
 *   같은 경로에 엑셀이 있으면 <이름>.prev.xlsx 로 남기고 새로 만든다.
 *
 * draft.json 형식:
 * {
 *   "feature": "water-log",
 *   "source": { "mode": "mcp" | "pdf", "ref": "Figma 링크 또는 PDF 경로", "readAt": "2026-11-16" },
 *   "facts": [                                   // 2단계: 기획서에 적힌 사실
 *     { "id": "F-01", "where": "SCR-03 #8", "text": "tap 시 100ml 씩 증가" }
 *   ],
 *   "undefinedItems": [                          // 3단계: 미정의 항목 (예전 이름 "gaps" 도 읽는다)
 *     { "id": "U-01", "type": "경계값", "blocking": true, "where": "SCR-03 #8 +100ml 버튼",
 *       "question": "목표 도달 후 증가 버튼 동작이 정의되지 않음",            // TC 작성자용 한 줄
 *       "ask": "누적 섭취량이 목표에 도달한 뒤 +100ml 을 누르면 어떻게 되나요?", // 기획자에게 보내는 질문
 *       "options": ["계속 늘어나고 컵은 가득 찬 상태로 유지", "목표에 도달하면 버튼 비활성"],
 *       "recommended": "A", "basis": "SCR-03 주석 8" | "D-01" | "근거 없음(기획 결정 필요)",
 *       "deadline": "2026-11-20",
 *       "status": "open" | "confirmed" | "changed" | "dictionary", "answer": "(changed 일 때 실제 답)",
 *       "noCase": "(TC 와 연결하지 않는 이유, 드물게)" }
 *   ],
 *   "cases": [
 *     { "id": "SCR-03-08-01", "screenId": "SCR-03", "annotation": 8,
 *       "major": "기록", "minor": "수분 기록", "screen": "SCR-03",
 *       "precondition": "누적 0ml", "steps": ["+100ml 탭"], "expected": "'100ml' 표시", "platform": "공통",
 *       "figmaNode": "SCR-03 #8", "facts": ["F-01"], "assumptions": ["U-01"], "note": "" }
 *   ]
 * }
 * - options 에는 A, B 같은 기호와 "기타"를 넣지 않는다. 스크립트가 기호를 붙이고 마지막에 "기타: (직접 작성)"을 더한다.
 * - 사실은 하나 이상의 TC 에서 facts 로, 미정의 항목은 하나 이상의 TC 에서 assumptions 로 이어져야 한다.
 *   잇지 않을 이유가 있으면 그 항목에 noCase 로 적는다.
 * - 확정 기한이 지났는데 답이 없는 항목은 "기한 경과, 권장값 확정"으로 표시한다.
 * - idScheme 이 "spec" 이면 케이스마다 screenId, annotation 을 넣고 id 를 "<screenId>-<주석 두 자리>-<순번 두 자리>" 로 쓴다.
 */
import { copyFileSync, existsSync, readFileSync } from "node:fs"
import ExcelJS from "exceljs"

const args = process.argv.slice(2)
const FLAGS = ["--out", "--config"]
const input = args.find((a, i) => !a.startsWith("--") && !FLAGS.includes(args[i - 1]))
const opt = (k) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
if (!input) {
  console.error("사용: node cases-to-xlsx.mjs <draft.json> [--config .qa-cases.json] [--out <xlsx>]")
  process.exit(1)
}
const out = opt("--out") ?? input.replace(/\.draft\.json$|\.json$/, ".xlsx")
const cfgPath = opt("--config") ?? ".qa-cases.json"
const config = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {}

const draft = JSON.parse(readFileSync(input, "utf8"))
const items = draft.undefinedItems ?? draft.gaps ?? []
const cases = draft.cases ?? []
const facts = draft.facts ?? []

const LETTERS = "ABCDEFGH"
const today = new Date().toLocaleDateString("sv-SE") // YYYY-MM-DD, 로컬 날짜
const effectiveStatus = (u) =>
  (u.status ?? "open") === "open" && u.deadline && u.deadline < today ? "expired" : (u.status ?? "open")

// ── 검사: 틀린 데이터로 엑셀을 만들지 않는다 ───────────────────────────
const errors = []
const itemIds = new Set(items.map((u) => u.id))
const factIds = new Set(facts.map((f) => f.id))
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// 객체 값은 exceljs 가 수식이나 하이퍼링크로 넣는다({ formula }, { hyperlink }). 문자열, 숫자, 불리언과 그 배열만 허용한다.
const isPlain = (v) => v == null || ["string", "number", "boolean"].includes(typeof v)
const checkPlain = (owner, obj) => {
  for (const [k, v] of Object.entries(obj)) {
    const ok = Array.isArray(v) ? v.every(isPlain) : isPlain(v)
    if (!ok) errors.push(`${owner}: ${k} 는 문자열이어야 합니다`)
  }
}

const seen = new Set()
for (const c of cases) {
  checkPlain(c.id ?? "(id 없음)", c)
  if (!c.id) errors.push(`id 없는 케이스: ${JSON.stringify(c).slice(0, 60)}`)
  if (seen.has(c.id)) errors.push(`TC ID 중복: ${c.id}`)
  seen.add(c.id)
  if (!c.expected) errors.push(`${c.id}: expected(기대 결과) 없음`)
  if (config.idScheme === "spec") {
    const ann = String(c.annotation ?? "").padStart(2, "0")
    const re = new RegExp(`^${escapeRe(c.screenId ?? "")}-${ann}-\\d{2}$`)
    if (!c.screenId || c.annotation == null)
      errors.push(`${c.id}: idScheme "spec" 은 screenId, annotation 이 필요합니다`)
    else if (!re.test(c.id))
      errors.push(`${c.id}: TC ID 는 ${c.screenId}-${ann}-<두 자리 순번> 형식이어야 합니다`)
  }
  for (const a of c.assumptions ?? [])
    if (!itemIds.has(a)) errors.push(`${c.id}: 없는 미정의 항목 ID ${a} 를 가정으로 참조`)
  for (const f of c.facts ?? [])
    if (!factIds.has(f)) errors.push(`${c.id}: 없는 사실 ID ${f} 를 참조`)
}
for (const u of items) {
  checkPlain(u.id ?? "(id 없음)", u)
  if (!u.recommended) errors.push(`${u.id}: 권장값(recommended) 없음`)
  if (u.status !== "dictionary" && !u.ask) errors.push(`${u.id}: 기획자에게 보낼 질문(ask) 없음`)
  if (!u.noCase && !cases.some((c) => (c.assumptions ?? []).includes(u.id)))
    errors.push(`${u.id}: 이 항목을 가정으로 쓰는 TC 가 없습니다 (이유가 있으면 noCase 에 적기)`)
}
for (const f of facts) {
  checkPlain(f.id ?? "(id 없음)", f)
  if (!f.noCase && !cases.some((c) => (c.facts ?? []).includes(f.id)))
    errors.push(`${f.id}: 이 사실을 확인하는 TC 가 없습니다 (이유가 있으면 noCase 에 적기)`)
}
if (errors.length) {
  console.error("❌ draft.json 오류:\n" + errors.map((e) => "  - " + e).join("\n"))
  process.exit(1)
}

// ── 엑셀 작성 ──────────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook()
const header = {
  font: { bold: true },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } },
}
const wrap = { alignment: { wrapText: true, vertical: "top" } }
const yellow = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } }
const addRow = (ws, values) => {
  const row = ws.addRow(values.map((v) => String(v ?? "")))
  row.eachCell((cell) => Object.assign(cell, wrap))
  return row
}

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
const waiting = new Set(items.filter((u) => effectiveStatus(u) === "open").map((u) => u.id))
const valueOf = (c, field) => {
  const assumptions = c.assumptions ?? []
  switch (field) {
    case "steps":
      return Array.isArray(c.steps) ? c.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") : c.steps
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
    case "facts":
      return (c.facts ?? []).join(", ")
    case "platform":
      return c.platform ?? "공통"
    default:
      return c[field]
  }
}
for (const c of cases) {
  const row = addRow(sheet, columns.map((col) => valueOf(c, col.field)))
  // 답을 기다리는 가정에 기댄 TC 는 첫 칸을 노란색으로 표시
  if ((c.assumptions ?? []).some((a) => waiting.has(a))) row.getCell(1).fill = yellow
}
sheet.getRow(1).eachCell((cell) => Object.assign(cell, header))
sheet.views = [{ state: "frozen", ySplit: 1 }]

// 시트 2: 미정의 항목
const STATUS = {
  open: "답 대기",
  expired: "기한 경과, 권장값 확정",
  confirmed: "권장값 확정",
  changed: "변경됨",
  dictionary: "결정 사전 적용",
}
// 선택지 끝에는 늘 "기타: (직접 작성)"을 붙인다. 고른 선택지에 맞는 답이 없을 때 기획자가 직접 쓰게 하기 위해서다.
const OTHER = "기타: (직접 작성)"
const optionLines = (u, mark) => {
  const opts = (u.options ?? []).filter((o) => !/^기타\b/.test(String(o).trim()))
  return [...opts, OTHER].map(
    (o, i) => `${LETTERS[i]}. ${o}${mark && LETTERS[i] === u.recommended ? " (권장)" : ""}`,
  )
}
// 기획자에게 그대로 붙여 넣는 문구. 근거와 영향 TC 같은 작성자용 정보는 넣지 않는다.
const plannerText = (u) =>
  [
    `[${u.where ?? u.frame ?? ""}] ${u.ask}`,
    ...optionLines(u, false),
    `${u.deadline ? `${u.deadline}까지 ` : ""}답이 없으면 ${u.recommended}(으)로 TC 를 작성하겠습니다. (${u.id})`,
  ].join("\n")

const itemSheet = wb.addWorksheet("미정의 항목")
itemSheet.columns = [
  { header: "ID", width: 8 },
  { header: "구분", width: 8 },
  { header: "유형", width: 12 },
  { header: "위치", width: 16 },
  { header: "정의되지 않은 내용", width: 36 },
  { header: "선택지", width: 40 },
  { header: "권장", width: 6 },
  { header: "권장 근거", width: 20 },
  { header: "확정 기한", width: 12 },
  { header: "상태", width: 14 },
  { header: "답", width: 24 },
  { header: "영향 TC", width: 20 },
  { header: "기획자 전달 문구", width: 60 },
]
for (const u of items) {
  const affected = cases.filter((c) => (c.assumptions ?? []).includes(u.id)).map((c) => c.id)
  const status = effectiveStatus(u)
  const row = addRow(itemSheet, [
    u.id,
    u.blocking ? "차단형" : "비차단형",
    u.type,
    u.where ?? u.frame,
    u.question,
    optionLines(u, true).join("\n"),
    u.recommended,
    u.basis,
    u.deadline,
    STATUS[status] ?? status,
    u.answer,
    affected.join(", ") || (u.noCase ? `없음: ${u.noCase}` : ""),
    u.status === "dictionary" ? "" : plannerText(u),
  ])
  if (status === "open") row.getCell(1).fill = yellow
}
itemSheet.getRow(1).eachCell((cell) => Object.assign(cell, header))
itemSheet.views = [{ state: "frozen", ySplit: 1 }]

if (existsSync(out)) copyFileSync(out, out.replace(/\.xlsx$/, ".prev.xlsx"))
await wb.xlsx.writeFile(out)

const blocking = items.filter((u) => u.blocking).length
const assumed = cases.filter((c) => (c.assumptions ?? []).length).length
const waitingCases = cases.filter((c) => (c.assumptions ?? []).some((a) => waiting.has(a))).length
const expired = items.filter((u) => effectiveStatus(u) === "expired").length
console.log(`✅ ${out}`)
console.log(`   TC ${cases.length}개 (가정 포함 ${assumed}개, 그중 답 대기 ${waitingCases}개)`)
console.log(
  `   미정의 항목 ${items.length}개: 차단형 ${blocking}, 비차단형 ${items.length - blocking}, 답 대기 ${waiting.size}, 기한 경과 ${expired}`,
)
if (facts.length) console.log(`   사실 ${facts.length}개, 모두 TC 와 연결됨`)
