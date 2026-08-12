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
| https://eunjua.github.io/CS/cs-guide/ | `cs-guide/` | CS 응대 가이드 (신입 교육용 흐름도) |
| https://eunjua.github.io/CS/email-sender/ | `email-sender/` | 발송 도구 (메일 · 문자 · 알림톡) |
| https://eunjua.github.io/CS/cert/ | `cert/` | 증명서 발급 (교육 이수증 · 시험응시 확인서) |
| https://eunjua.github.io/CS/dashboard/ | `dashboard/` | VOC 주간 대시보드 — **구버전** |

## 화면 ↔ 백엔드 연결

Apps Script 프로젝트 5개가 돌아갑니다. **폴더 경계와 프로젝트 경계가 다르니 주의하세요.**

| 화면 | 백엔드 파일 | 배포 |
|---|---|---|
| `email-sender/` | `gas/EmailSender.gs` + `gas/BizmSender.gs` | 수동 복붙 |
| `cs-guide/` | `gas/CSGuide.gs` → 구글시트 '케이스' 탭 | 수동 복붙 |
| `dashboard-v2/` | `gas-v2/` 전체 (`WebApp.gs`가 진입점) | clasp 자동 |
| (화면 없음) | `gas-cert/Code.js` → 자격증 기준 시트 | clasp 자동 |
| `dashboard/` (구버전) | `gas/VOC_통합스크립트.gs` + `gas/Categorizer.gs` | 수동 복붙 |
| `cert/` | **없음** — 브라우저에서 바로 PDF 생성 | — |

**`gas/` 폴더 주의** — 한 폴더에 서로 다른 구글 프로젝트 3개가 섞여 있습니다.
`EmailSender.gs`와 `BizmSender.gs`는 **반드시 같은 프로젝트에 함께** 넣으세요
(문자·알림톡 요청이 `EmailSender.gs` → `sendBizm_()`로 넘어갑니다).

## 폴더 지도

| 폴더 | 하는 일 |
|---|---|
| `cs-triage/` | ALF(AI 상담봇) 개선 사이클 — 규칙·정책 문서, 상담내역 판정, 개선로그 |
| `dashboard-v2/` + `gas-v2/` | VOC 대시보드 v2 — **현재 사용** |
| `cs-guide/` | CS 응대 가이드 화면 (`/case` 스킬로 케이스 추가) |
| `email-sender/` | 발송 도구 화면 (메일 · 문자 · 알림톡) |
| `cert/` | 증명서 발급 화면 — 고객에게 주는 이수증 · 시험응시 확인서 |
| `certification/` | 민간자격 **운영규정** 생성 (`/certification` 스킬) — 자격증 신규 등록 시 심사기관 제출용 |
| `gas-cert/` | 자격증 기준 시트 스크립트 (배송확인리스트) |
| `b2g_2026/` | B2G 현장점검 대응 — 취업확인서 일괄 수정, 소명서 |
| `gas/` | 백엔드 모음 — 위 "화면 ↔ 백엔드 연결" 참고 |
| `dashboard/` | VOC 주간 대시보드 — **구버전** |

`cert/`와 `certification/`은 이름만 비슷하고 하는 일이 완전히 다릅니다.
`cert/`는 **고객**에게 주는 증명서, `certification/`은 **심사기관**에 내는 규정 문서예요.

## 구버전 — 수정하지 마세요

VOC 파이프라인은 v2로 옮겨졌습니다. 구버전 백엔드는 **2026-07-20 이후 데이터가 들어오지 않습니다.**

- `dashboard/` → `dashboard-v2/` 사용
- `gas/Categorizer.gs`, `gas/VOC_통합스크립트.gs` → `gas-v2/` 사용

폴더를 남겨둔 이유는 웹 주소가 깨지지 않게 하기 위해서입니다.

`gas/`의 나머지 3개(`BizmSender.gs`·`EmailSender.gs`·`CSGuide.gs`)는 **현역**이니 지우지 마세요.

## 저장소에 올리지 않는 것

공개 저장소라 개인정보가 들어간 파일은 절대 올리면 안 됩니다. `.gitignore`에 등록된 것:

| 대상 | 이유 |
|---|---|
| `cs-triage/상담내역/**/*.xlsx` | 상담 원본 — 고객 개인정보 |
| `cs-triage/ALF_docs_미검색_추출_*.xlsx` | 상담 링크 포함 |
| `cs-triage/케어아카데미_AI사람_기준표_통합본.xlsx` | 상담 링크 1,885건 포함 |
| `b2g_2026/*.csv` | 성명 · 전화번호 · 생년월일 포함 |
| `.omc/` | 작업 도구 임시 상태 |
| `*/.clasp.json` | Apps Script 배포 식별자 |

**새 파일을 올리기 전에**: 고객 이름·전화번호·생년월일·주민번호가 있는지 한 번 열어보세요.
엑셀·CSV·PDF가 특히 위험합니다.
