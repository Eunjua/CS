# 취업확인서 정보 일괄 수정 가이드 (B2G 현장점검 대응)

정부 제출용 취업확인서의 기재값을 어드민 화면 대신 **CSV + curl로 일괄 교정**할 때 쓰는 문서다.
건수가 적으면 어드민 화면(공고 상세 → 「취업확인서 정보 수정」 / 「채용자 정보 수정」)이 더 안전하다.
**수십 건 이상을 한 번에 고쳐야 할 때만** 이 절차를 쓴다.

> ⚠️ 이 API들은 **감사로그를 남기지 않는다.** 정책상 허용되지 않는 예외 조치라 의도적으로 뺐다.
> 누가 언제 무엇을 바꿨는지 서버에 기록이 없으므로, **사용한 CSV와 실행 로그를 반드시 보관한다.**

---

## 0. 준비물 체크리스트

- [ ] 어드민 계정 (주민등록번호를 다루면 **개인정보취급자 = 권한 2** 필요)
- [ ] 어드민에 로그인된 브라우저
- [ ] 교정할 대상 목록 (공고 public ID 또는 참여내역 ID)
- [ ] `curl`, `jq` (없으면 `brew install jq`)

---

## 1. 토큰 꺼내기

어드민에 로그인한 브라우저에서 **개발자도구 → Console** 에 입력한다.

```js
JSON.parse(localStorage.getItem('app')).accessToken
```

출력 예시:

```
"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

> **함정**: 이 값에는 **이미 `Bearer ` 접두가 포함돼 있다.**
> curl에서 `-H "Authorization: Bearer $TOKEN"` 처럼 다시 붙이면 `Bearer Bearer ...`가 되어 401이 난다.
> **`-H "Authorization: $TOKEN"` 으로 그대로 쓴다.**

터미널에 등록한다. (앞뒤 큰따옴표는 뺀다)

```bash
export TOKEN="Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## 2. API 주소 확인

개발자도구 **Network** 탭에서 아무 요청이나 잡아 `api/v3/...` 앞부분을 복사한다.

```bash
export BBAS="https://<확인한 bbas 호스트>"
```

> 스테이징에서 먼저 검증하고 운영에 적용한다. 호스트를 헷갈리면 운영 데이터가 바뀐다.

---

## 3. API 2종

### 3-1. 채용자 정보 — `PATCH /api/v3/success-user-bo/{jobPostingPublicId}`

참여자 이름 · B2G 동의 날짜 · 주민등록번호를 고친다. **권한 2 필요.**

| 필드 | 타입 | 설명 |
|---|---|---|
| `userName` | string | `job_posting_results.user_name`. 확인서에 인쇄되는 이름 |
| `governmentParticipatedAt` | `YYYY-MM-DD` | B2G 동의일 |
| `securityNumber` | 숫자 13자리 | 하이픈 없이. 평문으로 보내면 서버가 암호화 |

- 세 필드 모두 **선택**이다. 보낸 것만 반영된다.
- 하나의 트랜잭션으로 처리된다. 중간 실패 시 전부 롤백.
- **`governmentParticipatedAt`은 B2G 참여 이력이 있을 때만 반영된다.** 이력이 없으면 레코드를 새로 만들지 않고 조용히 건너뛴다 → 응답의 `governmentParticipatedAtUpdated`로 확인해야 한다.

### 3-2. 취업확인서 기재값 — `PATCH /api/v3/job-support-project-participant-bo/{participantId}`

급여 · 서명일자 · 근무시작일 · 센터 대표자명을 고친다. **admin 인증만 필요(권한 2 불필요).**
`multipart/form-data`로 보낸다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `payType` | `HOURLY` \| `MONTHLY` | 시급 / 월급. 대문자 |
| `payAmount` | 정수 | 원 단위. **쉼표 금지** |
| `signedAt` | `YYYY-MM-DD` | 서명일자 |
| `workStartDate` | `YYYY-MM-DD` | 근무 시작일 |
| `ceoName` | string | 센터 대표자명 |
| `file` | 파일 | 서명 이미지. 일괄 처리에서는 보통 안 쓴다 |

- 급여·대표자명은 **이 확인서에만 반영**된다. 공고 원본과 센터 정보는 바뀌지 않는다.
- `signedAt`이 `workStartDate`보다 일러도 **서버가 막지 않는다.** 값 검증은 사람이 한다.

### 3-3. 응답 형태

모든 응답은 공통 래퍼로 감싸진다.

```json
{ "success": true, "code": 200, "data": { ... } }
```

`success-user-bo`의 `data`는 **무엇이 실제로 반영됐는지** 알려준다.

```json
{
  "success": true,
  "code": 200,
  "data": {
    "userNameUpdated": true,
    "governmentParticipatedAtUpdated": false,
    "securityNumberUpdated": true
  }
}
```

> `governmentParticipatedAtUpdated: false` → 값을 보냈는데 반영 안 됨 = **B2G 참여 이력이 없는 유저**다.
> HTTP 200이라 성공처럼 보이므로 이 플래그를 꼭 확인한다.

### 3-4. 주요 오류

| 코드 | 원인 | 대응 |
|---|---|---|
| 401 | 토큰 만료, 또는 `Bearer` 중복 | 토큰 다시 복사 (1번) |
| 403 | 권한 2 없음 | 주민등록번호·채용자 정보는 개인정보취급자만 |
| 400 | 형식 오류 (주민번호 13자리 아님, 날짜 형식, `payType` 소문자 등) | 응답 `message` 확인 |
| 400 | `공고를 찾을 수 없습니다` / `채용결과가 없거나...` | 공고 ID 오타, 또는 채용 성공 결과가 없는 공고 |

---

## 4. 대상 ID 찾기

**공고 public ID** — 어드민 공고 상세 URL의 마지막 조각. 예: `/job-postings/hf6vw8mv2l` → `hf6vw8mv2l`

**참여내역 ID** — 어드민 `일자리지원사업 참여 내역` 목록(`/job-support-project-participants`)에서 `공고 ID`로 필터해 `ID` 컬럼을 본다.

> 참여내역 ID는 공고 public ID와 다르다. 두 API가 서로 다른 식별자를 쓰므로 CSV를 나눠 만든다.

---

## 5. CSV 준비

헤더 포함, UTF-8, 쉼표 구분. **값에 쉼표가 들어가면 안 된다**(금액에 쉼표 금지).

`success-user.csv`
```csv
jobPostingPublicId,userName,governmentParticipatedAt,securityNumber
hf6vw8mv2l,김은주,2026-05-23,9001011234567
ab12cd34ef,박영희,2026-05-24,
```

`confirmation.csv`
```csv
participantId,payType,payAmount,signedAt,workStartDate,ceoName
11048,MONTHLY,3000000,2026-06-23,2026-05-23,황순좌
11049,HOURLY,10320,2026-06-25,2026-06-01,김철수
```

빈 값은 그 필드를 **보내지 않음**을 뜻한다 (아래 스크립트가 빈 값을 걸러낸다).

---

## 6. 1단계 — 단건 테스트 (필수)

전체를 돌리기 전에 **반드시 1건만** 먼저 실행하고 어드민 화면에서 눈으로 확인한다.

### 채용자 정보

```bash
curl -sS -X PATCH "$BBAS/api/v3/success-user-bo/hf6vw8mv2l" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userName":"김은주","governmentParticipatedAt":"2026-05-23"}' | jq
```

### 취업확인서 기재값

```bash
curl -sS -X PATCH "$BBAS/api/v3/job-support-project-participant-bo/11048" \
  -H "Authorization: $TOKEN" \
  -F "payType=MONTHLY" \
  -F "payAmount=3000000" \
  -F "signedAt=2026-06-23" | jq
```

**확인할 것**

1. `success: true`
2. `success-user-bo`라면 `*Updated` 플래그가 기대대로인지
3. **어드민 공고 상세 화면을 새로고침**해 값이 실제로 바뀌었는지

여기서 틀리면 전체를 돌렸을 때 같은 실수가 N배로 퍼진다. **되돌리는 API는 없다.**

---

## 7. 2단계 — 소규모 배치 (3건)

CSV 상단 3건만 잘라 스크립트를 검증한다.

```bash
head -n 4 success-user.csv > sample.csv   # 헤더 1줄 + 데이터 3줄
```

`patch-success-user.sh`

```bash
#!/usr/bin/env bash
set -uo pipefail
CSV="${1:?csv 경로를 넘겨주세요}"

tail -n +2 "$CSV" | while IFS=, read -r pid name agreedAt ssn; do
  [ -z "${pid:-}" ] && continue

  body=$(jq -nc \
    --arg name "$name" --arg agreedAt "$agreedAt" --arg ssn "$ssn" \
    '{}
     | (if $name    != "" then .userName = $name                  else . end)
     | (if $agreedAt != "" then .governmentParticipatedAt = $agreedAt else . end)
     | (if $ssn     != "" then .securityNumber = $ssn             else . end)')

  res=$(curl -sS -w '\n%{http_code}' -X PATCH "$BBAS/api/v3/success-user-bo/$pid" \
    -H "Authorization: $TOKEN" -H "Content-Type: application/json" -d "$body")

  code=$(tail -n1 <<<"$res")
  json=$(sed '$d' <<<"$res")
  echo "[$code] $pid $(jq -c '.data // .message' <<<"$json" 2>/dev/null || echo "$json")"

  sleep 0.2
done
```

```bash
chmod +x patch-success-user.sh
./patch-success-user.sh sample.csv | tee run-sample.log
```

출력 예시

```
[200] hf6vw8mv2l {"userNameUpdated":true,"governmentParticipatedAtUpdated":true,"securityNumberUpdated":false}
[200] ab12cd34ef {"userNameUpdated":true,"governmentParticipatedAtUpdated":false,"securityNumberUpdated":false}
[400] zz99yy88xx "공고를 찾을 수 없습니다."
```

3건이 모두 의도대로면 다음 단계로 간다.

취업확인서 기재값용 스크립트는 `-F`로 바꾸면 된다.

```bash
tail -n +2 "$CSV" | while IFS=, read -r id payType payAmount signedAt workStartDate ceoName; do
  [ -z "${id:-}" ] && continue
  args=()
  [ -n "$payType" ]       && args+=(-F "payType=$payType")
  [ -n "$payAmount" ]     && args+=(-F "payAmount=$payAmount")
  [ -n "$signedAt" ]      && args+=(-F "signedAt=$signedAt")
  [ -n "$workStartDate" ] && args+=(-F "workStartDate=$workStartDate")
  [ -n "$ceoName" ]       && args+=(-F "ceoName=$ceoName")

  res=$(curl -sS -w '\n%{http_code}' -X PATCH \
    "$BBAS/api/v3/job-support-project-participant-bo/$id" \
    -H "Authorization: $TOKEN" "${args[@]}")
  echo "[$(tail -n1 <<<"$res")] $id"
  sleep 0.2
done
```

---

## 8. 3단계 — 전체 처리

```bash
./patch-success-user.sh success-user.csv | tee run-$(date +%Y%m%d-%H%M).log
```

끝난 뒤 **실패 건만 추린다.**

```bash
grep -v '^\[200\]' run-*.log
```

실패 건은 원인을 고쳐 **그 건만 담은 CSV로 재실행**한다. 성공한 건을 다시 실행해도 같은 값이면 문제는 없지만, 로그가 섞이니 분리하는 편이 낫다.

---

## 9. 처리 후 정리

- [ ] `grep -v '^\[200\]'` 결과가 비었는지
- [ ] `governmentParticipatedAtUpdated: false`인 건 목록화 — **B2G 참여 이력이 없어 동의일을 못 채운 유저다.** 별도 대응이 필요하다
- [ ] 어드민에서 표본 몇 건을 눈으로 확인
- [ ] 취업확인서 PDF/이미지 다운로드가 정상인지 표본 확인
- [ ] **주민등록번호가 들어간 CSV 삭제** (`rm success-user.csv`)
- [ ] 실행 로그는 보관 (감사로그가 없으므로 이게 유일한 기록)

---

## 10. 주의사항

**되돌릴 수 없다.** 이전 값을 복원하는 API가 없다. 대량 수정 전에 대상의 현재 값을 쿼리로 백업해 두는 편이 안전하다.

**주민등록번호를 평문 CSV로 다룬다.** 파일을 공유 드라이브·슬랙에 올리지 않는다. 로컬에서만 쓰고 처리 후 즉시 삭제한다. 실행 로그에는 주민번호가 남지 않지만(응답은 플래그만 반환) CSV에는 남는다.

**감사로그가 없다.** 서버에 기록이 남지 않으므로 CSV와 실행 로그가 유일한 근거다.

**200이 곧 반영은 아니다.** `success-user-bo`는 `*Updated` 플래그를 봐야 한다. 특히 동의일은 참여 이력이 없으면 조용히 건너뛴다.

**서명일자 검증은 사람이 한다.** 서버는 `signedAt < workStartDate`를 막지 않는다. 현장점검 지적사항이 바로 이 케이스이므로 CSV를 만들 때 확인한다.

**요청 간격.** 스크립트에 `sleep 0.2`이 들어 있다. 건수가 많다면 유지하는 편이 좋다.

---

## 관련 문서

- 설계 배경과 결정 로그: `.claude/spec/b2g_현장점검대응/취업확인서-수정/feature/`
- 어드민 화면 사용: 공고 상세 → 「취업확인서 정보 수정」 / 「채용자 정보 수정」
