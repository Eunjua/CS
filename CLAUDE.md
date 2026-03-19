# Bosalpim CS 프로젝트

## 나에 대해
- 비개발자 (기술 용어는 쉽게 설명해줄 것)
- 항상 한국어로 답할 것

## 이 프로젝트가 하는 일
- VOC 주간 대시보드 (GitHub Pages 호스팅)
- VOC 분석 및 리포트 자동화

## 주요 파일
- index.html : VOC 대시보드 (시각화 화면)
- report.json : ChannelTalk에서 추출한 VOC 태그별 주간 집계 데이터
  - 구조: weeks 배열 → week(기간) + tags(태그명: 건수)
  - 태그 체계: 아카데미_/요_/기관_/오류_/일반_ 등으로 분류
- README.md : 프로젝트 설명

## 작업 규칙
- 코드 수정 전 반드시 계획 먼저 설명하고 승인받을 것
- 파일 삭제 시 반드시 확인 요청할 것
- 작업 완료 후 변경 내용 요약해줄 것

## 기술 스택

### 프론트엔드
- HTML / CSS / Vanilla JavaScript (외부 프레임워크 없음)
- 정적 사이트 — 빌드 과정 없음, index.html 단일 파일

### 라이브러리
| 라이브러리 | 버전 | 용도 | 로드 방식 |
|---|---|---|---|
| Chart.js | 4.4.1 | 모든 차트 (막대/라인/도넛) | CDN (cdnjs) |
| Noto Sans KR | — | 본문 폰트 (wght 300~900) | Google Fonts |
| DM Mono | — | 숫자/코드 모노스페이스 폰트 | Google Fonts |

### 외부 API
- **Anthropic Claude API** (`claude-sonnet-4-20250514`) — CSAT 자유의견 AI 감성 분석 (긍정/중립/부정 분류)
  - 브라우저에서 직접 호출 (API Key 필요 — 현재 미설정 시 AI 분석 버튼만 비활성)

### 인프라
- **GitHub Pages** — index.html 정적 호스팅
- **Google Apps Script** — 웹앱 API (데이터 브릿지), 자동화 트리거
- **Google Sheets** — 데이터 저장소

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
- `?sheet=report`    → 주차별 태그 집계 JSON

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

### NPS 계산 방식
- 추천자(Promoter): 9~10점
- 중립(Passive): 7~8점 (계산 제외)
- 비추천자(Detractor): 0~6점
- **NPS = 추천자% − 비추천자%** (범위: -100 ~ +100)

## 대시보드 탭 구성
1. 📊 대시보드 — 총 문의, 채팅/전화, 재문의율 KPI, 주차별 문의 추이 (재문의율 라인 포함), 이슈 현황
2. 👤 상담사 — 상담사별 응대량 (상담사_매핑 시트로 이름 매핑)
3. 🔁 재문의 고객 — 14일 이내 동일 이슈 재문의 고객 상세
4. ⭐ 고객 만족도 (CSAT) — 만족도/친절도 추이 (응답률 라인+오른쪽Y축 포함), 채널별 비교, 태그별 히트맵, 채팅/전화 실제 대기시간 구간별 만족도, AI 자유의견 분석
5. 📈 NPS — NPS 점수 추이 (동적Y축), 응답자 분류, 점수 분포, NPS 의견 (요양/기관 필터)

## 차트 구현 패턴
- **이중 Y축**: 주 데이터(왼쪽 y) + 보조 비율(오른쪽 yRight/yRate) — 오른쪽 max는 동적 설정
- **동적 Y축 범위**: 데이터 최대값 × 1.4~1.5 후 단위 올림으로 여백 확보
- **점선(borderDash: [5,3])**: 라인 차트에서 비율/추이 데이터 구분 시 사용
- **scoreToColor()**: 만족도 점수 → 색상 (4.5↑초록 / 4.0↑연초록 / 3.0↑노랑 / 2.0↑주황 / 미만빨강)
- **대기시간 구간**: ~5분 / 5~10분 / 10~20분 / 20~30분 / 30분+ (A안)

## 주요 함수 (index.html)
- `getSendCountForWeek(week)` — 만족도발송건 시트에서 주차별 발송건수 합산
- `parseSendDate(raw)` — ISO/텍스트 날짜 형식 UTC→로컬 보정 파싱
- `scoreToColor(score)` — 만족도 점수 구간별 색상 반환
- `buildWaitSatChart(ch, ...)` — 채널별 대기시간 구간별 만족도 차트 렌더링
- `calcRecontactRate(week)` — 재문의율 계산 (14일 window, userId+태그 기준)
- `renderRecontact(week)` — 대시보드 재문의율 KPI 카드 업데이트

## 알려진 버그 수정 이력
- `renderRecontact()` 가 `render()` 에서 호출 누락 → 대시보드 재문의율 항상 `—` 표시 (수정완료)

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
