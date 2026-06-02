# Deep Interview Spec: VOC 리포트 — CSAT 하락 원인 분석 섹션 (하이브리드 AI)

## Metadata
- Interview ID: di-csat-cause-2026-06-01
- Rounds: 9 (+ Round 0 토폴로지)
- Final Ambiguity Score: 11%
- Type: brownfield
- Generated: 2026-06-01
- Threshold: 0.2 (20%)
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.92 | 0.35 | 0.322 |
| Constraint Clarity | 0.85 | 0.25 | 0.213 |
| Success Criteria | 0.90 | 0.25 | 0.225 |
| Context Clarity | 0.87 | 0.15 | 0.131 |
| **Total Clarity** | | | **0.890** |
| **Ambiguity** | | | **0.110 (11%)** |

## Topology
| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| A. CSAT 원인 분석 섹션 (하이브리드 AI) | active | CSAT 하락 주범 태그를 코드가 집계하고, 해석 문장은 Claude AI가 작성하는 새 섹션 | 아래 Acceptance Criteria로 전부 커버 |
| B. 기존 섹션 정리 | active | 리포트를 가볍게 — 일부 기존 섹션 제거 | 카테고리별 현황·TOP5 태그 제거 / 이상 태그 알림은 유지 |

## Goal
VOC 주간 리포트를 두 갈래로 손본다.
1. **추가:** **"CSAT 원인 분석"** 섹션 신규 추가 — **숫자(주범 태그·평균 만족도·목표 미달 여부)는 Apps Script 코드가 정확히 집계**, **해석 문장은 Claude AI가 작성**하는 하이브리드 방식.
2. **정리:** **카테고리별 현황**과 **TOP 5 태그(이번 주)** 섹션은 **제거**한다. **이상 태그 알림(🔴오류/🟠급증/🔵급감/🟡신규)은 유지**, OKR 지표·CSAT 상세·인사이트도 유지.

매주 시트의 [리포트 생성] 버튼을 누르면 자동으로 반영된다.

## Constraints
- 기존 리포트 섹션·생성 흐름은 변경하지 않고, 새 섹션만 추가한다.
- 데이터 소스는 기존 `매핑결과` 시트 한 곳. 이미 "CSAT + 상담데이터 JOIN" 결과물이라 **같은 행에 `만족도`·`tags`·`mediumType`·`week`(+코멘트 컬럼) 존재** — 별도 조인 불필요.
- **주범 태그 판정 기준: 목표 만족도(4.2점) 미달 태그.** 절대 기준이라 안정적이고 OKR과 연결됨. 소표본 noise 방지를 위해 최소 응답 건수 기준을 둔다(예: N건 이상).
- **AI 연동: Claude(Anthropic) API.** Apps Script `UrlFetchApp.fetch()`로 호출, API 키는 Script Properties(또는 설정 시트)에 1회 저장. 주 1회 호출 → 비용 월 수백 원 수준.
- AI 호출 실패/타임아웃 시 리포트가 죽지 않고, 코드가 만든 규칙 기반 요약(주범 태그+점수)으로 **폴백(fallback)** 한다.
- 비개발자 운영 — 매주 [📝 VOC 주간 리포트 생성] 버튼만으로 동작, 추가 수동 작업 없음.

## Non-Goals
- AI의 **권장 액션(개선 제안)** 출력 — 이번 범위 아님 (해석+인용까지만).
- 상담사별 만족도 편차 분석 — 후순위.
- 재문의율·당일응대율 등 다른 지표의 원인 분석 — 범위 아님.
- 전화(phone) CSAT 원인 분석 — 1차는 채팅 기준(태그 중심), 전화는 데이터 있으면 포함하되 필수 아님.

## Acceptance Criteria
- [ ] 리포트에 신규 섹션 **"💬 CSAT 원인 분석"** 이 추가된다.
- [ ] **카테고리별 현황**, **TOP 5 태그(이번 주)** 섹션이 리포트에서 **제거**된다.
- [ ] **이상 태그 알림** 섹션, OKR 지표, CSAT 상세, 한 줄 인사이트는 **그대로 유지**된다.

### CSAT 원인 분석 섹션 — 3개 분석 축 (2차 인터뷰 R0~R3 확정)
- [ ] **AI 해석:** Claude가 주범 태그 + 주범 세부요소 + 코멘트를 엮어 **불릿 5줄 이내** 한국어 해석 작성. 실패 시 규칙 기반 불릿 폴백.
- [ ] **ⓐ 태그/카테고리별:** 태그별 평균 만족도 표(낮은 순, 목표 4.2점 미달 🔴), 주범 = 최소 3건 이상 + 목표 미달 최저.
- [ ] **ⓑ 세부 문항(친절/해결/속도):** 친절도=3점 이하 비율, 해결여부·대기시간=부정 응답 비율(3단계 긍/중/부정). 부정 비율 최고 요소를 🔴 주범 표시. 부정 판정은 키워드 기반 + 분포를 로그 출력(검증용).
- [ ] **ⓒ 저점수 코멘트:** 주범 태그의 3점 이하 코멘트 원문 목록(최대 3개)을 불릿으로 표시.
- [ ] **보류:** 상담사별 분석은 이번 범위에서 제외(deferred).
- [ ] **(코드/규칙)** 근거 표: `태그/카테고리 | 평균 만족도 | 응답 건수`, **평균 만족도 낮은 순** 정렬. 목표(4.2점) 미달 태그를 표시(예: 🔴 마킹).
- [ ] **(코드/규칙)** 주범 태그 = 최소 N건 이상 중 목표 미달 + 평균 만족도 최저. 판정 기준이 코드에 명시.
- [ ] **(AI)** Claude가 주범 태그 + 저점수 코멘트를 받아 **해석 문장(3줄 이내)** 을 한국어로 작성. 내용: ① 주범 태그가 왜 낮은지 해석, ② 주목할 고객 코멘트 1~2개 인용.
- [ ] AI 호출은 `UrlFetchApp`으로 Claude API를 부르고, 키는 Script Properties/설정 시트에서 읽는다.
- [ ] AI 호출 실패 시 규칙 기반 요약으로 폴백하고 리포트는 정상 생성된다 (에러로 죽지 않음).
- [ ] 해당 주차에 CSAT 응답/태그가 부족하면 "이번 주 만족도 응답 부족" 안내를 출력한다.
- [ ] 매주 [리포트 생성] 버튼만으로 자동 생성 (추가 수동 작업 없음).

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "리포트 업그레이드 = 전반 개선" | 범위를 큰 덩어리로 물음 (R0) | 기존 유지 + 새 분석/인사이트 추가로 한정 |
| "여러 지표를 두루" | 가장 답답한 결핍 1개 (R1) | "왜(원인)" 결핍 → 원인 분석 |
| "모든 지표 원인" | 어느 지표 우선 (R2) | CSAT/만족도 하락 1순위 |
| "점수만으로 원인 파악" | 코드 확인 후 단서 물음 (R3) | 코멘트·태그/카테고리·상담사 3종 존재 |
| "단서 다 넣자" | Contrarian: 하나만? (R4) | 주범 태그/카테고리 1순위, 나머지 후순위 |
| "표만 주면 됨" | 결과물 형태 (R5) | 요약 문장 + 근거 표 |
| "주범 기준 모호" | Simplifier: 비교 기준 (R6) | 목표(4.2점) 미달 절대 기준 |
| "요약은 규칙 vs AI?" | 새 갈림길 (R7) | 하이브리드 — 숫자=코드, 해석=AI |
| "어떤 AI?" | 모델·비용 (R8) | Claude(Anthropic) API, UrlFetchApp |
| "AI가 뭘 쓰나" | 합격 기준 (R9) | 주범 해석 + 코멘트 인용, 3줄 이내, 권장액션 제외 |
| "점수↔태그 조인 난이도" | 코드로 조인 키 확인 | `매핑결과`가 이미 JOIN 결과물 — 동일 행 존재 |

## Technical Context (brownfield)
- **확장 1 — `readCsatFromSheet_()` (gas/VOC_통합스크립트.gs:1161)**: 현재 `week`/`만족도`/`mediumType`만 읽음. `tags`(+코멘트) 컬럼을 추가로 읽어 **태그별 점수 합계·건수** 누적, 목표(4.2점) 미달 + 최소건수 기준으로 주범 태그 산출. 카테고리 묶음은 `buildCategorySummary_()`(line 1399) 접두어 패턴 재사용.
- **확장 2 — AI 헬퍼 신규 `callClaudeForCsatInsight_()`**: 주범 태그·점수·저점수 코멘트를 프롬프트로 조립 → `UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', ...)` 호출 → 3줄 이내 한국어 해석 수신. 키는 `PropertiesService.getScriptProperties()` 또는 설정 시트. try/catch로 실패 시 규칙 기반 문장 폴백.
- **확장 3 — `buildReportBlocks_()` (line 1309)**: ① CSAT 상세 섹션 뒤에 `heading3_('💬 CSAT 원인 분석')` + `paragraph_(AI 또는 폴백 해석문)` + `tableBlock_(['태그/카테고리','평균 만족도','건수'], rows)` 삽입. ② 기존 **카테고리별 현황 표(line 1351~1360 블록)** 와 **TOP 5 태그 표(line 1362~1372 블록)** 생성 부분을 제거. ③ **이상 태그 알림(line 1374~1388)** 과 인사이트(line 1390~1394)는 그대로 둠. 관련 헬퍼(`buildCategorySummary_`, `getTop5_`)가 다른 곳에서 안 쓰이면 정리 대상이나, `detectAnomalies`가 쓰는 집계는 유지 필요 — 제거 전 의존성 확인.
- **데이터 보장**: `매핑결과` = CSAT+상담데이터 JOIN (주석 line 10), 헤더에 `tags`·`userId` 포함 (line 67·69·239).
- 영향 범위: GAS 파일 1개(`gas/VOC_통합스크립트.gs`) + Script Properties에 API 키. `report.json`·index.html·Notion 설정 변경 불필요.
- 모델 권장: 비용 우선이면 Claude Haiku, 해석 품질 우선이면 Claude Sonnet (주 1회라 Sonnet도 부담 적음).

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| 리포트 | core domain | 주차, 섹션들 | 여러 섹션 포함 |
| 만족도(CSAT) | core domain | 점수(1~5), 채널, 주차, 태그, 코멘트 | 태그/카테고리에 귀속 |
| 원인 | core domain | 주범 태그, 평균점수, 건수, 목표미달여부 | 만족도 하락 설명 |
| 태그 | core domain | 이름, 건수, 평균 만족도 | 카테고리에 속함 |
| 카테고리 | supporting | 이름(아카데미/기관/요양/일반/오류) | 태그 그룹화 |
| 채널 | supporting | 채팅/전화(mediumType) | 만족도 출처 |
| 코멘트 | core domain (AI 입력) | 자유기입 텍스트 | 저점수 만족도에 첨부, AI가 인용 |
| AI 해석문 | core domain (신규) | 3줄 이내 텍스트 | 원인·코멘트를 입력받아 생성 |
| 상담사 | supporting (후순위) | 담당자 | 만족도 응대 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 5 | 5 | - | - | N/A |
| 2 | 6 | 1 | 1 | 4 | 83% |
| 3 | 8 | 2 | 0 | 6 | 75% |
| 4 | 8 | 0 | 0 | 8 | 100% |
| 5 | 8 | 0 | 0 | 8 | 100% |
| 6 | 8 | 0 | 0 | 8 | 100% |
| 7 | 8 | 0 | 0 | 8 | 100% |
| 8 | 8 | 0 | 0 | 8 | 100% |
| 9 | 9 | 1 (AI 해석문) | 0 | 8 | 89% |

## Interview Transcript
<details>
<summary>Full Q&A (9 rounds + Round 0)</summary>

- **R0 토폴로지:** 범위 → 새 분석/인사이트 추가 (기존 유지)
- **R1 Goal:** 가장 답답한 결핍 → 왜(원인)가 안 보임 — 62%
- **R2 Goal:** 어느 지표 우선 → CSAT/만족도 하락 — 52%
- **R3 Constraints:** 점수에 붙는 단서 → 코멘트+태그/카테고리+상담사 — 39%
- **R4 Contrarian:** 딱 하나면 → 주범 태그/카테고리 — 30%
- **R5 Criteria:** 결과물 형태 → 요약 문장 + 근거 표 — 13%
- **R6 Simplifier:** 주범 기준 → 목표(4.2점) 미달 태그 — 13%
- **R7 Constraints:** 규칙 vs AI → 하이브리드(숫자=코드, 해석=AI) — 23%
- **R8 Constraints:** 어떤 AI → Claude API — 17%
- **R9 Criteria:** AI 글 내용 → 주범 해석+코멘트 인용, 3줄 이내 — 11% ✅
</details>
