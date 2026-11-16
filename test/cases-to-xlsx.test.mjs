import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import ExcelJS from "exceljs"

const SCRIPT = "skills/figma-to-qa-cases/scripts/cases-to-xlsx.mjs"
const FIXTURE = "test/fixtures/sample.draft.json"
const NO_CONFIG = ["--config", "/nonexistent.json"]

const tmp = () => mkdtempSync(join(tmpdir(), "qa-"))
const readSheet = async (file, name) => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const rows = []
  wb.getWorksheet(name).eachRow((r) => rows.push(r.values.slice(1).map((v) => v ?? "")))
  return rows
}
const run = (draftObj, extra = []) => {
  const dir = tmp()
  const f = join(dir, "x.draft.json")
  writeFileSync(f, JSON.stringify(draftObj))
  return spawnSync("node", [SCRIPT, f, ...NO_CONFIG, ...extra], { encoding: "utf8" })
}
const sample = () => JSON.parse(readFileSync(FIXTURE, "utf8"))

test("기본 열로 QA 케이스와 미정의 항목 시트를 만든다", async () => {
  const out = join(tmp(), "out.xlsx")
  execFileSync("node", [SCRIPT, FIXTURE, "--out", out, ...NO_CONFIG])
  const cases = await readSheet(out, "QA 케이스")
  assert.equal(cases[0][0], "TC ID")
  assert.equal(cases.length, 3)
  assert.match(String(cases[2].at(-1)), /가정: U-01/)
  const items = await readSheet(out, "미정의 항목")
  assert.equal(items[1][0], "U-01")
  assert.equal(items[1][5], "A. 빈 화면 + 안내 문구 (권장)\nB. 목록 영역 숨김\nC. 기타: (직접 작성)")
  assert.equal(items[1][11], "S-01-03-01") // 영향 TC
})

test("기획자 전달 문구에는 질문, 선택지, 기한만 들어간다", async () => {
  const out = join(tmp(), "out.xlsx")
  execFileSync("node", [SCRIPT, FIXTURE, "--out", out, ...NO_CONFIG])
  const text = (await readSheet(out, "미정의 항목"))[1][12]
  assert.equal(
    text,
    "[S-01 #3 목록] 목록이 0건이면 어떤 화면이 나오나요?\nA. 빈 화면 + 안내 문구\nB. 목록 영역 숨김\nC. 기타: (직접 작성)\n2099-12-31까지 답이 없으면 A(으)로 TC 를 작성하겠습니다. (U-01)",
  )
  assert.doesNotMatch(text, /근거|영향|권장/)
})

test("설정의 columns 순서와 빈 열, spec ID 체계를 따른다", async () => {
  const out = join(tmp(), "out.xlsx")
  execFileSync("node", [SCRIPT, "--config", "examples/playwright-e2e.qa-cases.json", FIXTURE, "--out", out])
  const cases = await readSheet(out, "QA 케이스")
  assert.deepEqual(cases[0].slice(8), ["자동화 구분", "자동화 spec", "비고"])
  assert.equal(cases[1][5], "1. 목록 진입")
  assert.equal(cases[1][8], "")
})

test("다시 만들면 이전 엑셀을 .prev.xlsx 로 남긴다", () => {
  const out = join(tmp(), "out.xlsx")
  execFileSync("node", [SCRIPT, FIXTURE, "--out", out, ...NO_CONFIG])
  execFileSync("node", [SCRIPT, FIXTURE, "--out", out, ...NO_CONFIG])
  assert.ok(existsSync(out.replace(".xlsx", ".prev.xlsx")))
})

test("기한이 지난 답 대기 항목은 기한 경과로 확정 표시한다", async () => {
  const d = sample()
  d.undefinedItems[0].deadline = "2000-01-01"
  const dir = tmp()
  const f = join(dir, "x.draft.json")
  writeFileSync(f, JSON.stringify(d))
  execFileSync("node", [SCRIPT, f, ...NO_CONFIG])
  const items = await readSheet(join(dir, "x.xlsx"), "미정의 항목")
  assert.equal(items[1][9], "기한 경과, 권장값 확정")
})

test("TC 와 연결되지 않은 사실과 미정의 항목은 실패한다", () => {
  const d = sample()
  d.cases[0].facts = []
  d.cases[1].assumptions = []
  const r = run(d)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /F-01: 이 사실을 확인하는 TC 가 없습니다/)
  assert.match(r.stderr, /U-01: 이 항목을 가정으로 쓰는 TC 가 없습니다/)
})

test("없는 미정의 항목 ID 를 가정으로 쓰면 실패한다", () => {
  const r = run({ undefinedItems: [], cases: [{ id: "X-01", expected: "a", assumptions: ["U-9"] }] })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /없는 미정의 항목 ID U-9/)
})

test("객체 값(수식, 하이퍼링크)은 거부한다", () => {
  const r = run({ cases: [{ id: "X-01", expected: { formula: 'HYPERLINK("http://x")' } }] })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /X-01: expected 는 문자열이어야 합니다/)
})

test("idScheme spec 이면 화면 ID + 주석 번호 형식을 검사한다", () => {
  const dir = tmp()
  const cfg = join(dir, "cfg.json")
  writeFileSync(cfg, JSON.stringify({ idScheme: "spec" }))
  const draft = (c) => {
    const f = join(dir, `${c.id}.draft.json`)
    writeFileSync(f, JSON.stringify({ cases: [c] }))
    return f
  }
  const ok = spawnSync("node", [SCRIPT, draft({ id: "SCR-03-08-01", screenId: "SCR-03", annotation: 8, expected: "a" }), "--config", cfg], { encoding: "utf8" })
  assert.equal(ok.status, 0, ok.stderr)
  const bad = spawnSync("node", [SCRIPT, draft({ id: "SCR-03-8-1", screenId: "SCR-03", annotation: 8, expected: "a" }), "--config", cfg], { encoding: "utf8" })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /SCR-03-08-<두 자리 순번>/)
})

test("예전 이름 gaps 도 읽는다", () => {
  const d = sample()
  d.gaps = d.undefinedItems
  delete d.undefinedItems
  assert.equal(run(d).status, 0)
})
