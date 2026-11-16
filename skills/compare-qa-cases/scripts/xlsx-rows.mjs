#!/usr/bin/env node
/**
 * 기존 QA 테스트 케이스 엑셀의 한 시트를 JSON 행 목록으로 바꾼다. (compare-qa-cases 1단계)
 *
 * 사용:
 *   node xlsx-rows.mjs <엑셀> --sheet "<시트 이름>" [--header-row N] [--out rows.json]
 *
 * 출력: { "sheet", "headerRow", "headers": [...], "rows": [{ "_row": 엑셀 행 번호, "<헤더>": 값 }] }
 * - 헤더 행을 주지 않으면 상위 30행 중 "TC ID" 또는 "ID" 가 들어간 첫 행, 없으면 글자 칸이 가장 많은 행으로 정한다.
 *   (QA 시트는 위쪽에 요약 표가 있는 경우가 많다)
 * - 세로 병합 셀은 위 값을 아래 행에 채운다(대분류 병합).
 * - 수식 칸은 계산 결과, 서식 있는 글자는 글자만 쓴다.
 * - 값이 모두 빈 행은 버린다.
 */
import { writeFileSync } from "node:fs"
import ExcelJS from "exceljs"

const args = process.argv.slice(2)
const opt = (k) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const FLAGS = ["--sheet", "--header-row", "--out"]
const file = args.find((a, i) => !a.startsWith("--") && !FLAGS.includes(args[i - 1]))
const sheetName = opt("--sheet")
if (!file || !sheetName) {
  console.error('사용: node xlsx-rows.mjs <엑셀> --sheet "<시트 이름>" [--header-row N] [--out rows.json]')
  process.exit(1)
}

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(file)
const ws = wb.getWorksheet(sheetName)
if (!ws) {
  console.error(`시트 "${sheetName}" 이 없습니다. 있는 시트: ${wb.worksheets.map((w) => w.name).join(", ")}`)
  process.exit(1)
}

const text = (v) => {
  if (v == null) return ""
  if (typeof v !== "object") return String(v).trim()
  if (v.richText) return v.richText.map((t) => t.text).join("").trim()
  if ("result" in v) return text(v.result)
  if (v.text != null) return text(v.text)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return ""
}
// 병합 셀은 왼쪽 위 칸(master)의 값을 쓴다
const cellText = (cell) => text(cell.isMerged ? cell.master.value : cell.value)

const lastCol = ws.columnCount
const rowValues = (r) => {
  const row = ws.getRow(r)
  return Array.from({ length: lastCol }, (_, i) => cellText(row.getCell(i + 1)))
}

let headerRow = Number(opt("--header-row")) || 0
if (!headerRow) {
  const limit = Math.min(30, ws.rowCount)
  let best = 0
  let bestCount = 0
  for (let r = 1; r <= limit; r++) {
    const vals = rowValues(r)
    if (vals.some((v) => /^(TC\s*ID|ID|No\.?)$/i.test(v))) {
      best = r
      break
    }
    const count = vals.filter((v) => v && Number.isNaN(Number(v))).length
    if (count > bestCount) [best, bestCount] = [r, count]
  }
  headerRow = best
}

const seen = {}
const headers = rowValues(headerRow).map((h, i) => {
  const name = h || `열${i + 1}`
  seen[name] = (seen[name] ?? 0) + 1
  return seen[name] > 1 ? `${name}_${seen[name]}` : name
})

const rows = []
for (let r = headerRow + 1; r <= ws.rowCount; r++) {
  const vals = rowValues(r)
  if (vals.every((v) => !v)) continue
  const obj = { _row: r }
  headers.forEach((h, i) => {
    if (vals[i]) obj[h] = vals[i]
  })
  rows.push(obj)
}

const out = { sheet: sheetName, headerRow, headers: headers.filter((h) => !/^열\d+$/.test(h)), rows }
const outPath = opt("--out")
if (outPath) {
  writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(`✅ ${outPath}  (헤더 ${headerRow}행, 데이터 ${rows.length}행)`)
  console.log(`   헤더: ${out.headers.join(" | ")}`)
} else {
  console.log(JSON.stringify(out, null, 2))
}
