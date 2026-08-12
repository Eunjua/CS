#!/usr/bin/env python3
"""
VOC 주간 리포트 — 숫자 계산기

대시보드 v2 웹앱에서 집계를 받아 리포트에 들어갈 수치와
"이번 주 볼 것" 후보를 뽑는다. 해석·문장은 스킬(사람+Claude)이 쓴다.

    python3 analyze.py            # 최신 주차
    python3 analyze.py 07/27~08/02  # 특정 주차

숫자를 여기서만 계산하는 이유: 대시보드와 리포트가 따로 계산하면
언젠가 두 숫자가 어긋나고, 그러면 리포트를 아무도 안 믿는다.
"""
import json, sys, urllib.request
from collections import defaultdict

API = ('https://script.google.com/macros/s/'
       'AKfycby_UlCiJC2bRpooKKwjCK6KoTk9LfURS2RFx4xTuSMTxrjQXrxd_swzOnh2SPvcE3BmYA/exec')

# 급증 감지에서 뺄 태그.
#  · AI/*  = 워크플로우 정상 상태값이라 늘어도 문제가 아니다 (AI/상담완료가 늘면 오히려 좋은 신호)
#  · 태그없음 = 미분류 버킷. 상시 지표로 따로 본다.
def is_operational(tag):
    return tag == 'AI' or tag.startswith('AI/') or tag == '태그없음'

# 임계값 — 주 1,200건 규모에서 "회의에서 말할 가치가 있는" 크기로 잡았다.
# 건수 조건 없이 %만 쓰면 3건→6건 같은 게 +100%로 올라와 진짜 신호를 덮는다.
SURGE_MIN_DELTA, SURGE_MIN_PCT = 10, 30
DROP_MIN_DELTA,  DROP_MIN_PCT  = -15, -30
NEW_MIN, ETC_MIN = 5, 5
TOP_N = 3            # 본문에 쓸 개수. 나머지는 '그 외 변동'으로 접는다.


def pct(cur, prev):
    return None if not prev else (cur - prev) / prev * 100


def fmt_delta(cur, prev):
    d, p = cur - prev, pct(cur, prev)
    return f"{prev} → {cur} ({d:+}, {'신규' if p is None else f'{p:+.0f}%'})"


def main():
    with urllib.request.urlopen(API) as r:
        d = json.load(r)

    weeks = [w['주차'] for w in d['week']]          # API가 최신순으로 준다
    target = sys.argv[1] if len(sys.argv) > 1 else weeks[0]
    if target not in weeks:
        sys.exit(f"'{target}' 주차가 없어요. 있는 주차: {', '.join(weeks[:6])}")
    i = weeks.index(target)
    if i + 1 >= len(weeks):
        sys.exit(f"'{target}'은 가장 오래된 주차라 전주 비교를 할 수 없어요.")
    cur_w, prev_w = weeks[i], weeks[i + 1]
    C, P = d['week'][i], d['week'][i + 1]

    out = {'주차': cur_w, '전주': prev_w}

    # ── 1. 인입 요약
    summary = {}
    for k in ['총건수', '채팅', '전화', 'AI완결', '상담원응대', '부재중']:
        summary[k] = {'이번주': C[k], '전주': P[k], '증감': C[k] - P[k], '증감률': pct(C[k], P[k])}
    summary['AI완결률'] = {'이번주': C['AI완결'] / C['총건수'] * 100,
                          '전주': P['AI완결'] / P['총건수'] * 100}
    summary['부재중률'] = {'이번주': C['부재중'] / C['총건수'] * 100,
                          '전주': P['부재중'] / P['총건수'] * 100}
    for k in ['만족도평균', '친절도평균', '만족도응답수']:
        summary[k] = {'이번주': C[k], '전주': P[k]}
    summary['만족도응답률'] = {'이번주': C['만족도응답수'] / C['총건수'] * 100,
                              '전주': P['만족도응답수'] / P['총건수'] * 100}
    summary['AI만족도'] = {'점수': C['AI만족도'], '응답수': C['AI응답수']}
    summary['상담원만족도'] = {'점수': C['상담원만족도'], '응답수': C['상담원응답수']}
    out['인입요약'] = summary

    # ── 2. 태그 규칙
    tag = defaultdict(dict)
    for r in d['tag']:
        tag[r['태그']][r['주차']] = r['건수']
    look = weeks[i + 1:i + 5]      # 신규 판정에 볼 직전 4주

    surge, drop, new, etc = [], [], [], []
    for t, byw in tag.items():
        c, p = byw.get(cur_w, 0), byw.get(prev_w, 0)
        if not c and not p:
            continue
        rec = {'태그': t, '이번주': c, '전주': p, '증감': c - p,
               '증감률': pct(c, p), '표기': fmt_delta(c, p)}
        if '기타' in t and c - p >= ETC_MIN:
            etc.append(rec)                       # 운영 태그여도 '기타'는 본다
        if is_operational(t):
            continue
        if c >= NEW_MIN and all(byw.get(w, 0) == 0 for w in look):
            new.append(rec)
        elif c - p >= SURGE_MIN_DELTA and (rec['증감률'] is None or rec['증감률'] >= SURGE_MIN_PCT):
            surge.append(rec)
        elif c - p <= DROP_MIN_DELTA and rec['증감률'] is not None and rec['증감률'] <= DROP_MIN_PCT:
            drop.append(rec)

    surge.sort(key=lambda x: -x['증감'])
    drop.sort(key=lambda x: x['증감'])
    new.sort(key=lambda x: -x['이번주'])
    etc.sort(key=lambda x: -x['증감'])
    out['급증'], out['급감'], out['신규'], out['기타계열'] = surge, drop, new, etc

    # ── 3. 3주 연속 추세
    #  전주 대비만 보면 -0.04 같은 변화가 아무 규칙에도 안 걸리는데,
    #  3주를 이어 보면 방향이 드러난다. 만족도 하락은 늘 이렇게 온다.
    trend = {}
    for k in ['만족도평균', '친절도평균', '총건수']:
        if i + 2 < len(weeks):
            v = [d['week'][i + n][k] for n in (0, 1, 2)]
            if all(isinstance(x, (int, float)) for x in v):
                if v[0] < v[1] < v[2]:
                    trend[k] = {'방향': '3주 연속 하락', '값': v, '주차': weeks[i:i + 3]}
                elif v[0] > v[1] > v[2]:
                    trend[k] = {'방향': '3주 연속 상승', '값': v, '주차': weeks[i:i + 3]}
    out['연속추세'] = trend

    # ── 4. 설문 (해결여부·대기적절) — 보기 문구는 폼에서 바뀔 수 있어 들어온 값 그대로 쓴다
    sv = defaultdict(lambda: defaultdict(int))
    for r in d['survey']:
        if r['주차'] in (cur_w, prev_w):
            sv[(r['주차'], r['항목'])][r['보기']] = r['건수']
    survey = {}
    for (wk, item), v in sv.items():
        tot = sum(v.values())
        survey.setdefault(item, {})[wk] = {
            '응답수': tot,
            '분포': {k: {'건수': n, '비율': n / tot * 100} for k, n in
                     sorted(v.items(), key=lambda x: -x[1])},
        }
    out['설문'] = survey

    # ── 5. 상시 지표
    untagged = tag['태그없음']
    out['상시지표'] = {
        '태그없음': {'이번주': {'건수': untagged.get(cur_w, 0),
                              '비율': untagged.get(cur_w, 0) / C['총건수'] * 100},
                    '전주': {'건수': untagged.get(prev_w, 0),
                            '비율': untagged.get(prev_w, 0) / P['총건수'] * 100}},
        '만족도응답률': summary['만족도응답률'],
    }

    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
