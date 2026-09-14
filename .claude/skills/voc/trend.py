"""주제별 최근 4주 문의 추이 — 팀 공유용 "고객이 막힌 곳"의 숫자 줄을 만든다.

사용법:
  python3 trend.py 09/07~09/13 "결제 후 환불=아카데미_환불/자격증,아카데미_환불/거부" "수강 취소=아카데미_수강/수강취소"
  python3 trend.py --selftest

주제 이름=태그들(쉼표). 태그 묶음은 원문 요청 때 준 핵심+선택 태그로 한다.
판정: 이번 주 vs 앞 3주 평균. 20% 이상 **그리고** 5건 이상 차이 날 때만 늘었다/줄었다.
"""
import sys

from analyze import fetch

# 판정 문턱. %만 보면 5→7건도 +40%라 건수 조건을 같이 건다(analyze.py 급증 규칙과 같은 생각).
# 전주 대비만 보면 한 주 낮았던 뒤의 회복이 "+44%"로 보인다 — 그래서 앞 3주 평균과 비교한다.
PCT, MIN_DIFF = 20, 5


def verdict(values):
    """values: 오래된 주 → 이번 주, 4개. (앞 3주 평균, 증감률 또는 None, 판정)"""
    base, cur = sum(values[:3]) / 3, values[3]
    if not base:
        return base, None, '신규' if cur else '없음'
    diff = cur - base
    pct = diff / base * 100
    if pct >= PCT and diff >= MIN_DIFF:
        return base, pct, '늘었다'
    if pct <= -PCT and diff <= -MIN_DIFF:
        return base, pct, '줄었다'
    return base, pct, '비슷'


def selftest():
    assert verdict([40, 52, 32, 42])[2] == '비슷'       # 2026-09 결제 후 환불
    assert verdict([22, 35, 21, 34])[2] == '늘었다'     # 2026-09 수강 취소
    assert verdict([37, 42, 25, 36])[2] == '비슷'       # 전주 대비 +44%였지만 평소 수준
    assert verdict([30, 30, 30, 10])[2] == '줄었다'
    assert verdict([10, 10, 10, 13])[2] == '비슷'       # +30%지만 3건 차이
    assert verdict([0, 0, 0, 6])[2] == '신규'
    print('trend.py selftest ok')


def main(argv):
    if argv[:1] == ['--selftest']:
        return selftest()
    if len(argv) < 2 or any('=' not in g for g in argv[1:]):
        sys.exit(__doc__)

    week, groups = argv[0], argv[1:]
    d = fetch()
    weeks = [w['주차'] for w in d['week']]              # 최신순
    if week not in weeks:
        sys.exit(f"'{week}' 주차가 없어요. 있는 주차: {', '.join(weeks[:6])}")
    i = weeks.index(week)
    if i + 4 > len(weeks):
        sys.exit(f"'{week}' 기준 4주치 데이터가 없어요.")
    w4 = weeks[i:i + 4][::-1]                            # 오래된 주 → 이번 주
    total = {w['주차']: w['총건수'] for w in d['week']}
    tag = {}
    for r in d['tag']:
        tag.setdefault(r['태그'], {})[r['주차']] = r['건수']

    print(f"(최근 4주: {' → '.join(w4)})")
    for g in groups:
        name, tags = g.split('=', 1)
        tags = [t.strip() for t in tags.split(',') if t.strip()]
        v = [sum(tag.get(t, {}).get(w, 0) for t in tags) for w in w4]
        base, pct, label = verdict(v)
        share = v[3] / total[w4[3]] * 100
        judged = f"**{label}**" if pct is None else f"**{label} ({pct:+.0f}%)**"
        print(f"**최근 4주 문의 ({name.strip()}):** {' → '.join(map(str, v[:3]))} → **{v[3]}건** · "
              f"전체 문의의 {share:.1f}% · 앞 3주 평균 {base:.0f}건 대비 {judged}")
        print(f"> 📎 태그 묶음: {', '.join(tags)}")   # 다음 주에도 같은 묶음으로 이어 보도록 리포트에 같이 붙인다
        missing = [t for t in tags if t not in tag]
        if missing:
            print(f"  ⚠️ 데이터에 없는 태그: {', '.join(missing)} — 이름 오타인지 확인")


if __name__ == '__main__':
    main(sys.argv[1:])
