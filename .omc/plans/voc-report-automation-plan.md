# VOC 주간 리포트 자동화 — 구현 계획

- **Plan ID:** voc-report-automation
- **Mode:** RALPLAN Consensus (SHORT)
- **Source Spec:** `.omc/specs/deep-interview-voc-report-automation.md` (Ambiguity 15%, PASSED)
- **Owner:** 은주 (CX Manager, 비개발자)
- **Implementer:** 개발자(외주/내부) 또는 Claude Code executor
- **Created:** 2026-05-18

---

## 1. 한눈에 보기 (Why / What)

매주 VOC 리포트를 만들려면 은주가 (1) ChannelTalk에서 데이터 확인 → (2) GAS 실행 → (3) Claude에 붙여넣기 → (4) Notion에 정리하는 4단계 수작업을 반복하고 있다. CSAT·당일응대율 입력은 사람이 판단해야 하지만, 나머지 단계는 자동화할 수 있다.

**목표 동선:**
> Google Sheets `주간입력` 시트에 CSAT·당일응대율 입력 → **[리포트 생성] 버튼 클릭** → Notion에 OKR/CSAT/태그 분석이 포함된 완성 리포트 페이지 생성.

---

## 2. RALPLAN-DR Summary

### 2.1 Principles (5)
1. **수작업 최소화, 단 판단은 사람이** — CSAT·당일응대율은 사람이 입력, 계산·포맷팅은 GAS가.
2. **기존 자산 재활용** — GAS의 ChannelTalk 수집·`report.json`·`/voc-report` 스킬 로직을 그대로 이식.
3. **비개발자가 1년 뒤에도 고칠 수 있게** — Sheets 셀로 모든 설정값 외부화 (OKR 목표, Notion 페이지 ID 등).
4. **변경 영향 최소** — `dashboard/index.html`은 손대지 않는다. (Non-Goal 준수)
5. **실패 시 사람이 알아챌 수 있게** — Notion 업로드 실패 시 Sheets 셀 또는 토스트로 에러 메시지 노출.

### 2.2 Decision Drivers (Top 3)
| 우선순위 | 드라이버 | 이유 |
|----------|----------|------|
| **1** | **운영 안정성** | 주 1회 사용, 실패하면 그 주 리포트 자체가 막힘. 디버깅이 비개발자에게 어려움. |
| **2** | **유지보수성** | OKR 목표값은 분기마다 바뀜. 코드 수정 없이 셀 편집으로 끝나야 함. |
| **3** | **구현 단순성** | 은주가 비개발자이므로 외부 라이브러리·DB·서버 추가 없이 GAS만으로 완결. |

### 2.3 Viable Options

#### Option A — **GAS-Only 자동화 (권장)**
GAS 스크립트가 Sheets 셀을 직접 읽고 Notion API를 호출. Sheets에 버튼만 배치.

- **Pros**
  - 인프라 추가 0 (현재 GAS·Sheets·Notion만 사용)
  - 비개발자가 셀 편집으로 모든 설정 변경 가능
  - 트리거가 명확 (Sheets 버튼 = onClick)
  - 기존 `report.json` 수집 로직과 같은 GAS 프로젝트에 합쳐 단일 자산 관리
- **Cons**
  - GAS 6분 실행 제한 (현재 리포트 규모로는 안전, 단 향후 데이터 증가 시 부담)
  - GAS 로컬 디버깅 불편 (Stackdriver 로그 의존)

#### Option B — **GAS + Claude Code 하이브리드**
GAS는 데이터만 정리해 Sheets에 적재, 은주가 `/voc-report` 슬래시 명령으로 Claude Code에서 Notion 업로드.

- **Pros**
  - 텍스트 가공·요약(한 줄 인사이트)을 Claude가 자연어로 잘함
  - GAS에서 Notion API 인증 토큰 관리 부담 없음
- **Cons**
  - "버튼 1번 클릭"이라는 **제약 1번** 위반 — 은주가 터미널을 열어야 함
  - 자동화 효과가 반감 (지금과 거의 같은 흐름)
  - **Constraint 위반으로 invalid에 가까움**

#### Option C — **Sheets 수식 + Apps Script Trigger**
시간 기반 트리거(매주 월요일 9시)로 자동 실행. 버튼 없음.

- **Pros**
  - 완전 자동
- **Cons**
  - **Non-Goal 위반** ("완전 자동화 아님, 스케줄러 없음")
  - 은주가 CSAT 입력하기 전에 실행되면 빈 리포트 생성됨
  - **Constraint 위반으로 invalid**

#### Option D — **Notion Database Row 추가 방식**
Notion에 "주간 VOC 리포트" Database를 만들고, GAS가 매주 1행씩 추가. 각 컬럼이 OKR/CSAT/카테고리 지표.

- **Pros**
  - 시계열 비교가 Notion에서 한눈에 가능 (필터/정렬)
  - 페이지 본문 빌더가 단순 (row property 채우기만)
- **Cons**
  - **리포트 가독성 저하** — 카테고리 현황/TOP5 태그/이상 태그 알림처럼 **블록 본문**으로 표현해야 하는 자유 형식 콘텐츠를 row property에 욱여넣을 수 없음
  - 기존 Notion 리포트가 **페이지 단위**로 운영되고 있어 마이그레이션 필요 (Non-Goal: "기존 Notion 운영 흐름 유지")
  - Database row property는 텍스트 길이 제한·블록 미지원 → "이상 태그 알림 5개" 같은 멀티라인 블록 표현 불가
  - Database 구조 변경은 비개발자가 더 어려움 (스키마 = 코드)
  - **Invalidation:** 리포트 콘텐츠가 단순 지표 5~10개라면 적합하지만, 본 spec은 **6개 섹션·다층 블록**을 요구 → Database row로는 표현 불가능.

### 2.4 권장 선택과 invalidation
**Option A 선정.** Option B/C/D는 Constraint/Non-Goal에 직접 위배되어 부적합. Option A는 5개 Principles와 3개 Driver 모두에 가장 잘 부합.

---

## 3. 아키텍처 개요

```
┌──────────────────────────────┐
│  Google Sheets               │
│  ├─ [OKR목표] 시트            │  ← 분기 1회 수정
│  │   B2: 상담만족도 목표 (4.2) │
│  │   B3: 재문의율 목표 (3.5%)  │
│  │   B4: 당일응대율 목표 (96%) │
│  ├─ [주간입력] 시트           │  ← 매주 1회 입력
│  │   주차, 채팅평균, 채팅분포  │
│  │   전화평균, 전화분포        │
│  │   당일응대율, 처리건수      │
│  │   [▶ 리포트 생성] 버튼     │
│  └─ [설정] 시트               │  ← 1회 설정
│      Notion 페이지 ID         │
│      Notion 토큰              │
└────────────┬─────────────────┘
             │ onClick
             ▼
┌──────────────────────────────┐
│  Google Apps Script          │
│  1. Sheets 셀 읽기            │
│  2. report.json 데이터 결합   │
│  3. 카테고리/TOP5/이상태그 계산│
│  4. OKR 비교 테이블 생성      │
│  5. Notion API 호출           │
│  6. 결과 셀에 URL/에러 출력   │
└────────────┬─────────────────┘
             ▼
┌──────────────────────────────┐
│  Notion                      │
│  parent: 34972773c36380...   │
│  └─ "26년 5월 18일 VOC 리포트" │
└──────────────────────────────┘
```

---

## 4. 구현 단계 (5 Steps)

### Step 1 — Google Sheets 구조 만들기
**Owner:** 은주(수동) 또는 개발자가 1회 셋업

**작업 내역:**
1. 기존 GAS 프로젝트가 연결된 스프레드시트에 시트 3개 추가:
   - `OKR목표` — A열 라벨, B열 값. B2 만족도(4.2), B3 재문의율(3.5), B4 당일응대율(96)
   - `주간입력` — 헤더: `주차 | 채팅평균 | 채팅_1점 | 채팅_2점 | 채팅_3점 | 채팅_4점 | 채팅_5점 | 전화평균 | 전화_1점 | ... | 전화_5점 | 당일응대율 | 처리건수 | 생성결과(URL/에러)`. 가장 최근 주차가 1행 아래에 입력되도록 가이드.
   - `설정` — A1=`NOTION_PAGE_ID`, B1=`34972773c36380e18445e03264de9caa` / A2=`NOTION_TOKEN`, B2=(은주가 비공개로 입력) — **단, 토큰은 Apps Script Properties에 두는 것을 우선 권장** (4-1 참조). / A3=`인사이트_활성화`, B3=`FALSE` (V7 통과 후 TRUE로 전환, 3-6 참조). / A4=`검증결과`, B4=(V6 diff 로그 저장용, 5-2 참조).
2. `주간입력` 시트에 **그림 버튼**을 삽입 → 스크립트에 `generateWeeklyReport` 함수 할당.

**Acceptance:**
- [ ] 3개 시트가 만들어졌고 헤더 행이 정확히 입력되어 있다.
- [ ] `주간입력` 시트의 버튼을 클릭하면 권한 요청 대화상자가 한 번만 뜨고 함수가 실행된다.
- [ ] **O3 결정 반영:** `주간입력` 시트의 주차 라벨 형식이 `report.json`의 주차 키와 동일하게 표준화되었다 (예: `26년 5월 11일~5월 17일` 또는 `2026-W20` 중 택1, 양쪽 동일). 형식 미일치 시 Step 2에서 매칭 실패 → 어떤 형식으로 통일했는지 `설정` 시트 비고 셀에 명시.

---

### Step 2 — GAS: 입력 데이터 읽기 + 검증 모듈
**Owner:** 개발자/executor

**파일:** GAS 프로젝트 신규 파일 `WeeklyReport.gs`

**작업 내역:**
1. `readWeeklyInputs_(sheet)` — `주간입력` 시트의 마지막 행을 읽어 객체 반환.
2. `readOkrTargets_(sheet)` — `OKR목표` 시트 B2~B4 읽기.
3. `readReportJson_()` — **동일 GAS 프로젝트 내** 기존 `report.json` 생성 함수(예: `buildReportJsonObject_()` 등)를 **in-memory로 직접 호출**해 JS 객체로 받음. `weeks[0]`(이번주)·`weeks[1]`(전주) 슬라이스만 추출.
   - **금지:** GitHub Raw URL `fetch` (예: `https://raw.githubusercontent.com/.../report.json`)를 통한 재다운로드는 절대 사용하지 않는다 (네트워크 의존·지연·publish 시점 race condition 발생). 같은 GAS 프로젝트에 코드가 있으므로 함수 호출이 정답.
   - 기존 수집 함수가 파일 출력만 하고 객체 반환이 없는 경우, 해당 함수를 "객체 반환 + 옵션으로 파일 출력" 시그니처로 살짝 리팩토링한다.
4. 입력 검증:
   - 채팅/전화 평균이 0~5 범위인지
   - 점수 분포 합 ≥ 1인지
   - 당일응대율이 0~100인지
   - `weeks[0]`과 `weeks[1]` 존재 여부
5. 검증 실패 시 한국어 에러 메시지를 `주간입력` 시트의 `생성결과` 셀에 기록하고 종료.

**Acceptance:**
- [ ] 유효한 데이터를 넣었을 때 객체로 잘 정리되어 다음 단계로 전달된다.
- [ ] CSAT 점수 분포가 비어있으면 "채팅/전화 점수 분포가 비어있어요. 1~5점 칸을 채워주세요"라고 셀에 한국어 메시지가 표시된다.

---

### Step 3 — GAS: 리포트 본문 빌더 (기존 로직 이식)
**Owner:** 개발자/executor

**파일:** `WeeklyReport.gs` 내 `buildReportBlocks_(inputs, okr, report)` 함수. 분류 규칙은 별도 파일 `Categorizer.gs`로 분리 (Step 5 F1 SSOT 승격, 5번 항목 참조).

**작업 내역:**
1. **OKR 지표 표** 빌더 — `실적 / 목표 (전주)` 4행 (만족도/재문의율/당일응대율/처리건수). 처리건수 증감 %는 `(이번주 - 전주) / 전주 * 100` 계산.
2. **CSAT 상세** 블록 — 채팅·전화 평균 + 점수 분포 (`1점 N건 / 2점 N건 ...`). 분포 0 건인 점수는 생략.
3. **카테고리별 현황** — `Categorizer.gs`의 `categorize(tag)` 함수 호출(아카데미/기관/요양/일반/오류). `weeks[0]`, `weeks[1]` 비교. `/voc-report` 스킬과 동일 규칙을 단일 파일로 통합.
4. **TOP 5 태그** — 아카데미/기관/요양 카테고리만, 카테고리별 각 TOP 5.
5. **이상 태그 알림** — 🔴오류 / 🟠급증(+30%, +3건) / 🔵급감(-30%, -3건) / 🟡신규. 기존 `weekly-report.md`/`voc-report.md` 규칙 그대로.
6. **한 줄 인사이트** — `설정` 시트 `인사이트_활성화` 셀(B3)이 `TRUE`일 때만 알고리즘 기반(가장 큰 증감 카테고리 + 가장 큰 이상 태그) 1문장 자동 생성. **초기 배포 시 FALSE로 두고 빌더에서 해당 섹션 자체를 건너뛴다.** V7(은주 수용 테스트) 통과 후 TRUE로 전환. AI 호출은 하지 않음 (GAS 환경 제약).
7. 모든 결과를 **Notion blocks 배열**(`heading_2`, `table`, `paragraph`, `bulleted_list_item`)로 변환.

**Acceptance:**
- [ ] OKR 표가 `실적 / 목표 (전주)` 형식으로 정확히 생성된다 (예: `3.72 / 4.2 (전주 3.73)`).
- [ ] 처리건수 증감 %가 spec 예시(`868 → 1057건 +39.3%`)와 동일하게 계산된다 (소수점 1자리 반올림).
- [ ] 카테고리별 현황·TOP5·이상 태그 알림이 기존 Notion 리포트와 같은 형태로 나온다.
- [ ] `인사이트_활성화 = FALSE` 상태에서는 "한 줄 인사이트" 섹션이 Notion 페이지에 **존재하지 않는다** (heading조차 출력되지 않음).
- [ ] 분류 로직은 `Categorizer.gs`에만 존재하고 `WeeklyReport.gs`에서는 `categorize()` 함수만 호출한다 (중복 정의 0건).

---

### Step 4 — GAS: Notion 업로드 + 결과 피드백
**Owner:** 개발자/executor

**파일:** `WeeklyReport.gs` 내 `uploadToNotion_(title, blocks)` 함수 + 진입점 `generateWeeklyReport()`

**작업 내역:**
1. Notion API 토큰을 `PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN')`에서 읽음 (4-1).
2. `UrlFetchApp.fetch('https://api.notion.com/v1/pages', { ... })` 로 페이지 생성.
   - parent: `34972773c36380e18445e03264de9caa`
   - title: `26년 ${MM}월 ${DD}일 VOC 리포트` (오늘 날짜, Asia/Seoul)
   - children: Step 3 blocks
3. 성공 시 응답의 `url`을 `주간입력` 시트 `생성결과` 셀에 기록.
4. 실패 시 (4xx/5xx, 타임아웃) `생성결과` 셀에 `❌ {상태코드} {에러요약}` 기록 + `Logger.log` 남김.
5. 진입점 `generateWeeklyReport()`은 Step 2 → 3 → 4를 순서대로 호출하는 50줄 이내 함수.

**4-1. 시크릿 처리 권장 방식:**
- Apps Script 에디터 → 프로젝트 설정 → 스크립트 속성에 `NOTION_TOKEN`을 1회 입력 (소스에 토큰 노출 금지)
- Sheets `설정` 시트에는 페이지 ID만 두고 토큰은 두지 않음

**Acceptance:**
- [ ] 버튼 클릭 후 30초 이내 Notion에 페이지가 생성되고 셀에 URL이 표시된다.
- [ ] Notion 토큰이 잘못되었을 때 `❌ 401 unauthorized` 같은 에러가 셀에 표시되고 시트가 멈추지 않는다.
- [ ] 소스 코드 어디에도 Notion 토큰 문자열이 직접 적혀 있지 않다.

---

### Step 5 — 분류 SSOT 통합 + E2E 검증 + 운영 문서 갱신
**Owner:** 은주 + 개발자

**작업 내역:**
1. **F1 SSOT 통합 (ADR Follow-up F1 승격, 본 Step의 종료 조건):**
   - `Categorizer.gs`를 GAS 프로젝트에 별도 파일로 분리하고 모든 카테고리/태그 매칭 규칙을 이 파일 1곳에 모은다.
   - `/Users/eunju/.claude/commands/voc-report.md` 슬래시 명령의 분류 규칙도 `Categorizer.gs`와 동일한 룰을 참조하도록 정렬 (문서 상단에 "분류 규칙 출처: GAS `Categorizer.gs` (SSOT)" 명시).
   - **회귀 픽스처:** 지난 4주(W17·W18·W19·W20) 데이터를 `Categorizer.gs.categorize(tag)`로 재분류해 기존 `/voc-report` 결과와 카테고리 라벨이 100% 일치함을 확인.
2. **드라이런:** 지난주 데이터(이미 알고 있는 결과)를 `주간입력`에 입력하고 버튼 클릭 → Notion 결과를 기존 `/voc-report` 결과와 비교.
3. **수치 검증 (V6 diff 산출 절차):** OKR 표 4개 행, CSAT 분포 합계, 처리건수 증감 %, 이상 태그 분류가 일치하는지 자동 비교.
   - **diff 절차:** 신규 GAS 함수 `verifyAgainstVocReport_(weekKey)`가 (a) 신규 빌더 출력, (b) 기존 `/voc-report`가 생성한 동일 주차 결과를 nested 객체로 받아 key별 비교. 결과를 (i) GAS `Logger.log`에 표 형태(`항목 | 신규 | 기존 | 일치여부`)로 출력, (ii) `설정` 시트 `검증결과` 셀(B4)에 `OK / 불일치 N건: ...` 한 줄 요약 기록.
4. **에러 케이스 확인:**
   - 토큰을 잠시 망가뜨려 401 에러가 셀에 잡히는지
   - CSAT 분포를 비워두고 검증 에러가 표시되는지
5. **문서 갱신:**
   - `/Users/eunju/.claude/commands/voc-report.md` 상단에 "**현재는 Google Sheets 버튼 1번 클릭으로 자동 실행됩니다. 이 명령은 백업/수동 실행용입니다.**" 한 줄 추가.
   - `CLAUDE.md`의 프로젝트 설명에 "주간 리포트는 Sheets [▶ 리포트 생성] 버튼 사용" 1줄 추가.
6. **롤백 절차 기록:** 문제가 생기면 기존 `/voc-report` 슬래시 명령으로 즉시 회귀 가능함을 문서에 명시.
7. **인사이트 플래그 전환:** V7 통과 후 `설정` 시트 `인사이트_활성화` 셀을 `TRUE`로 변경 (Step 5 종료 시점이 아닌 V7 결과에 따라 결정).

**Acceptance:**
- [ ] 드라이런 결과 Notion 페이지가 spec의 "Report Format" 예시와 같은 구조로 생성된다.
- [ ] 에러 케이스 2개가 모두 사용자에게 한국어 메시지로 노출된다.
- [ ] 운영 문서 2곳이 갱신되어 다음 사람이 사용/롤백 방법을 안다.
- [ ] **F1 SSOT 회귀 픽스처:** 지난 4주 데이터에 대해 `Categorizer.gs` 출력과 기존 `/voc-report` 분류 결과가 카테고리·TOP5 라벨 기준 100% 일치한다.
- [ ] **V6 diff 절차:** `검증결과` 셀(B4)에 `OK` 또는 구체적 불일치 항목이 한 줄로 기록되어 있다.

---

## 5. 전체 Acceptance Criteria (Spec 매핑)

| Spec Criteria | 매핑 Step | 검증 방법 |
|---|---|---|
| Sheets 버튼 클릭 시 Notion 페이지 생성됨 | Step 4, 5 | 드라이런 1회 |
| OKR 목표값을 Sheets 고정 셀에서 읽어 `실적/목표(전주)` 형식 | Step 2, 3 | OKR 표 출력 확인 |
| CSAT 채팅/전화 분리, 평균+점수 분포 | Step 3 | CSAT 블록 출력 확인 |
| 처리건수 전주 대비 증감 % 자동 계산 | Step 3 | 868→1057 → +39.3% 검증 |
| 기존 태그 분석 섹션 유지 | Step 3 | `/voc-report` 결과와 비교 |

---

## 6. 리스크 & 완화책

| # | 리스크 | 영향 | 완화책 |
|---|---|---|---|
| R1 | **Notion 토큰 만료/유출** | 리포트 생성 실패 또는 보안 사고 | Apps Script Properties 저장(소스 격리), 만료 시 401 에러 셀 노출로 즉시 인지. |
| R2 | **GAS 6분 실행 제한** 초과 | 큰 데이터 셋에서 타임아웃 | 현재 `report.json` 기준 태그 약 50개 × 2주 비교 = **~100회 단순 비교 + Notion blocks ~30개 생성** → 예상 실행시간 **< 10초** (안전). 향후 태그 500개 이상으로 증가 시 batch 분할 도입. Notion blocks 1회 호출로 batch 전송. |
| R3 | **은주가 잘못된 셀에 입력** | 빈 리포트/오류 | Step 2 검증 로직 + 셀에 한국어 가이드 + 헤더 색상 강조. |
| R4 | **Notion API 스키마 변경** | 페이지 생성 실패 | `version: '2022-06-28'` 헤더 고정, 실패 시 자동으로 기존 `/voc-report` 명령으로 롤백 가능함을 문서화. |
| R5 | **`report.json` 구조 변경** (CSAT/top_voc 향후 추가) | 빌더가 깨질 수 있음 | 빌더에서 `csat_avg/top_voc` 필드는 **있으면 사용, 없으면 무시**로 방어적 코딩. |
| R6 | **카테고리 분류 규칙이 두 곳에 중복** (`/voc-report` + GAS) | 결과 불일치 | **Step 5 종료 조건으로 격상** (F1 SSOT 승격): `Categorizer.gs` 단일 파일로 통합 + 회귀 픽스처로 4주치 검증. |
| R7 | **Notion blocks `table` 100행 제한** | TOP5 태그 누적 또는 카테고리 표 증가 시 422 에러 | 본 리포트는 OKR 표(4행) + 카테고리 표(5행) + TOP5×3 카테고리(15행) = 최대 ~25행이라 **현재는 안전**. 빌더에서 표 1개당 행 수 > 90 시 자동으로 두 번째 표로 분할하는 가드 추가. |
| R8 | **Notion API rate limit (3 req/sec)** | 다중 페이지 생성 시 429 에러 | 본 자동화는 **주 1회 1개 페이지 생성**이라 안전. 향후 백필(과거 N주 일괄 생성)을 도입할 경우 `Utilities.sleep(400)`로 호출 간격 보장. |

---

## 7. 검증 단계 (Verification)

| # | 항목 | 기대 결과 |
|---|---|---|
| V1 | GAS Editor `Run > generateWeeklyReport` 수동 실행 | 에러 없이 종료, Logger에 단계별 로그 |
| V2 | Sheets 버튼 클릭 (정상 데이터) | Notion 페이지 URL이 셀에 기록 |
| V3 | Notion 페이지 본문 시각 검토 | OKR/CSAT/카테고리/TOP5/이상태그/한줄인사이트 6개 섹션 모두 존재 |
| V4 | 의도적 입력 오류 (CSAT 분포 비움) | 한국어 에러 메시지 셀 표시, Notion 호출 없음 |
| V5 | 토큰 무효화 후 실행 | `❌ 401 ...` 셀 표시, 시트 정상 동작 |
| V6 | 기존 `/voc-report` 명령과 동일 주차 비교 (diff 절차) | (a) GAS Logger에 `항목 \| 신규 \| 기존 \| 일치여부` 표가 출력되고 모든 행이 일치, (b) `설정` 시트 `검증결과` 셀에 `OK`가 기록됨. 불일치 시 셀에 구체적 항목 한 줄 요약. |
| V7 | 비개발자 운영 테스트 (정량 기준) | 은주가 문서만 보고 **에러 없이 5분 이내에 `생성결과` 셀에 Notion 페이지 URL이 기록되는 것**을 1회 단독 재현. (재시도 0~1회 허용, 2회 이상 실패 시 V7 미통과.) |

---

## 8. 영향받는 파일 & 산출물

| 경로 | 변경 유형 |
|---|---|
| (신규) GAS 프로젝트 — `WeeklyReport.gs` | 추가 |
| (신규) GAS 프로젝트 — `Categorizer.gs` (분류 SSOT) | 추가 |
| (신규) Google Sheets 시트 3개: `OKR목표`, `주간입력`, `설정`(`인사이트_활성화`/`검증결과` 셀 포함) | 추가 |
| `/Users/eunju/.claude/commands/voc-report.md` | 보조용 안내 1줄 + 분류 규칙 SSOT 출처 명시 |
| `/Users/eunju/Documents/04.Git/CS/CLAUDE.md` | 운영 가이드 1줄 추가 |
| `dashboard/index.html` | **변경 없음 (Non-Goal)** |
| `report.json` 구조 | **변경 없음** |

---

## 9. ADR (Architecture Decision Record)

- **Decision:** Google Apps Script 단독으로 Sheets 버튼 → Notion 업로드 파이프라인을 구현한다 (Option A).
- **Drivers:** 운영 안정성(주 1회 의존 작업), 비개발자 유지보수성, 인프라 추가 없음.
- **Alternatives considered:**
  - Option B (GAS + Claude Code 하이브리드) — "버튼 1번 클릭" Constraint 위반.
  - Option C (Apps Script Time Trigger 완전 자동) — "스케줄러 없음" Non-Goal 위반, CSAT 수동 입력 전 실행될 위험.
- **Why chosen:** 5개 Principles 전부 충족, Driver 1·2·3 모두에서 최상. 기존 자산(GAS + `/voc-report` 로직)을 그대로 이식해 구현 비용 최소.
- **Consequences:**
  - 긍정: 1년 후 OKR 목표가 바뀌어도 셀만 수정하면 됨. 토큰을 Properties에 두어 시크릿 노출 위험 낮음.
  - 부정: 카테고리 분류 규칙이 GAS와 `/voc-report` 양쪽에 존재(향후 통합 필요). GAS 디버깅 UX는 떨어짐.
- **Follow-ups:**
  - ~~F1. 분류 규칙을 GAS 단일 함수로 통합, `/voc-report`는 백업 경로로 격하.~~ → **본 계획 Step 5의 종료 조건으로 승격** (`Categorizer.gs` SSOT + 4주 회귀 픽스처).
  - F2. CSAT 자동 수집(ChannelTalk API) — 별도 Spec 필요. **이번 범위 아님.**
  - F3. top_voc 텍스트 요약 — Claude/AI 연동 검토. **이번 범위 아님.**
  - F4. "한 줄 인사이트" 알고리즘 정교화 (현재는 feature flag로 defer) — V7 통과 후 활성화, 향후 Claude/AI 호출 옵션 검토.

---

## 10. Open Questions

`.omc/plans/open-questions.md`에 다음 항목 보존:

- [ ] **(O1)** Notion 토큰을 누가 발급/보관하나? (은주 개인 통합 vs 보살핌 워크스페이스 전용 봇) — 보안 책임 라인 결정 필요
- [ ] **(O2)** `report.json`의 `csat_avg`/`top_voc`를 GAS가 향후 채울 계획인지? 채운다면 Step 3 빌더에서 자동 사용 로직 활성화 필요.
- [ ] **(O3)** Sheets `주간입력`에 입력하는 주차 라벨 형식(`MM/DD~MM/DD` vs `YYYY-WW`)을 어떻게 표준화할지 — `report.json`과 자동 매칭하려면 동일 형식 필요.
- [ ] **(O4)** "한 줄 인사이트" 자동 생성을 알고리즘 기반(Step 3)으로 시작하되, 향후 Claude/AI 호출 옵션을 추가할지 여부.

---

## 11. 완료 정의 (Definition of Done)

- [ ] Step 1~5 모두 Acceptance 통과
- [ ] V1~V7 검증 7건 모두 통과
- [ ] Open Questions O1·O3은 시작 전, O2·O4는 다음 분기 회고에서 결정
- [ ] 은주가 한 차례 단독으로 다음 주 리포트를 생성하고 결과를 "OK"로 확인

---

## 12. Changelog (Iteration 2)

Architect + Critic 피드백 반영 변경 사항:

- **Step 2 `readReportJson_()` 구체화** — "ScriptApp 또는 Sheets 캐시" 표현 제거, **동일 GAS 프로젝트 내 함수 in-memory 직접 호출**로 명시. GitHub Raw URL fetch 금지 명문화. (Architect+Critic 합의)
- **F1(분류 SSOT) Step 5 종료 조건 승격** — ADR Follow-up F1을 Step 5의 정식 작업으로 격상. `Categorizer.gs` 별도 파일 분리 명시 + 지난 4주 회귀 픽스처 Acceptance 추가. R6 리스크에도 반영. (Architect+Critic 합의)
- **"한 줄 인사이트" feature flag 도입** — `설정` 시트 `인사이트_활성화` 셀(초기 FALSE) 추가. FALSE면 빌더가 섹션 전체 생략. V7 통과 후 TRUE 전환. ADR Follow-up F4 신설. (Architect+Critic 합의)
- **V6 diff 산출 절차 구체화** — `verifyAgainstVocReport_()` 함수와 GAS Logger 표 출력 + `설정` 시트 `검증결과` 셀(B4) 기록 절차를 Step 5에 명문화. V6 행도 갱신. (Critic)
- **V7 정량 기준 추가** — "혼자 생성 가능" → "에러 없이 5분 이내 Notion URL이 셀에 기록, 재시도 ≤ 1회"로 수치화. (Critic)
- **Step 1 Acceptance O3 결정 추가** — 주차 라벨 형식(`주간입력` 시트 ↔ `report.json`) 통일 항목과 비고 셀 기록 의무 추가. (Critic)
- **Option D 추가 + invalidation 명시** — Notion Database row 방식을 RALPLAN-DR Options에 추가하고, 페이지 구조 vs Database row의 가독성·블록 표현 한계·기존 운영 흐름 마이그레이션 부담을 사유로 invalidation. (Critic)
- **R2 실행시간 추정 추가** — 현재 태그 ~50개 × 2주 = ~100 비교, 예상 < 10초 명시. (Gap)
- **R7 신설** — Notion blocks `table` 100행 제한. 현재 ~25행으로 안전, 90행 초과 시 자동 분할 가드 명시. (Gap)
- **R8 신설** — Notion API rate limit (3 req/s). 주 1회 1페이지라 현재 안전, 백필 시 `Utilities.sleep(400)` 명시. (Gap)
- **영향 파일 표 갱신** — `Categorizer.gs`, `설정` 시트 신규 셀, `/voc-report.md` SSOT 출처 명시 반영.
