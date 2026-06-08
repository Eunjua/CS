# Work Plan: VOC 대시보드 — NPS 탭 삭제 + 문제 태그 진단 탭 신설

> Status: **PENDING APPROVAL** (consensus reached — Architect 조건부승인→반영, Critic APPROVED)
> Source spec: `.omc/specs/deep-interview-voc-problem-tag-page.md`
> Scope: `dashboard/index.html` 단일 파일 수정 (빌드 없음, GAS 수정 불필요)

## Requirements Summary
1. VOC 주간 대시보드(`dashboard/index.html`)에서 **📈 NPS 탭과 관련 코드 제거**.
2. 그 자리에 **🚨 문제 태그 진단 탭** 신설:
   - 태그별 문제점수 = `만족도기여×0.5 + 해결율기여×0.4 + 대기기여×0.1` 내림차순 순위.
   - 지표(모두 CSAT 설문/매핑결과 기준): 만족도 평균(1~5), 해결율(✅ 긍정비율 %), 대기불만(😞 부정비율 %).
   - 주차 선택(1주) + 최근 4주 누적 토글.
   - 표본 적은 태그 ⚠ 경고(기본 n<5).
   - 주차 모드에서 전주 대비 ↑↓.
   - 태그 클릭 → 저점수(≤3) 자유의견 상세.

## RALPLAN-DR Summary (short mode)
**Principles**
1. 기존 단일 파일·Vanilla JS·빌드 없는 구조를 유지한다 (새 의존성 금지).
2. 데이터 계산은 기존 정석 조인 패턴 **`allData ⋈ csatData(by id)`** (히트맵 `hmTagWeekScore`, `index.html:3005-3013`)를 재사용한다 (GAS 무수정). 태그 출처는 `allData`, 만족도/해결/대기는 id로 조인한 `csatData`.
3. 가중치·임계값은 코드 상단 상수로 분리해 비개발자도 조정 가능하게 한다.
4. NPS 제거가 다른 탭(특히 고객 만족도)을 깨뜨리지 않도록 격리한다.
5. v1 범위(스펙 Non-Goals)를 넘지 않는다.

**Decision Drivers (top 3)**
1. 유지보수 용이성(비개발자 단일 운영자) — 가장 중요.
2. 기존 데이터 파이프라인 재사용으로 변경 표면 최소화.
3. 표본 신뢰성(적은 응답 왜곡 방지) 가시화.

**Viable Options**
- **Option A — index.html만 수정, 클라이언트 집계 (채택)**
  - Pros: GAS 무수정, 변경 표면 최소, 기존 조인 패턴 재사용, 즉시 GitHub Pages 반영.
  - Cons: 태그별 해결/대기 집계 로직을 클라이언트에 신규 작성해야 함(중간 규모).
- **Option B — GAS에 태그별 문제점수 사전 집계 추가 후 `?sheet=problem_tags` 신설**
  - Pros: 무거운 계산을 서버로, 클라이언트 단순.
  - Cons: GAS+클라이언트 양쪽 수정, 배포 2곳, 디버깅 난이도↑, 비개발자 유지보수 부담↑. → 현 데이터 규모(주간 CSAT 수백 건)에선 과설계.

**Invalidation rationale**: Option B는 현 데이터 규모에서 클라이언트 집계로 충분하고(수백 행), GAS 수정은 배포·유지보수 비용만 키워 Driver 1·2에 역행하므로 기각.

## Acceptance Criteria

### ① NPS 탭 삭제 (testable)
- [ ] `index.html:337`의 `<button id="tabNps">` 제거 → 탭 바에 NPS 버튼 미표시.
- [ ] `#npsTab` 콘텐츠 div(≈937-1020) 제거.
- [ ] `switchTab()` 내 NPS 분기 제거: line 1347(`tabNps` toggle), 1350 배열의 `'npsTab'`, 1354 activeId 삼항의 nps 분기, 1374-1376 `if (tab==='nps')` 블록.
- [ ] NPS 전용 함수 제거: `renderNpsTab`, `selectNpsWeek`, `toggleNpsFilter`, `calcNpsForWeek`, `renderNpsComments`, `switchNpsCommentTab`, `getFilteredNpsData`, `parseNpsRows`, `rebuildNpsWeeks`, `buildNpsWeekBar` (NPS 블록 ≈3577-3863).
- [ ] NPS 전역 변수/차트 인스턴스 제거: `npsData`, `npsWeeks`, `npsSelectedWeek`, **`cNpsTrendChart`, `cNpsScoreDistChart`, `npsCommentMode`, `npsSourceFilter`** (`index.html:1197-1200`). ← Architect P1 보강.
- [ ] `loadFromSheet()` ④번 블록(1571-1583) 제거 → `?sheet=nps_요양/기관` 미호출.
- [ ] 삭제 후 브라우저 콘솔 에러 0건, 나머지 6개 탭(특히 ⭐고객 만족도) 정상 렌더.
- [ ] GAS `doGet`의 nps 엔드포인트는 **건드리지 않음**(다른 용도 가능).

### ② 문제 태그 진단 탭 (testable)
- [ ] 탭 바에 `🚨 문제 태그` 버튼 추가(`tabProblemTag`) + `#problemTagTab` 콘텐츠 div.
- [ ] `switchTab()`에 `problemtag` 분기 추가(toggle/배열/activeId/render 호출).
- [ ] 상단 상수 블록 정의: `PT_WEIGHTS={만족도:0.5,해결율:0.4,대기:0.1}`, `PT_MIN_SAMPLE=5`.
- [ ] 태그 표시 범위: 히트맵의 `VALID_PREFIXES`(`요_/기관_/아카데미_/일반_`, `index.html:2985`) 정책을 따라 노이즈 태그·"태그없음" 제외. ← Architect P1.
- [ ] 주차 드롭다운 + '최근 4주 누적' 토글 동작(기존 `csatWeekSelect` 패턴 재사용).
- [ ] 태그별 집계(정석 패턴, P0): `allData.filter(r => r.week===week && r.id && r.tags.includes(tag)).map(r => csatData[String(r.id)]).filter(Boolean)` → 만족도 평균, 해결율(✅비율), 대기불만(😞비율), n.
- [ ] 해결/대기 판정은 **매칭 로직을 차용하되 접근 대상은 조인 객체 필드로 적응**(Critic Minor1): 해결율 `c['해결여부'].includes('네, 해결됐어요')`(원본 `index.html:2396-2398`은 `r['해결여부']`), 대기 부정 `c['대기시간']` 옵션 매칭(원본 `2717-2722`은 `r['대기시간']`). 두 객체가 동일 텍스트 값을 담으므로 결과 정합. **기존 CSAT 탭 코드는 건드리지 말고 신규 함수에 동일 로직만 적용**(복제, 리팩터 아님).
- [ ] `VALID_PREFIXES`는 전역 상수(`index.html:2985`)를 참조하고, 신규 함수 내부에 로컬 재선언 만들지 말 것(Critic Minor2: `3968`에 동명 로컬 재선언 존재).
- [ ] 지표별 분모는 각 문항 응답 수로 따로 계산. 해결/대기 응답수가 `PT_MIN_SAMPLE` 미만인 지표는 점수 기여 제외(또는 회색 처리) + 툴팁에 지표별 n 노출. ← Architect P2.
- [ ] 문제점수 환산: 만족도→`(5-avg)/4*100`, 해결율→`100-해결율%`, 대기→`대기부정%`; **각 기여값 `clamp(0,100)`** 후 가중합·내림차순 정렬. ← Architect P2.
- [ ] 각 행: 순위/태그/문제점수(막대)/만족도·해결율·대기 원값 표시.
- [ ] `n < PT_MIN_SAMPLE` 태그에 `⚠ 표본 적음(n=?)` 배지.
- [ ] 주차 모드에서 전주 대비 점수 ↑(악화,빨강)/↓(개선,파랑) 화살표; 누적 모드에선 미표시. 전주 데이터 없음/전주 n<`PT_MIN_SAMPLE`이면 화살표 대신 `—` 표기(Critic 갭).
- [ ] 문제점수 막대는 **순수 CSS 막대**로 그림(Chart.js 인스턴스 미사용 — destroy 관리·누수 회피, 원칙1 부합. Critic 권장).
- [ ] 누적 모드 기간: 최근 4주 슬라이스(기존 `recentWeeks` 패턴 `index.html:3030,3766` 재사용). 가용 주차가 4주 미만이면 있는 만큼만 합산(Critic 갭).
- [ ] 행 클릭 시 해당 태그의 만족도 ≤3 자유의견 목록 펼침(`csatData`의 자유의견).
- [ ] 표시 수치가 매핑결과 시트 실제 값과 일치(샘플 1개 태그 수기 검증).

## Implementation Steps

**Step 0 — (생략) parseCsatRows 수정 불필요**
- Architect 확인 결과 `matched`는 태그를 갖지 않음. 신규 탭은 `allData ⋈ csatData(by id)` 정석 패턴(히트맵 `hmTagWeekScore`)을 쓰므로 `parseCsatRows` 변경 없이 진행. 태그 출처는 `allData.tags`.

**Step 1 — NPS 탭 삭제**
- 위 Acceptance ① 항목 순서대로 제거(함수·전역·차트 인스턴스 포함). 전역 변수/함수 제거 후 참조 잔재 grep(`nps`, `Nps`, `Nps Chart`)로 0건 확인.

**Step 2 — 문제 태그 탭 뼈대**
- 탭 버튼·콘텐츠 div 추가, `switchTab()` 배선, 주차바/토글 UI(기존 csat 패턴 복제).

**Step 3 — 집계·점수 로직**
- `renderProblemTagTab(week, mode)` 작성: 기간 필터(1주 또는 최근 4주) → `VALID_PREFIXES` 태그 목록 순회 → 태그별 `allData⋈csatData` 행 집합 → 지표 계산(CSAT 탭 매칭 코드 재사용) → clamp·가중합 → 정렬 → 렌더.
- 상수(`PT_WEIGHTS`,`PT_MIN_SAMPLE`)는 파일 상단 기존 상수 영역에 배치.

**Step 4 — 부가 표시**
- ⚠ 표본 배지, 전주 대비 화살표(직전 주차 재계산 비교), 클릭 시 저점수 의견 펼침.

**Step 5 — 검증**
- 로컬 브라우저로 실제 시트 데이터 로드 → 한 태그 수기 대조, 콘솔 에러 확인, 전 탭 회귀 확인.

## Risks and Mitigations
| Risk | Mitigation |
|------|-----------|
| NPS 함수 제거 시 다른 코드가 참조해 깨짐 | 제거 전 `nps`/`Nps` grep로 참조처 전수 확인, 단계적 제거 후 콘솔 확인 |
| 태그별 해결/대기 집계가 기존 전역 집계와 달라 혼선 | 기존 `matched` 조인·옵션 매칭 로직(2705-2721) 그대로 차용해 일관성 유지 |
| 만족도 응답만 있고 해결/대기 응답 없는 행 → 분모 불일치 | 지표별 분모를 "해당 문항 응답이 있는 건수"로 각각 계산, n은 만족도 기준으로 표기 |
| 적은 표본 태그가 1위로 왜곡 | ⚠ 배지 + (옵션) 정렬 시 표본부족 태그를 시각적으로 구분 |
| 누적 모드에서 전주 대비 의미 없음 | 누적 모드에선 화살표 숨김(스펙 명시) |

## Verification Steps
1. `index.html`을 로컬에서 열어 시트 URL로 로드.
2. NPS 탭 부재 + 6개 탭 정상 + 콘솔 에러 0 확인.
3. 문제 태그 탭: 주차 선택 시 순위 표시, 한 태그(예: 기관_공고관리)의 만족도/해결율/대기 값을 매핑결과 시트와 수기 대조.
4. 4주 누적 토글 시 합산 동작 + 화살표 숨김 확인.
5. 표본 5건 미만 태그에 ⚠ 배지 확인.
6. 태그 클릭 시 저점수 자유의견 펼침 확인.

## ADR
- **Decision**: `dashboard/index.html` 단독 수정으로 NPS 탭을 제거하고, `allData ⋈ csatData(by id)` 클라이언트 집계 기반 '문제 태그 진단' 탭을 추가한다. 문제점수 = 만족도기여×0.5 + 해결율기여×0.4 + 대기기여×0.1(각 clamp 0~100).
- **Drivers**: ① 비개발자 단일 운영자 유지보수성 ② 변경 표면 최소화(GAS 무수정) ③ 표본 신뢰성 가시화.
- **Alternatives considered**: Option B(GAS에 `?sheet=problem_tags` 사전집계) — 현 데이터 규모(주간 수백 건)에서 과설계, 배포 2곳·유지보수 부담으로 기각.
- **Why chosen**: 기존 히트맵 조인 패턴(`hmTagWeekScore`) 재사용으로 신규 계산 위험 최소화 + 즉시 GitHub Pages 반영.
- **Consequences**: 해결율·대기 판정이 클라이언트에 (CSAT 탭과 동일 로직으로) 존재 → GAS와의 계산 일원화는 v1 범위 밖. 신규 탭/CSAT 탭은 동일 코드라 내부 정합 유지. 향후 정합 필요 시 Option B로 이전 가능.
- **Follow-ups (v2 후보)**: 서비스 필터(요양/기관), 점수 근거 분해 표시, GAS-클라이언트 계산 일원화, 분(分) 단위 실제 대기시간 반영.

## Changelog (consensus 반영)
- [Architect P0] 태그 조인 주체를 `matched`(태그 없음)→`allData ⋈ csatData(by id)` 정석 패턴으로 정정, Step 0 생략.
- [Architect P1] NPS 차트 전역(`cNpsTrendChart` 등 1197-1200) 제거 추가; 태그 표시범위 `VALID_PREFIXES`(2985) 정책 명시.
- [Architect P2] 지표별 표본 가드 + 환산식 `clamp(0,100)`; 해결/대기 판정 CSAT 탭 로직 차용.
- [Critic Minor1] "코드 재사용"을 "매칭 로직 차용 + 접근 변수 적응(`c['해결여부']`)"으로 명확화, 기존 CSAT 코드 비변경(복제) 명시.
- [Critic Minor2] `VALID_PREFIXES` 전역 참조·로컬 재선언 금지(3968 충돌 주의).
- [Critic 갭] 문제점수 막대 = 순수 CSS; 전주 비교 표본 가드(`—`); 누적 4주 미만 처리(`recentWeeks` 슬라이스).
