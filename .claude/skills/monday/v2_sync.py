#!/usr/bin/env python3
"""채널톡 export를 VOC 대시보드 v2에 올리고 시트 버튼 3개(불러오기 → 만족도 → 집계)를 대신 누른다.

사용:
  python3 v2_sync.py init                 # 처음 한 번: 열쇠 만들어 웹앱에 등록 (.local.json에 url이 있어야 함)
  python3 v2_sync.py upload 채널톡        # 폴더 바로 아래 xlsx를 드라이브 입력 폴더에 올림 (이미 있으면 건너뜀)
  python3 v2_sync.py refresh              # 불러오기 → 만족도(새 응답만 추가) → 집계
  python3 v2_sync.py all 채널톡           # upload + refresh

- 웹앱 주소·열쇠는 gas-v2/.local.json (git에 안 올라감)
- 만족도 "전부 지우고 다시 받기?"에는 항상 [아니오]로 답한다 (은주가 늘 누르던 쪽)
"""
import base64
import json
import secrets
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LOCAL = ROOT / "gas-v2" / ".local.json"


def load_conf():
    if not LOCAL.exists():
        sys.exit(f"{LOCAL} 가 없음 — 웹앱 배포 후 {{\"url\": \"...\"}} 로 만들어 주세요")
    return json.loads(LOCAL.read_text())


def post(url, payload, timeout=360):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        text = res.read().decode()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        sys.exit("웹앱이 JSON이 아닌 응답을 줌 (권한 허용이 풀렸거나 배포 문제):\n" + text[:300])


def call(payload, timeout=360):
    conf = load_conf()
    result = post(conf["url"], {"token": conf["token"], **payload}, timeout)
    if not result.get("ok"):
        sys.exit("실패: " + json.dumps(result, ensure_ascii=False))
    return result


def init():
    conf = load_conf()
    if conf.get("token"):
        sys.exit("이미 열쇠가 있음 — 다시 만들려면 스크립트 속성 TOKEN과 .local.json token을 함께 지우세요")
    token = secrets.token_urlsafe(32)
    result = post(conf["url"], {"action": "init", "token": token})
    if not result.get("ok"):
        sys.exit("등록 실패: " + json.dumps(result, ensure_ascii=False))
    conf["token"] = token
    LOCAL.write_text(json.dumps(conf, ensure_ascii=False, indent=2))
    print("열쇠 등록 완료")


def upload(folder):
    files = sorted(Path(folder).glob("*.xlsx"))
    if not files:
        sys.exit(f"{folder} 에 xlsx가 없음")
    for f in files:
        b64 = base64.b64encode(f.read_bytes()).decode()
        r = call({"action": "upload", "name": f.name, "b64": b64}, timeout=180)
        print(("건너뜀(이미 있음) " if r.get("skipped") else "올림 ") + f.name)


def refresh():
    r = call({"action": "refresh"})
    for step in r["steps"]:
        print(f"── {step['step']}")
        for m in step["messages"]:
            print("   " + m.replace("\n", "\n   "))
    print(f"집계_주차 행 수: {r['weeks']}")


def main():
    args = sys.argv[1:]
    if args == ["init"]:
        init()
    elif len(args) == 2 and args[0] == "upload":
        upload(args[1])
    elif args == ["refresh"]:
        refresh()
    elif len(args) == 2 and args[0] == "all":
        upload(args[1])
        refresh()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
