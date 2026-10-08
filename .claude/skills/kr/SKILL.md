---
name: kr
description: 4분기 CX KR 대시보드(웹 페이지)의 주간 숫자를 자동으로 채운다. VOC 대시보드 v2 집계(문의 건수·설문 해결률·상담원 만족도·채팅 인입)와 요청 건수 시트(후처리 요청)를 읽어 주차별 KR1 비율과 가드레일을 계산하고 대시보드 저장소에 넣는다. 사용자가 "KR 업데이트해줘", "KR 대시보드 갱신", "이번 주 KR 채워줘", "KR 숫자 넣어줘", "4분기 KR 어때" 같은 요청을 하면 사용. /kr 로도 호출.
---

# 4분기 KR 대시보드 갱신

- 대시보드: https://claude.ai/artifact/Bpe37UAZtUyMCCTfHzHzNq (저장소: `records` 주간 문서 `week_YYYY-MM-DD`, `config/targets`, `config/sync`)
- KR 원문: 노션 「26년 4분기」 (CX 하위)
- 계산: `.claude/skills/kr/update_kr.py` · 3분기 요청 건수(고정): `requests_q3_daily.json`
- KR2: `kr2_chats.py`(채널별 채팅 건수) · `kr2_params.json`(확인 2.5분·상담 4.0분·하루 480분·9월 비중 — 다시 재면 여기만 고친다) · 계산기 https://claude.ai/artifact/LcnLpvs9hN2kv6SgVE59a7 와 같은 식

## 자동으로 채우는 칸 / 손으로 넣는 칸

| 칸 | 출처 | 계산 |
|---|---|---|
| inquiries (KR1 분모) | v2 `week` | 총건수(채팅+전화), 주차 = 월~일 |
| requests (KR1 분자) | 요청 건수 시트 | 그 주에 기록된 요청 줄 수. 10/4까지는 「3분기」 피벗, 10/5부터 「4분기」 탭 |
| resolvedRate | v2 `survey` | "✅ 네, 해결됐어요" ÷ 해결여부 전체 응답 × 100 ("일부만"은 미해결 쪽) |
| csatAgent | v2 `agent` | 상담원 배정된 상담만, 응답 수 가중 평균. v2 `상담원만족도` 칸은 9월부터 AI 응대가 섞여서 쓰지 않는다 |
| chatInflow | v2 `week` | 채팅 |
| autoNote | — | v2 최신 주에 "집계 중일 수 있음" 표시 |
| handledPerDay · kr2 (KR2) | 은주 값 + export | 하루 480분 ÷ 1건당 평균. 채널별 1건당 = (1−관여율)×4.0 + 관여율×(2.5 + (1−해결률)×4.0), 그 주 채널별 채팅 건수로 가중(export 없으면 9월 비중). `kr2`에 채널별 관여율·해결률·채팅 건수·감당 건수를 남긴다 |

손으로: `csatAI`(cxScore), `note`. 스크립트는 이 칸을 건드리지 않는다.

KR2 목표는 **150건**(`config/targets.kr2Min`, 10/8 은주 결정). **은주 값이 없는 주는 KR2를 비워 둔다** — export의 봇완결률로 대신 채우지 않는다.

## 순서

0. **먼저 확인**: v2 집계가 돌았는지. 은주가 채널톡 파일 업로드 → 앱스크립트 [불러오기]·[만족도 불러오기]·[집계] 버튼을 눌러야 새 주가 생긴다. 스크립트 출력의 "v2 최신 주"가 지난주보다 이전이면 은주에게 알리고, 있는 만큼만 채운다.

1. **기존 문서 버전 받기** — `ArtifactData list` (url 위 주소, collection `records`, out_dir 쓰지 말 것: 보호 폴더라 거절됨). 결과에서 `{doc_id: version}`만 `$CLAUDE_JOB_DIR/tmp/kr_existing.json`(없으면 스크래치 폴더)에 적는다. `config` 도 list 해서 `sync` 버전을 기억한다.

2. **4분기 요청 건수 읽기** — Google Drive `read_file_content(fileId="1TEiCEEOwz-V6sgJ3B61Yn49WYGFRoEjqHnR6d0Uygk8")` → 「4분기」 시트의 A열 날짜별 줄 수를 센다 → `{"2026-10-05": 6, ...}` 로 `kr_q4.json`에 저장.
   - 셌으면 합계 = 표 범위 행 수 − 1(헤더)인지 맞춰본다. 다르면 잘린 것이니 멈추고 은주에게 말한다.
   - 요청은 `/요청기록` 스킬이 매일 채운다. 마지막 날짜가 어제보다 이전이면 "요청 기록이 ○일까지만 있음"을 함께 알린다(그 주 requests는 스크립트가 비워 둔다).

2-1. **KR2 재료** (월요일 export가 `채널톡/`에 있을 때)
   - **은주 값**: `/월요일` 시작 때 받은 채널별 관여율·해결률(지난주 값). `/kr` 단독 실행이면 은주에게 묻는다. 받은 값을 `kr2_inputs.json`(저장소 밖)에 `{"<지난주 월요일>": {"academy": {"ai": 0.93, "resolved": 0.564}, "partner": {"ai": 0.65, "resolved": 0.30}}}` 형식(소수)으로 적는다.
   - **채팅 건수**: `python3 .claude/skills/kr/kr2_chats.py 채널톡 --out <저장소 밖>/kr2_chats.json` — 채널별·주차별, 전화 제외. 채널을 못 가린 파일이 있으면 멈추고 알린다.

3. **계산**
   ```
   python3 .claude/skills/kr/update_kr.py --q4 <kr_q4.json> --existing <kr_existing.json> --kr2 <kr2_inputs.json> --chats <kr2_chats.json> --out <kr_batch.json>
   ```
   KR2 줄이 계산기와 크게 다르면(같은 값을 넣었는데) 쓰기 전에 원인을 본다. v2에 아직 없는 주는 KR2 칸만 들어간 문서로 쓴다.
   주차별 요약표가 출력된다. 숫자가 튀는 주(문의 건수가 평소 1,200건 안팎인데 크게 적음 등)는 쓰기 전에 원인을 본다.

4. **쓰기** — `kr_batch.json`의 `batches` 각각을 `ArtifactData batch`로 보낸다(이미 있는 문서는 update+if_version, 새 주는 set). 이어서 `config/sync`를 `sync` 값으로 update(if_version = 1단계에서 본 버전). 버전 충돌로 거절되면 1단계부터 다시.

5. **보고** — 이번에 새로 들어온 주의 KR1 비율(요청/문의)·KR2 감당 건수(채널별 포함)·해결률·상담원 만족도를 표로, 목표(KR1 3% 미만·KR2 150건 이상·상담원 만족도 4.1 이상) 대비 상태와 함께. KR2는 추정이고 가중 비중이 export인지 9월 고정인지 밝힌다. 최신 주가 집계 중이면 그 숫자는 확정 아님을 밝힌다.

## 주의

- 3분기 기준값(7/27~9/27 주)의 요청 건수는 「3분기」 피벗 기준이라 노션 월 숫자의 "+28·+27"(추가 요청)이 빠져 있다. 4분기 탭은 두 채널 요청을 다 담는다 → 3분기 대비 비교 시 4분기가 약간 불리하게 보일 수 있다.
- KR1 분모를 v2 총건수로 바꾸면서(은주 결정, 2026-10-07) 노션 월 기준(채널톡 통계)보다 비율이 낮게 나온다. 9월 주간 2.6~3.1%.
- 연도는 2026 고정(`YEAR`). 2027년 1월 주차가 생기면 스크립트를 고칠 것.
