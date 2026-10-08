#!/usr/bin/env python3
"""자격증관리 시트 읽기·쓰기 (크롬 없이, gas-address-check 웹앱 경유).

사용:
  python3 sheet_io.py init                          # 처음 한 번: 열쇠 만들어 웹앱에 등록
  python3 sheet_io.py find                          # 이번 달 시트 찾기 ([N월] 자격증관리 중 만든 날이 가장 늦은 것)
  python3 sheet_io.py read  "<시트 링크>" <작업폴더>   # 대상 행 → <작업폴더>/rows.json
  python3 sheet_io.py write "<시트 링크>" <작업폴더>   # <작업폴더>/result.json의 불일치·동호수만 입력

- <시트 링크> 자리에는 링크나 시트 ID(find 출력)를 넣는다. gid 없으면 0 = 제작리스트.
- write는 칸이 아직 비어 있을 때만 넣고, 입력 전후 '주소 확인' 열 값별 개수를 보여준다.
- 작업폴더는 저장소 밖이어야 한다(고객 주소). 웹앱 주소·열쇠는 gas-address-check/.local.json.
"""
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LOCAL = ROOT / "gas-address-check" / ".local.json"
WRITABLE = ("불일치", "동호수")


def post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        try:
            with urllib.request.urlopen(req, timeout=180) as res:
                text = res.read().decode()
        except urllib.error.HTTPError as err:
            if err.code not in (404, 500, 502, 503):
                raise
            time.sleep(3)  # 배포·권한 허용 직후 잠깐 404가 난다(2026-10-07) — 한 번만 다시
            with urllib.request.urlopen(req, timeout=180) as res:
                text = res.read().decode()
    except urllib.error.HTTPError as err:
        sys.exit(f"웹앱이 {err.code} 오류를 줌 — 권한 허용 전이거나 배포가 바뀜. "
                 "앱스크립트 편집기에서 authorize를 한 번 실행해 허용해 주세요.")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        sys.exit("웹앱이 JSON이 아닌 응답(로그인 화면)을 줌 — 권한 허용 전이거나 권한이 늘어남. "
                 "앱스크립트 편집기에서 authorize를 한 번 실행해 허용해 주세요.")


def call(payload):
    if not LOCAL.exists():
        sys.exit(f"{LOCAL} 가 없음 — 웹앱 주소·열쇠 파일이 이 컴퓨터에 없다")
    conf = json.loads(LOCAL.read_text())
    result = post(conf["url"], {"token": conf["token"], **payload})
    if not result.get("ok"):
        sys.exit("실패: " + json.dumps(result, ensure_ascii=False))
    return result


def parse_link(link):
    if re.fullmatch(r"[A-Za-z0-9_-]{30,}", link):
        return link, 0
    m = re.search(r"/spreadsheets/d/([A-Za-z0-9_-]+)", link)
    if not m:
        sys.exit("구글 시트 링크가 아님: " + link)
    g = re.search(r"gid=(\d+)", link)
    return m.group(1), int(g.group(1)) if g else 0


def work_dir(path):
    w = os.path.realpath(path)
    if w == str(ROOT) or w.startswith(str(ROOT) + os.sep):
        sys.exit("작업폴더는 저장소 밖이어야 해요 (고객 주소가 들어가고 저장소는 공개예요).")
    os.makedirs(w, exist_ok=True)
    return Path(w)


def init():
    conf = json.loads(LOCAL.read_text())
    if conf.get("token"):
        sys.exit("이미 열쇠가 있음")
    token = secrets.token_urlsafe(32)
    r = post(conf["url"], {"action": "init", "token": token})
    if not r.get("ok"):
        sys.exit("등록 실패: " + json.dumps(r, ensure_ascii=False))
    conf["token"] = token
    LOCAL.write_text(json.dumps(conf, ensure_ascii=False, indent=2))
    print("열쇠 등록 완료")


def find():
    cands = call({"action": "find"})["candidates"]
    if not cands:
        sys.exit("이름이 [N월]로 시작하는 자격증관리 시트를 찾지 못함 — 링크를 직접 주세요")
    top = cands[0]
    print(f"이번 달 시트: {top['name']} (만든 날 {top['created']})")
    print(f"ID {top['id']}")
    for c in cands[1:]:
        print(f"  그 전: {c['name']} (만든 날 {c['created']})")


def read(link, work):
    sheet_id, gid = parse_link(link)
    r = call({"action": "read", "sheetId": sheet_id, "gid": gid})
    (work / "rows.json").write_text(json.dumps(r["todo"], ensure_ascii=False))
    print(f"탭 {r['sheet']} · 열 {r['cols']} · 전체 {r['rows']}행 · 대상 {len(r['todo'])}행")
    print("주소 확인 열 지금:", r["counts"])


def write(link, work):
    sheet_id, gid = parse_link(link)
    res = json.loads((work / "result.json").read_text())
    cells = [[x["row"], x["res"]] for x in res if x["res"] in WRITABLE]
    if not cells:
        print("넣을 칸 없음")
        return
    r = call({"action": "write", "sheetId": sheet_id, "gid": gid, "cells": cells})
    print(f"입력 {len(r['written'])}칸 · 이미 값이 있어 건너뜀 {r['skipped']}")
    print("입력 전:", r["before"])
    print("입력 후:", r["after"])


def main():
    a = sys.argv[1:]
    if a == ["init"]:
        init()
    elif a == ["find"]:
        find()
    elif len(a) == 3 and a[0] in ("read", "write"):
        (read if a[0] == "read" else write)(a[1], work_dir(a[2]))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
