import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import ExcelJS from "exceljs"

const SCRIPT = "skills/compare-qa-cases/scripts/xlsx-rows.mjs"

test("요약 표를 건너뛰고 TC ID 헤더를 찾으며, 세로 병합 칸을 채운다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rows-"))
  const file = join(dir, "tc.xlsx")
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("체크리스트")
  ws.addRow(["", "", "", "단말별 테스트결과"])
  ws.addRow(["", "", "", "수행 TC수", { formula: "1+1", result: 2 }])
  ws.addRow([])
  ws.addRow(["TC ID", "대분류", "테스트케이스 및 절차"])
  ws.addRow(["1", "기록", "수분 기록 진입"])
  ws.addRow(["2", "", "+ 버튼으로 증가"])
  ws.mergeCells("B5:B6")
  await wb.xlsx.writeFile(file)

  const out = join(dir, "rows.json")
  execFileSync("node", [SCRIPT, file, "--sheet", "체크리스트", "--out", out])
  const d = JSON.parse(readFileSync(out, "utf8"))
  assert.equal(d.headerRow, 4)
  assert.deepEqual(d.headers, ["TC ID", "대분류", "테스트케이스 및 절차"])
  assert.equal(d.rows.length, 2)
  assert.equal(d.rows[1]["대분류"], "기록")
  assert.equal(d.rows[1]._row, 6)
})
