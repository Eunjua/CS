#!/usr/bin/env python3
"""강의 상세페이지에서 과정 정보 읽기.

사용: python3 from_detail_page.py https://www.carepartner.kr/academy/77   (번호 77만 줘도 됨)
- 페이지에 심긴 데이터(__NEXT_DATA__)에서 발급 기관·등록번호·강의 수·강의 시간·소개·활용처·일자리를 뽑아 JSON으로 출력
- 강의 시간 = 운영 중(ACTIVE) 영상 길이 합계, 초는 버림 → "4시간 47분" / 딱 떨어지면 "7시간"
  (기존 시트 값과 같은 방식: 세탁기분해세척관리사 4시간 35분 54초 → 4시간 35분)
"""
import json
import re
import sys
import urllib.request

ORG = {"ncs": "한국엔씨에스자격개발원(주)", "korean": "한국검정평가원", "baby": "(주)한국자격개발원"}


def find_videos(o, out):
    if isinstance(o, dict):
        if isinstance(o.get("videos"), list):
            out.extend(o["videos"])
        for v in o.values():
            find_videos(v, out)
    elif isinstance(o, list):
        for v in o:
            find_videos(v, out)


def hours_text(sec):
    h, m = sec // 3600, sec % 3600 // 60
    return f"{h}시간 {m}분" if m else f"{h}시간"


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    arg = sys.argv[1].strip()
    url = arg if arg.startswith("http") else f"https://www.carepartner.kr/academy/{arg}"
    html = urllib.request.urlopen(url, timeout=30).read().decode()
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        sys.exit("페이지에서 __NEXT_DATA__를 못 찾음 — 상세페이지가 아직 안 열렸거나 구조가 바뀜")
    props = json.loads(m.group(1))["props"]["pageProps"]
    course = (props.get("data") or {}).get("course") or {}
    cert = course.get("certificate") or {}
    issuer = cert.get("issuer") or {}
    lic = cert.get("license") or {}
    content = props.get("contentJson") or {}

    videos = []
    find_videos(props, videos)
    active = [v for v in videos if v.get("status") == "ACTIVE"]
    total = sum(v.get("duration") or 0 for v in active)

    reg = content.get("register_number") or ""
    if not reg and lic.get("registrationYear") and lic.get("registrationNumber"):
        reg = f'{lic["registrationYear"]}-{lic["registrationNumber"]}'

    print(json.dumps({
        "name": content.get("title") or course.get("title") or "",
        "org": issuer.get("description") or ORG.get(issuer.get("name"), ""),
        "orgCode": issuer.get("name") or "",
        "registerNumber": reg,
        "lectures": f"{len(active)}강" if active else "",
        "hours": hours_text(total) if total else "",
        "detailUrl": url,
        "shortDescription": content.get("short_description") or "",
        "description": content.get("description") or "",
        "usage": content.get("usage") or [],
        "jobs": [f'{j.get("title")} — {j.get("content")}' for j in content.get("jobs") or []],
        "videoTitles": [v.get("title") for v in sorted(active, key=lambda v: v.get("order") or 0)],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
