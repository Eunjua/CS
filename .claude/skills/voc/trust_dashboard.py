"""trust_history.json → 「자격증 신뢰 추이」 대시보드(아티팩트)에 올릴 파일 두 개.

사용법:
  python3 trust_dashboard.py <저장소 밖 폴더>     # trust_weekly.json · trust_causes.json 을 그 폴더에 쓴다
  python3 trust_dashboard.py --selftest

- 대시보드: https://claude.ai/artifact/CHaB15cdxPMsso52uSVx7G (데이터셋 weekly · causes = 첨부 파일)
- 매주 /voc에서 tally.py --save 뒤에 돌리고, 두 파일을 대시보드 자산으로 다시 올려 데이터셋 url·updated만 바꾼다(reference/trust.md).
- 건수·비중만 담는다(개인정보 없음). 비중은 그 주 전체 문의 대비 0~1.
"""
import datetime as dt
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
YEAR = 2026   # 주차 라벨(10/05~10/11)에 연도가 없다 — 2027년 1월 주가 생기면 고칠 것


def start_of(week):
    m, d = (int(x) for x in week.split('~')[0].split('/'))
    return dt.date(YEAR, m, d).isoformat()


def build(hist, cfg):
    cats = cfg['categories']
    weekly, causes = [], []
    for week, w in hist['weeks'].items():
        start = start_of(week)
        refunds = w.get('refunds', {})
        bm = w.get('by_medium', {})
        # v2(10/19~)부터 counts는 원인마다 1건(중복 포함) — 상담 수는 board_chats·refund_chats로 따로 남긴다
        board_n = w.get('board_chats', sum(w['counts'].get(c['code'], 0) for c in cats if c.get('board')))
        weekly.append({
            'week': week, 'start': start, 'version': w.get('version', ''),
            'total': w['total'], 'trust': w['raw'], 'trust_share': round(w['raw'] / w['total'], 4),
            'board': board_n, 'board_share': round(board_n / w['total'], 4),
            'refund': w.get('refund_chats', sum(refunds.values())), 'mode': w.get('mode', 'primary'),
            'chat_share': round(bm['채팅']['raw'] / bm['채팅']['total'], 4) if '채팅' in bm else None,
            'phone_share': round(bm['전화']['raw'] / bm['전화']['total'], 4) if '전화' in bm else None,
        })
        for i, c in enumerate(cats):
            n = w['counts'].get(c['code'], 0)
            causes.append({
                'week': week, 'start': start, 'version': w.get('version', ''), 'order': i,
                'cause': c['label'], 'code': c['code'], 'board': bool(c.get('board')),
                'count': n, 'refund': refunds.get(c['code'], 0), 'share': round(n / w['total'], 4),
                'chat': bm.get('채팅', {}).get('counts', {}).get(c['code'], 0),
                'phone': bm.get('전화', {}).get('counts', {}).get(c['code'], 0),
            })
    weekly.sort(key=lambda r: r['start'])
    causes.sort(key=lambda r: (r['start'], r['order']))
    return weekly, causes


def selftest():
    cfg = {'categories': [{'code': 'a', 'label': 'A', 'board': True}, {'code': 'z', 'label': 'Z', 'board': False}]}
    hist = {'weeks': {'10/12~10/18': {'version': 'v1', 'total': 200, 'raw': 40, 'counts': {'a': 30, 'z': 10}, 'refunds': {'a': 2}},
                      '10/05~10/11': {'version': 'v1', 'total': 100, 'raw': 20, 'counts': {'a': 15, 'z': 5},
                                      'by_medium': {'채팅': {'total': 60, 'raw': 12, 'counts': {'a': 9}},
                                                    '전화': {'total': 40, 'raw': 8, 'counts': {'a': 6}}}}}}
    weekly, causes = build(hist, cfg)
    assert [w['start'] for w in weekly] == ['2026-10-05', '2026-10-12']
    assert weekly[0]['trust_share'] == 0.2 and weekly[0]['board_share'] == 0.15 and weekly[0]['chat_share'] == 0.2
    assert weekly[1]['refund'] == 2 and weekly[1]['chat_share'] is None
    a = [c for c in causes if c['code'] == 'a']
    assert a[0]['share'] == 0.15 and a[0]['chat'] == 9 and a[1]['refund'] == 2
    hist['weeks']['10/19~10/25'] = {'version': 'v2', 'total': 100, 'raw': 10, 'counts': {'a': 12}, 'refunds': {'a': 3},
                                    'mode': 'multi', 'board_chats': 9, 'refund_chats': 2}
    weekly, _ = build(hist, cfg)
    assert weekly[-1]['board'] == 9 and weekly[-1]['refund'] == 2 and weekly[-1]['mode'] == 'multi'
    print('trust_dashboard.py selftest ok')


if __name__ == '__main__':
    if sys.argv[1:2] == ['--selftest']:
        selftest()
    elif len(sys.argv) == 2:
        out = os.path.realpath(sys.argv[1])
        repo = os.path.realpath(os.path.join(HERE, '..', '..', '..'))
        if out == repo or out.startswith(repo + os.sep):
            sys.exit('저장소 밖 폴더에 쓰세요.')
        os.makedirs(out, exist_ok=True)
        hist = json.load(open(os.path.join(HERE, 'trust_history.json'), encoding='utf-8'))
        cfg = json.load(open(os.path.join(HERE, 'trust.json'), encoding='utf-8'))
        weekly, causes = build(hist, cfg)
        for name, rows in (('trust_weekly.json', weekly), ('trust_causes.json', causes)):
            json.dump(rows, open(os.path.join(out, name), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f'주차 {len(weekly)}개 · 원인 줄 {len(causes)}개 → {out}')
    else:
        sys.exit(__doc__)
