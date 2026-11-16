# figma-to-qa-cases

Figma 기획서에서 **기획서에 정의되지 않은 동작(미정의 항목)을 권장값이 붙은 질문으로 먼저 뽑고**, 권장값을 가정으로 둔 QA 테스트 케이스 엑셀을 만드는 Claude Code 플러그인.

미정의 항목은 기획서에 적혀 있지 않아 TC 의 기대 결과를 정할 수 없는 정보다. 기획자는 알고 있지만 문서에 없는 암묵지(사람 머릿속에만 있고 문서로 남지 않은 지식)가 여기에 해당한다.

목적은 TC 작성의 사람 작업을 줄이는 것이다. 초안과 질문을 만들 뿐, 사람의 검토와 판단을 대체하지 않는다.

- 기획자는 질문에 "고르기만" 하면 된다. 맞는 선택지가 없으면 "기타"에 직접 쓴다.
- TC 작성은 답을 기다리지 않는다. 답이 오면 가정이 걸린 TC 만 고친다.
- Figma dev seat 이 없어도 쓸 수 있다. MCP 는 1회만 부르고 나머지는 Figma 에서 내보낸 PDF 로 읽는다.

## 결과물

엑셀 하나에 시트 두 개.

| 시트        | 내용                                                                     |
| ----------- | ------------------------------------------------------------------------ |
| `QA 케이스` | 테스트 케이스. 열 구성은 프로젝트 설정을 따른다. 답 대기 가정이 걸린 TC 는 노란색 |
| `미정의 항목` | 선택지, 권장값, 근거, 확정 기한, 상태, 영향 받는 TC, 기획자에게 그대로 보낼 질문 문구 |

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

쓰는 프로젝트 루트에 `.qa-cases.json` 을 둔다. 결과 엑셀 열 구성, 결정 사전 위치, 출력 폴더를 정한다. [설정 설명](skills/figma-to-qa-cases/references/config.md), [예시](examples/playwright-e2e.qa-cases.json).

## 구조

```
skills/figma-to-qa-cases/            테스트 케이스가 없는 기능의 TC 초안 만들기
  SKILL.md                           절차 (단계별 넘어가는 조건)
  references/input-modes.md          MCP, PDF 모드와 PDF 를 쓰는 이유
  references/undefined-checklist.md  미정의 항목 유형, 질문 형식
  references/config.md               프로젝트 설정
  references/decisions-template.md   결정 사전 템플릿
  scripts/figma-pdf-text.mjs         PDF 글자를 Figma 프레임 좌표로 화면별 분리, 화면 이미지, 화살표
  scripts/cases-to-xlsx.mjs          draft.json 검사 후 엑셀 생성
skills/compare-qa-cases/             만든 TC 를 기존 TC 와 비교 (검증용)
  SKILL.md
  scripts/xlsx-rows.mjs              기존 TC 엑셀 시트를 JSON 으로
```

## 상태

v0.1. 실제 서비스 기획서 섹션 1개(화면 3개)로 시범 실행했다. 기존 QA 테스트 케이스와의 비교, 2~3개 섹션 추가 실행 후 다듬어 팀 레포로 옮길 예정.

팀 레포로 옮길 때는 이 레포에서 일반 예시로 바꾼 부분(예시 설정 파일 이름과 경로, 화면 ID 예시, 시범 실행 기록의 기능 이름)을 팀 기준으로 다시 넣는다. 팀 사람이 읽을 때 자기 기획서와 바로 연결되도록 하기 위해서다.

`figma-pdf-text.mjs` 는 비공개 기획서 PDF 로만 확인해서 테스트가 없다. 공개해도 되는 Figma 샘플을 만들면 추가한다.
