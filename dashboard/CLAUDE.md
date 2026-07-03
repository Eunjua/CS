# 대시보드 (index.html)

## 파일 구성
- `index.html` : VOC 대시보드 시각화 (단일 파일, 빌드 없음)
- `report.json` : ChannelTalk 추출 VOC 태그별 주간 집계 데이터
  - 구조: `{ weeks: [{week, tags:{태그명:건수}}] }`
  - 태그 체계: 아카데미_/요_/기관_/오류_/일반_ 등
- `VOC_태그_정의.md` : 전체 태그 정의 목록

## 기술 스택
- HTML / CSS / Vanilla JavaScript (외부 프레임워크 없음)

### 라이브러리
| 라이브러리 | 버전 | 용도 | 로드 방식 |
|---|---|---|---|
| Chart.js | 4.4.1 | 모든 차트 (막대/라인/도넛) | CDN (cdnjs) |
| Noto Sans KR | — | 본문 폰트 (wght 300~900) | Google Fonts |
| DM Mono | — | 숫자/코드 모노스페이스 폰트 | Google Fonts |

### 외부 API
- **Anthropic Claude API** (`claude-sonnet-4-20250514`) — CSAT 자유의견 AI 감성 분석 (긍정/중립/부정 분류)
  - 브라우저에서 직접 호출 (API Key 필요 — 미설정 시 AI 분석 버튼 비활성)

## 데이터 흐름
```
채널톡(ChannelTalk) / 구글폼(CSAT) / NPS 시트
         ↓ Google Apps Script (매일 자동 실행)
Google Sheets (대시보드_공개용 / 매핑결과 / 고객NPS_요양 / 고객NPS_기관)
         ↓ Apps Script 웹앱 API (?sheet=파라미터)
index.html 대시보드 (GitHub Pages)
```

## Apps Script 웹앱 API 파라미터
- `?sheet=dashboard`  → 대시보드_공개용 (VOC 상담 데이터)
- `?sheet=csat`       → 매핑결과 (CSAT 만족도 데이터)
- `?sheet=csat_send`  → 만족도발송건 (날짜별 만족도 조사 발송 건수)
- `?sheet=nps_요양`   → 고객NPS_요양 (요양 앱 NPS 데이터)
- `?sheet=nps_기관`   → 고객NPS_기관 (기관 NPS 데이터)
- `?sheet=report`     → 주차별 태그 집계 JSON
- `?sheet=daily_response` → 당일 응대율 주차별 집계 JSON

## 시트 구조
### 고객NPS_요양
- 컬럼: id, user_id, score(0~10), reason, public_id, created_at, updated_at

### 고객NPS_기관
- 컬럼: id, business_id, score(0~10), reason, public_id, created_at, updated_at

### 만족도발송건
- 컬럼: 날짜, 건수
- 용도: CSAT 응답률 계산 시 분모 (발송건수 기준)

### 상담사_매핑
- 컬럼: assigneeId, name
- 용도: 상담사 ID → 이름 변환 (runDashboardSync 실행 시 자동 치환)

### 매핑결과 (CSAT)
- 컬럼: 상담ID, 상담일시, 채널, 태그, 상태, 만족도, 친절도, 해결여부, 대기시간, 자유의견, 응답일시, **AI구분**
- **AI구분**: 태그로 판정한 응대 주체 (`AI` / `사람`) — GAS `aiOrHuman_()` 가 매핑 시 자동 기록, 기존 행은 `ensureAiColumn_()` 가 소급 채움
  - 규칙(2분류·이관은 사람 포함): 태그에 `상담원이관` 있음 → 사람 / 그 외 `AI`·`AI/*` 태그 있음 → AI / AI 태그 없음(전화·순수 사람) → 사람

### NPS 계산 방식
- 추천자(Promoter): 9~10점
- 중립(Passive): 7~8점 (계산 제외)
- 비추천자(Detractor): 0~6점
- **NPS = 추천자% − 비추천자%** (범위: -100 ~ +100)

## 대시보드 탭 구성
1. 📊 대시보드 — 총 문의, 채팅/전화, 재문의율 KPI, 주차별 문의 추이 (재문의율 라인 포함), 이슈 현황
2. 👤 상담사 — 상담사별 응대량 (상담사_매핑 시트로 이름 매핑)
3. 🔁 재문의 고객 — 14일 이내 동일 이슈 재문의 고객 상세
4. ⭐ 고객 만족도 (CSAT) — **응대 주체(전체/AI/사람) 토글** + AI↔사람 만족도 비교, 만족도/친절도 추이 (응답률 라인+오른쪽Y축 포함), 채널별 비교, 태그별 히트맵, 채팅/전화 실제 대기시간 구간별 만족도, AI 자유의견 분석
5. 📈 NPS — NPS 점수 추이 (동적Y축), 응답자 분류, 점수 분포, NPS 의견 (요양/기관 필터)
6. 🏷️ 태그 추이 — 태그별 최근 5주 주차 집계 테이블 + 상태 자동 분류 + SVG 스파크라인
7. 📅 당일 응대율 — 당일 응대율 KPI, 주차별 추이 (최근 4주), 일별 응대율 차트, 부재중 제외 토글

## 차트 구현 패턴
- **이중 Y축**: 주 데이터(왼쪽 y) + 보조 비율(오른쪽 yRight/yRate) — 오른쪽 max는 동적 설정
- **동적 Y축 범위**: 데이터 최대값 × 1.4~1.5 후 단위 올림으로 여백 확보
- **점선(borderDash: [5,3])**: 라인 차트에서 비율/추이 데이터 구분 시 사용
- **scoreToColor()**: 만족도 점수 → 색상 (4.5↑초록 / 4.0↑연초록 / 3.0↑노랑 / 2.0↑주황 / 미만빨강)
- **대기시간 구간**: ~5분 / 5~10분 / 10~20분 / 20~30분 / 30분+ (A안)

## 주요 함수
- `csatSetGroup(g)` — 만족도 탭 응대 주체 필터(전체/AI/사람) 전환 후 재렌더
- `deriveAiGroup(tags)` — 태그로 AI/사람 판정 (AI구분 컬럼 없을 때 폴백, GAS `aiOrHuman_` 와 동일 규칙)
- `csatGroupAvg(week, group)` — 주차·그룹별 평균 만족도+응답수 (AI↔사람 비교·추이 라인용, 토글 무관)
- `getSendCountForWeek(week)` — 만족도발송건 시트에서 주차별 발송건수 합산
- `parseSendDate(raw)` — ISO/텍스트 날짜 형식 UTC→로컬 보정 파싱
- `scoreToColor(score)` — 만족도 점수 구간별 색상 반환
- `buildWaitSatChart(ch, ...)` — 채널별 대기시간 구간별 만족도 차트 렌더링
- `calcRecontactRate(week)` — 재문의율 계산 (14일 window, userId+태그 기준)
- `renderRecontact(week)` — 대시보드 재문의율 KPI 카드 업데이트
- `renderTagTrendTab()` — 태그 추이 탭 렌더링 (상태 분류 + 스파크라인)
- `ttGetStatus(vals)` — 5주 건수 배열 → 분리검토/통합검토/안정 분류
- `ttSparkline(vals)` — 5주 추이 SVG 스파크라인 생성 (상승 빨강, 하락 파랑)
- `ttSetStatus(s, btn)` — 태그 추이 탭 상태 필터 변경
- `ttFilterTable(q)` — 태그 추이 탭 검색 필터
- `renderDailyResponseTab()` — 당일 응대율 탭 렌더링 (KPI + 차트)
- `drToggleMissed()` — 부재중 제외/포함 토글 후 탭 재렌더링

## 태그 추이 탭 상세
- **데이터 소스**: `?sheet=report` → `{ weeks: [{week, tags:{태그명:건수}}] }` 구조
  - `fetchSheet()`가 `json.data`만 반환하므로 report는 직접 `fetch()`로 호출
- **표시 태그 범위**: `VOC_태그_정의.md` 기준 전체 태그 (`TT_ALL_DEFINED_TAGS`) + 실적에 있는 태그 합산
  - `요_ / 기관_ / 아카데미_ / 일반_` 접두어 태그만 표시 (콜백, 오류, 중복, 테스트 등 제외)
- **상태 자동 분류 기준**:
  - 📈 분리검토: 후반 2주 평균 ÷ 전반 2주 평균 ≥ 1.3
  - 📉 통합검토: 최근 3주 합계 ≤ 5, 또는 후반/전반 비율 < 0.7
  - ✅ 안정: 그 외
- **스파크라인**: 상승(빨강 #f87171) / 하락(파랑 #60a5fa) / 변동없음(회색)

## 당일 응대율 탭 상세
- **데이터 소스**: `?sheet=daily_response` → `{ weeks: [{week, total, responded, missed, rate, total_excl, rate_excl, days:[{date, rate, rate_excl, total, total_excl}]}] }`
- **KPI 카드**: 당일 응대율 / 당일 응대 건수 / 전체 접수 건수 / 부재중 건수
- **차트**:
  - 주차별 당일 응대율 추이 (최근 4주, 라인 차트) — `cDailyResponseWeekChart`
  - 일별 당일 응대율 (선택 주차 기준, 라인 차트) — `cDailyResponseChart`
- **부재중 제외 토글** (`drExclMissed`): ON 시 `total_excl` / `rate_excl` 기준으로 전환
- **주차 선택**: `drSelectedWeek` — 기본값은 최신 주차

## 알려진 버그 수정 이력
- `renderRecontact()` 가 `render()` 에서 호출 누락 → 대시보드 재문의율 항상 `—` 표시 (수정완료)
- 태그 추이 탭 데이터 없음 → `fetchSheet()` 대신 직접 `fetch()` 로 report 로딩 (수정완료)

## GAS 상수 (최신)
```javascript
const SHEET_FORM      = '설문지 응답 시트1';
const SHEET_RAW       = '상담데이터';
const SHEET_MAPPED    = '매핑결과';
const SHEET_PUBLIC    = '대시보드_공개용';
const SHEET_NPS_요양  = '고객NPS_요양';
const SHEET_NPS_기관  = '고객NPS_기관';
const SHEET_CSAT_SEND = '만족도발송건';
const SHEET_AGENT_MAP = '상담사_매핑';
```
