#!/usr/bin/env python3
"""자격증 상세 시트에 한 줄 보내기.

사용: python3 send_to_sheet.py '{"name":"실버케어지도사 1급","org":"...","lectures":"18강","hours":"...","detailUrl":"...","pdfUrl":"..."}'
- 같은 과정명이 시트에 있으면 그 줄을 고치고, 없으면 새 줄을 추가한다
- 빈 값은 보내도 기존 칸을 지우지 않는다
- 웹앱 주소·열쇠는 gas-cert-detail/.local.json (git에 안 올라감)
"""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LOCAL = ROOT / "gas-cert-detail" / ".local.json"


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    if not LOCAL.exists():
        sys.exit(f"{LOCAL} 가 없음 — 웹앱 주소·열쇠 파일이 이 컴퓨터에 없다")
    conf = json.loads(LOCAL.read_text())
    row = json.loads(sys.argv[1])
    body = json.dumps({"token": conf["token"], "row": row}).encode()
    req = urllib.request.Request(conf["url"], data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as res:
        text = res.read().decode()
    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        sys.exit("웹앱이 JSON이 아닌 응답을 줌 (권한 허용이 풀렸거나 배포 문제):\n" + text[:300])
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result.get("ok"):
        sys.exit(1)


if __name__ == "__main__":
    main()
