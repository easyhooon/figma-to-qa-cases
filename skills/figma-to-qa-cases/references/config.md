# 프로젝트 설정 `.qa-cases.json`

스킬을 쓰는 프로젝트 루트에 둔다. 프로젝트마다 다른 것(결과 엑셀 열 구성, 결정 사전 위치, 출력 폴더)만 담는다.

```json
{
  "outputDir": "qa-cases",
  "decisions": "qa-cases/decisions.md",
  "sheetName": "QA 케이스",
  "columns": [
    { "header": "TC ID", "field": "id", "width": 12 },
    { "header": "대분류", "field": "major", "width": 12 },
    { "header": "중분류", "field": "minor", "width": 14 },
    { "header": "화면/경로", "field": "screen", "width": 20 },
    { "header": "사전조건", "field": "precondition", "width": 18 },
    { "header": "테스트 절차", "field": "steps", "width": 40 },
    { "header": "기대 결과", "field": "expected", "width": 40 },
    { "header": "플랫폼", "field": "platform", "width": 8 },
    { "header": "비고", "field": "notes", "width": 36 }
  ]
}
```

| 키           | 기본값                  | 설명                                                                                          |
| ------------ | ----------------------- | --------------------------------------------------------------------------------------------- |
| `outputDir`  | `qa-cases`              | `draft.json`, 엑셀, 스냅샷 폴더가 생기는 곳                                                   |
| `decisions`  | `qa-cases/decisions.md` | 결정 사전 경로                                                                                |
| `sheetName`  | `QA 케이스`             | TC 시트 이름. 다음 단계 도구가 시트 이름으로 찾으면 맞춘다                                     |
| `columns`    | 위 예시                 | 엑셀 열 순서. 다음 단계 도구(테스트 코드 변환 등)가 읽는 템플릿과 같게 맞춘다                  |

`columns[].field` 에 쓸 수 있는 값

- 케이스 필드: `id`, `major`, `minor`, `screen`, `precondition`, `expected`, `platform`, `figmaNode`, `note`
- `steps`: 절차 배열을 `1. …` 줄바꿈으로 합친 값
- `notes`: `가정: G-01` + `Figma: <근거 위치>` + `note` 를 합친 값
- `assumptions`: 가정 공백 ID 목록
- 그 밖의 값(예: `"blank"`): 빈 칸. 다음 단계 도구가 채우는 열에 쓴다

`.gitignore` 에 `<outputDir>/*/snapshot/` 을 넣는다. 스냅샷은 비공개 기획 문서 원본이다.

예시: [`examples/playwright-e2e.qa-cases.json`](../../../examples/playwright-e2e.qa-cases.json)
