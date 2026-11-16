import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import ExcelJS from "exceljs"

const SCRIPT = "skills/figma-to-qa-cases/scripts/cases-to-xlsx.mjs"
const FIXTURE = "test/fixtures/sample.draft.json"

const readSheet = async (file, name) => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.getWorksheet(name)
  const rows = []
  ws.eachRow((r) => rows.push(r.values.slice(1).map((v) => v ?? "")))
  return rows
}

test("기본 열로 QA 케이스와 기획 확인 시트를 만든다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-"))
  const out = join(dir, "out.xlsx")
  execFileSync("node", [SCRIPT, FIXTURE, "--out", out, "--config", join(dir, "none.json")])
  const cases = await readSheet(out, "QA 케이스")
  assert.equal(cases[0][0], "TC ID")
  assert.equal(cases.length, 3)
  assert.match(String(cases[2].at(-1)), /가정: G-01/)
  const gaps = await readSheet(out, "기획 확인")
  assert.equal(gaps[1][0], "G-01")
  assert.equal(gaps[1].at(-1), "SP-02") // 영향 TC
})

test("설정의 columns 순서와 빈 열을 따른다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-"))
  const out = join(dir, "out.xlsx")
  execFileSync("node", [
    SCRIPT, "--config", "examples/hime.qa-cases.json", FIXTURE, "--out", out,
  ])
  const cases = await readSheet(out, "QA 케이스")
  assert.deepEqual(cases[0].slice(8), ["자동화 구분", "자동화 spec", "비고"])
  assert.equal(cases[1][5], "1. 목록 진입")
  assert.equal(cases[1][8], "")
})

test("없는 공백 ID 를 가정으로 쓰면 실패한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-"))
  const bad = join(dir, "bad.draft.json")
  writeFileSync(bad, JSON.stringify({ gaps: [], cases: [{ id: "X-01", expected: "a", assumptions: ["G-9"] }] }))
  const r = spawnSync("node", [SCRIPT, bad], { encoding: "utf8" })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /없는 공백 ID G-9/)
})

test("객체 값(수식·하이퍼링크)은 거부한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-"))
  const bad = join(dir, "bad.draft.json")
  writeFileSync(bad, JSON.stringify({
    gaps: [],
    cases: [{ id: "X-01", expected: { formula: "HYPERLINK(\"http://x\")" } }],
  }))
  const r = spawnSync("node", [SCRIPT, bad], { encoding: "utf8" })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /X-01: expected 는 문자열이어야 합니다/)
})
