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
- `?sheet=dashboard` → 대시보드_공개용 (VOC 상담 데이터)
- `?sheet=csat`      → 매핑결과 (CSAT 만족도 데이터)
- `?sheet=nps_요양`  → 고객NPS_요양 (요양 앱 NPS 데이터)
- `?sheet=nps_기관`  → 고객NPS_기관 (기관 NPS 데이터)
- `?sheet=report`   → 주차별 태그 집계 JSON

## 시트 구조
### 고객NPS_요양
- 컬럼: id, user_id, score(0~10), reason, public_id, created_at, updated_at

### 고객NPS_기관
- 컬럼: id, business_id, score(0~10), reason, public_id, created_at, updated_at

### NPS 계산 방식
- 추천자(Promoter): 9~10점
- 중립(Passive): 7~8점 (계산 제외)
- 비추천자(Detractor): 0~6점
- **NPS = 추천자% − 비추천자%** (범위: -100 ~ +100)

## 대시보드 탭 구성
1. 📊 대시보드 — 총 문의, 채팅/전화, 재문의율, 볼륨 추세, 이슈 현황
2. 👤 상담사 — 상담사별 응대량
3. 🔁 재문의 고객 — 14일 이내 동일 이슈 재문의 고객 상세
4. ⭐ 고객 만족도 (CSAT) — 만족도/친절도 추이, 태그별 히트맵, AI 자유의견 분석
5. 📈 NPS — NPS 점수 추이, 응답자 분류, 점수 분포, NPS 의견 (요양/기관 필터)
