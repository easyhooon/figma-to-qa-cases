# figma-to-qa-cases

Figma 기획서에서 **기획서에 빠진 정보(공백)를 권장값이 붙은 질문으로 먼저 뽑고**, 권장값을 가정으로 둔 QA 테스트 케이스 엑셀을 만드는 Claude Code 플러그인.

- 기획자는 질문에 "고르기만" 하면 된다. 답이 없으면 기한에 권장값으로 확정된다.
- TC 작성은 답을 기다리지 않는다. 답이 오면 가정이 걸린 TC 만 고친다.
- Figma dev seat 이 없어도 쓸 수 있다. MCP 는 1회만 부르고 나머지는 Figma 에서 내보낸 PDF 로 읽는다.

## 결과물

엑셀 하나에 시트 두 개.

| 시트        | 내용                                                                     |
| ----------- | ------------------------------------------------------------------------ |
| `QA 케이스` | 테스트 케이스. 열 구성은 프로젝트 설정을 따른다. 답 대기 가정이 걸린 TC 는 노란색 |
| `기획 확인` | 공백 질문. 선택지, 권장값, 근거, 확정 기한, 상태, 영향 받는 TC           |

## 설치

Claude Code 안에서:

```
/plugin install figma-to-qa-cases --marketplace easyhooon/figma-to-qa-cases
```

로컬에서 바로 쓰려면 이 레포를 받은 뒤 `claude --plugin-dir <레포 경로>` 로 실행한다.

필요한 것

- Node 18+, 플러그인 폴더에서 `npm install` 한 번
- PDF 모드: poppler (`brew install poppler`)
- Figma MCP 연결

## 프로젝트 설정

쓰는 프로젝트 루트에 `.qa-cases.json` 을 둔다. 결과 엑셀 열 구성, 결정 사전 위치, 출력 폴더를 정한다. [설정 설명](skills/figma-to-qa-cases/references/config.md), [예시](examples/hime.qa-cases.json).

## 구조

```
skills/figma-to-qa-cases/
  SKILL.md                    절차 (단계별 넘어가는 조건)
  references/input-modes.md   MCP·PDF 모드, PDF 를 쓰는 이유
  references/gap-checklist.md 공백 유형, 질문 형식
  references/config.md        프로젝트 설정
  references/decisions-template.md  결정 사전 템플릿
  scripts/figma-pdf-text.mjs  PDF 글자를 Figma 프레임 좌표로 화면별 분리 + 화면 이미지
  scripts/cases-to-xlsx.mjs   draft.json → 엑셀
```

## 상태

v0.1. 사내 앱 화면 1개 섹션(수분 기록)으로 시범 실행했다. 기존 QA 테스트 케이스와의 비교, 2~3개 섹션 추가 실행 후 다듬어 팀 레포로 옮길 예정.

`figma-pdf-text.mjs` 는 사내 기획서 PDF 로만 확인해서 테스트가 없다. 공개해도 되는 Figma 샘플을 만들면 추가한다.
