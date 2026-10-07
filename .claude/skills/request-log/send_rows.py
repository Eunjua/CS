#!/usr/bin/env python3
"""은주에게 요청한 것들 시트3에 줄 보내기.

사용:
  python3 send_rows.py types              # H1 드롭다운의 유형 목록 보기
  python3 send_rows.py append rows.json   # 줄 추가 (rows.json = [{date,requester,type,content,link}, ...])
  python3 send_rows.py range 2026-10-05   # 그날 0시~24시(한국시간) 슬랙 oldest/latest 값

- 같은 링크가 시트 E열에 이미 있으면 그 줄은 건너뛴다
- 유형이 드롭다운에 없거나 날짜 형식이 틀린 줄이 하나라도 있으면 아무것도 쓰지 않는다
- 웹앱 주소·열쇠는 gas-request-log/.local.json (git에 안 올라감)
"""
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LOCAL = ROOT / "gas-request-log" / ".local.json"
KST = timezone(timedelta(hours=9))


def call(payload):
    if not LOCAL.exists():
        sys.exit(f"{LOCAL} 가 없음 — 웹앱 주소·열쇠 파일이 이 컴퓨터에 없다")
    conf = json.loads(LOCAL.read_text())
    body = json.dumps({"token": conf["token"], **payload}).encode()
    req = urllib.request.Request(conf["url"], data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as res:
        text = res.read().decode()
    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        sys.exit("웹앱이 JSON이 아닌 응답을 줌 (권한 허용이 풀렸거나 배포 문제):\n" + text[:300])
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result.get("ok"):
        sys.exit(1)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    if cmd == "types":
        call({"action": "types"})
    elif cmd == "append" and len(sys.argv) == 3:
        rows = json.loads(Path(sys.argv[2]).read_text())
        call({"action": "append", "rows": rows})
    elif cmd == "range" and len(sys.argv) == 3:
        start = datetime.strptime(sys.argv[2], "%Y-%m-%d").replace(tzinfo=KST)
        print(json.dumps({"oldest": str(int(start.timestamp())),
                          "latest": str(int((start + timedelta(days=1)).timestamp()))}))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
