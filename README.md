# CS 작업 폴더

보살핌 CX 팀(케어파트너 / 케어아카데미) 운영 도구·문서 모음.

> ⚠️ **이 저장소는 공개(public)입니다.** 올리는 파일에 고객 이름·전화번호·생년월일이
> 들어있지 않은지 반드시 확인하세요. 맨 아래 "올리지 않는 것" 참고.

## 웹으로 열리는 화면

GitHub Pages로 배포됩니다 (`main` 브랜치 루트).
**아래 폴더 이름을 바꾸거나 옮기면 주소가 바로 깨집니다.**

| 주소 | 폴더 | 화면 |
|---|---|---|
| https://eunjua.github.io/CS/dashboard-v2/ | `dashboard-v2/` | VOC 대시보드 v2 — **현재 사용** |
| https://eunjua.github.io/CS/email-sender/ | `email-sender/` | 발송 도구 (메일 · 문자 · 알림톡) |
| https://eunjua.github.io/CS/cert/ | `cert/` | 증명서 발급 (교육 이수증 · 시험응시 확인서) |

## 화면 ↔ 백엔드 연결

Apps Script(GAS)는 모두 `gas/` 아래에 있고, **폴더 하나 = 구글 Apps Script 프로젝트 하나**입니다.

| 화면 | 백엔드 폴더 | 배포 |
|---|---|---|
| `email-sender/` | `gas/email-sender/` — `EmailSender.gs` + `BizmSender.gs` (둘은 **반드시 같은 프로젝트에 함께**: 문자·알림톡 요청이 `EmailSender.gs` → `sendBizm_()`로 넘어감) | 수동 복붙 |
| `dashboard-v2/` | `gas/voc-v2/` 전체 (`WebApp.gs`가 진입점, `Remote.gs`는 `/월요일`이 부르는 업로드·집계 입구 — 주소·열쇠는 `.local.json`) | clasp 자동 |
| `cert/` | `gas/cert-list/Code.js` — 과목 목록 시트 A열(과정명)·D열(강의 시간)만 읽어줌. PDF는 브라우저에서 바로 생성 | clasp 자동 |
| (화면 없음) | `gas/cert/Code.js` → 자격증 기준 시트 | clasp 자동 |
| (화면 없음) | `gas/cert-detail/Code.js` → 과목 관리 시트에 과정 한 줄 쓰기 (`/cert-detail` 스킬이 호출, 주소·열쇠는 `.local.json`) | clasp 자동 |
| (화면 없음) | `gas/request-log/Code.js` → 「은주에게 요청한 것들」 시트3에 슬랙 요청 한 줄씩 쓰기 (`/요청기록` 스킬이 호출, 주소·열쇠는 `.local.json`) | clasp 자동 |
| (화면 없음) | `gas/slack/Code.js` → 「주소 확인 요청」 시트에 요청·처리 완료가 적히면 슬랙 #ncs-보살핌에 알림 | clasp 자동 |
| (화면 없음) | `gas/b2g-signed-at/B2GSignedAt.gs` → B2G 취업확인서 서명일자 일괄 수정 | 수동 복붙 |

**새 GAS를 만들 때** — `gas/<이름>/` 폴더에 만들고(이름에 `gas-`를 붙이지 않음), 위 표에 한 줄 추가하세요.
`.clasp.json`·`.local.json`은 어느 폴더에 있어도 자동으로 git에서 빠집니다.

## 폴더 지도

| 폴더 | 하는 일 |
|---|---|
| `cs-triage/` | ALF(AI 상담봇) 개선 사이클 — 규칙·정책 문서, 상담내역 판정, 개선로그 |
| `dashboard-v2/` + `gas/voc-v2/` | VOC 대시보드 v2 — **현재 사용** |
| `email-sender/` | 발송 도구 화면 (메일 · 문자 · 알림톡) |
| `cert/` | 증명서 발급 화면 — 고객에게 주는 이수증 · 시험응시 확인서 |
| `certification/` | 민간자격 **운영규정** 생성 (`/certification` 스킬) — 자격증 신규 등록 시 심사기관 제출용 |
| `gas/` | Apps Script 모음 — 폴더 하나가 프로젝트 하나 (위 "화면 ↔ 백엔드 연결" 참고) |
| `gas/cert/` | 자격증 기준 시트 스크립트 (배송확인리스트 · 메뉴 「🏠 주소 확인」) |
| `gas/cert-list/` | 이수증 과목 목록 API — 「과목 관리 페이지」 시트에서 과정명·강의 시간을 `cert/`로 보냄 |
| `gas/cert-detail/` | 과목 관리 시트 입력 웹앱 — `/cert-detail`로 신규 과정 추가 시 과정명·기관·강의 수·강의 시간·링크를 시트에 적음 |
| `gas/request-log/` | 상담원 요청 기록 웹앱 — `/요청기록`으로 #보살핌_고객센터에서 은주 태그 요청을 날짜·요청자·유형·내용·링크로 시트에 적음 |
| `gas/slack/` | 「주소 확인 요청」 시트 → 슬랙 알림 (새 요청·처리 완료) |
| `gas/email-sender/` | 발송 도구 백엔드 (메일 · 문자) — **현역, 지우지 마세요** |
| `gas/b2g-signed-at/` | B2G 취업확인서 서명일자 일괄 수정 스크립트 |
| `b2g_2026/` | B2G 현장점검 대응 — 취업확인서 일괄 수정, 소명서 |
| `_구버전/` | 더 안 쓰는 것 보관 — 아래 "구버전" 참고 |

`cert/`와 `certification/`은 이름만 비슷하고 하는 일이 완전히 다릅니다.
`cert/`는 **고객**에게 주는 증명서, `certification/`은 **심사기관**에 내는 규정 문서예요.

## 구버전 — 수정하지 마세요

VOC 파이프라인은 v2로 옮겨졌습니다. 구버전 백엔드는 **2026-07-20 이후 데이터가 들어오지 않습니다.**

- `_구버전/dashboard/` → `dashboard-v2/` 사용
- `_구버전/gas/Categorizer.gs`, `_구버전/gas/VOC_통합스크립트.gs` → `gas/voc-v2/` 사용

2026-10-30에 `_구버전/`으로 옮겼습니다. 그래서 옛 주소(`…/CS/dashboard/`)는 이제 열리지 않습니다.

## 저장소에 올리지 않는 것

공개 저장소라 개인정보가 들어간 파일은 절대 올리면 안 됩니다. `.gitignore`에 등록된 것:

| 대상 | 이유 |
|---|---|
| `cs-triage/상담내역/**/*.xlsx` | 상담 원본 — 고객 개인정보 |
| `cs-triage/ALF_docs_미검색_추출_*.xlsx` | 상담 링크 포함 |
| `cs-triage/케어아카데미_AI사람_기준표_통합본.xlsx` | 상담 링크 1,885건 포함 |
| `b2g_2026/*.csv` | 성명 · 전화번호 · 생년월일 포함 |
| `채널톡/` · `voc-원문/` | 채널톡 export 원문 — 고객 개인정보 |
| `.omc/` | 작업 도구 임시 상태 |
| `.clasp.json` · `.local.json` (모든 폴더) | Apps Script 배포 식별자 · 웹앱 주소·열쇠 |

**새 파일을 올리기 전에**: 고객 이름·전화번호·생년월일·주민번호가 있는지 한 번 열어보세요.
엑셀·CSV·PDF가 특히 위험합니다.
