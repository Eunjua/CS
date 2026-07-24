# 자격증 발급 스크립트 (기준 시트 자동 배포)

`Code.js` 를 고친 뒤 아래 명령 한 줄이면 **기준 시트에 바로 반영**됩니다.
Apps Script 편집기에 붙여넣을 필요 없습니다.

```bash
cd gas-cert && clasp push --force
```

## 어디에 반영되나

| | |
|---|---|
| 기준 시트 | `![월]자격증관리(월 일 결제자부터)` |
| 시트 링크 | https://docs.google.com/spreadsheets/d/176YVTv5JM21i1p7fc6pBz_kmXnP8AYAXwseLXeBEr6g/edit |
| 편집기 파일명 | `코드.gs` (로컬에서는 `Code.js`) |

## 꼭 알아둘 것

**이미 복사해 둔 시트에는 반영되지 않습니다.**
`clasp push` 는 기준 시트만 바꿉니다. 그 뒤에 **새로 복사하는 시트부터** 최신 코드로 만들어집니다.
`[7월]`, `[6월]` 처럼 이미 만들어진 시트에 반영하려면 그 시트의 코드를 따로 갱신해야 합니다.

**시트 편집기에서 직접 코드를 고쳤다면 먼저 내려받으세요.**
`clasp push` 는 시트 코드를 덮어쓰기 때문에, 편집기에서 손댄 내용이 있으면 사라집니다.

```bash
cd gas-cert && clasp pull      # 시트의 현재 코드 내려받기
git diff                        # 로컬과 뭐가 다른지 확인
```

## 파일 설명

- `Code.js` — 자격증 발급·배송·정산 스크립트 본체 (이것만 고치면 됩니다)
- `appsscript.json` — 시간대·런타임 설정 (건드릴 일 거의 없음)
- `.clasp.json` — 어느 시트에 배포할지 가리키는 주소. git에 올리지 않음 (`.gitignore` 처리)

`.clasp.json` 이 없어졌다면 아래 내용으로 다시 만드세요.

```json
{
  "scriptId": "1Utxy2c43xdc6hOpQG9y4xmgML-6vObgT8CqPNzesw7v17y4nMdnG3ioP",
  "rootDir": "",
  "parentId": "176YVTv5JM21i1p7fc6pBz_kmXnP8AYAXwseLXeBEr6g"
}
```
