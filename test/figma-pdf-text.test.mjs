import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

// 회사 기획서 PDF 는 공개 레포에 넣을 수 없어서, 가짜 메타데이터와 글자 좌표로 같은 구조를 재현한다.
// 입력 설명은 test/fixtures/figma-section/metadata.xml 맨 위 주석.
const SCRIPT = "skills/figma-to-qa-cases/scripts/figma-pdf-text.mjs"
const FIX = "test/fixtures/figma-section"

const run = () => {
  const dir = mkdtempSync(join(tmpdir(), "pdf-text-"))
  copyFileSync(join(FIX, "metadata.xml"), join(dir, "metadata.xml"))
  const stdout = execFileSync(
    "node",
    [
      SCRIPT,
      dir,
      "--bbox",
      join(FIX, "bbox.html"),
      "--section",
      "샘플 기록 (오늘)",
      "--no-images",
    ],
    { encoding: "utf8" },
  )
  const frames = JSON.parse(readFileSync(join(dir, "frames.json"), "utf8"))
  const arrows = JSON.parse(readFileSync(join(dir, "arrows.json"), "utf8"))
  return { stdout, frames, arrows }
}
const screen = (frames, label) => frames.find((f) => f.label === label)
const area = (s, kind) => s.areas.find((a) => a.kind === kind)

test("섹션과 같은 이름의 글자 노드가 아니라 섹션 프레임을 고른다", () => {
  const { stdout } = run()
  assert.match(stdout, /화면 2개/)
})

test("화면 ID 가 한 단계 깊은 바텀시트도 화면으로 찾는다", () => {
  const { frames } = run()
  assert.deepEqual(
    frames.filter((f) => f.screen).map((f) => f.label),
    ["[SCR-01]", "[SCR-02]"],
  )
})

test("화면 ID 가 없는 묶음(배너, 상태 패널)은 화면으로 세지 않는다", () => {
  const { frames, stdout } = run()
  const banner = frames.find((f) => f.name === "온보딩")
  const panel = frames.find((f) => f.name === "Frame 500")
  assert.equal(banner.screen, false)
  assert.equal(panel.screen, false)
  assert.doesNotMatch(stdout, /⚠️/) // 글자가 적은 패널은 경고하지 않는다
})

test("영역을 제목, 시안, 주석으로 나누고 글자를 맞는 영역에 붙인다", () => {
  const { frames } = run()
  for (const label of ["[SCR-01]", "[SCR-02]"]) {
    assert.deepEqual(
      screen(frames, label).areas.map((a) => a.kind),
      ["제목", "시안", "주석"],
      label,
    )
  }
  const s1 = screen(frames, "[SCR-01]")
  assert.deepEqual(area(s1, "시안").lines, ["오늘 총 섭취량", "+100ml"])
  assert.deepEqual(area(s1, "주석").lines, [
    "[증가 Button]",
    "- tap 시, 100ml 씩 증가",
  ])
  // 화면 ID 가 PDF 에서 깨져 나와도("[SCR-02 ]") 제목 영역은 메타데이터 기준으로 찾는다
  const s2 = screen(frames, "[SCR-02]")
  assert.deepEqual(area(s2, "제목").lines, [
    "샘플 수정 (바텀시트)",
    "[SCR-02 ]",
  ])
  assert.deepEqual(area(s2, "주석").lines, ["[완료 Button]"])
})

test("모든 글자가 어떤 묶음에 들어가고 프레임 밖 글자가 없다", () => {
  const { frames } = run()
  assert.deepEqual(frames.at(-1).lines, [])
})

test("직선과 ㄱ자 화살표 모두 양 끝 화면을 확정한다", () => {
  const { arrows } = run()
  assert.equal(arrows.length, 2)
  for (const a of arrows) {
    assert.equal(a.resolved, true, a.name)
    assert.equal(a.ends.length, 1, a.name)
    assert.deepEqual(
      a.ends[0].map((e) => e.split(" > ")[0]).sort(),
      ["[SCR-01]", "[SCR-02]"],
      a.name,
    )
  }
  assert.deepEqual(
    arrows.map((a) => a.shape),
    ["straight", "bent"],
  )
})
