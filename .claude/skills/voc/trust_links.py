"""신뢰 지표판 아래 '원인별 상담 링크' 노션 토글을 만든다 (2026-10-12 은주 요청).

사용법:
  python3 trust_links.py <sample_chats --out 폴더> > <저장소 밖>/notion_links.md   # 노션 리포트 지표판 아래에 붙인다
  python3 trust_links.py --selftest

- 원인 순서 = 지표판 순서(건수 많은 순, 지표판 밖 원인은 뒤). 상담마다 링크 · 채팅/전화 · 환불 · 고객 한 마디.
- v2(10/19~): 원인이 여러 개인 상담은 해당 원인 토글마다 나온다(tally.py와 같은 causes_of로 센다). 맨 위 건수는 상담 수.
- 링크는 desk.channel.io/{채널}/user-chats/{영문·숫자 상담 ID} 형식만 쓴다 — 전화번호·이름이 없다.
  다른 형식(닉네임이 들어간 channel.works 링크 등)이 섞이면 멈춘다. 결과는 저장소에 쓰지 않는다.
"""
import glob
import json
import collections
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from tally import causes_of   # noqa: E402 — 지표판과 같은 기준으로 센다
LINK = re.compile(r'- (\w{8}) (https://desk\.channel\.io/[\w-]+/user-chats/[0-9a-f]+)$')


def build(cfg, rows, links, mediums):
    valid = {c['code'] for c in cfg['categories']}
    by = collections.defaultdict(list)
    for r in rows:
        for c in causes_of(r, valid):
            by[c].append(r)
    cats = sorted(cfg['categories'], key=lambda c: (not c.get('board'), -len(by.get(c['code'], []))))
    out = ['<details>', f'<summary>📎 원인별 상담 링크 ({len(rows)}건 — 채널톡 로그인 필요)</summary>']
    for c in cats:
        rs = by.get(c['code'], [])
        if not rs:
            continue
        rf = sum(1 for r in rs if r.get('refund') is True)
        out += ['\t<details>', f"\t<summary>{c['label']} — {len(rs)}건" + (f' · 환불 {rf}건' if rf else '') + '</summary>']
        for r in rs:
            q = re.sub(r'\d{3,}', '[숫자]', (r.get('quote') or '').replace('"', "'").replace('\n', ' '))[:60]
            out.append(f"\t\t- [{r['chat']}]({links[r['chat']]}) · {mediums.get(r['chat'], '?')}"
                       + (' · 환불' if r.get('refund') is True else '') + (f' — "{q}"' if q else ''))
        out.append('\t</details>')
    out.append('</details>')
    return '\n'.join(out)


def load(folder, topic):
    rows = [json.loads(l) for f in sorted(glob.glob(os.path.join(folder, f'cls_{topic}*.jsonl'))) for l in open(f) if l.strip()]
    links, bad = {}, []
    for line in open(os.path.join(folder, f'links_{topic}.md')):
        m = LINK.match(line.strip())
        if m:
            links[m.group(1)] = m.group(2)
        elif line.strip():
            bad.append(line.strip()[:40])
    if bad:
        sys.exit(f'⚠️ desk.channel.io 상담 ID 형식이 아닌 링크가 있어 멈춰요: {bad[:3]}')
    raw = open(os.path.join(folder, f'raw_{topic}.txt')).read()
    mediums = {c: ('전화' if m == 'phone' else '채팅')
               for c, m in re.findall(rf'^#### {topic} chat=(\w{{8}})\S*.*?medium=(\w+)', raw, re.M)}
    missing = [r['chat'] for r in rows if r['chat'] not in links]
    if missing:
        sys.exit(f'⚠️ 링크가 없는 상담: {missing[:5]}')
    return rows, links, mediums


def selftest():
    cfg = {'categories': [{'code': 'a', 'label': 'A', 'board': True}, {'code': 'z', 'label': 'Z', 'board': False},
                          {'code': 'b', 'label': 'B', 'board': True}]}
    rows = [{'chat': 'x1', 'category': 'b', 'refund': True, 'quote': '010 1234 5678 연락주세요'},
            {'chat': 'x2', 'category': 'b', 'quote': ''}, {'chat': 'x3', 'category': 'z'}]
    text = build(cfg, rows, {c: f'https://desk.channel.io/c/user-chats/{c}' for c in ('x1', 'x2', 'x3')}, {'x1': '전화'})
    assert text.index('B — 2건 · 환불 1건') < text.index('Z — 1건') and 'A —' not in text
    assert '1234' not in text and '· 전화 · 환불' in text
    assert LINK.match('- abcd1234 https://desk.channel.io/carepartner/user-chats/6ac1abcd1234')
    assert not LINK.match('- abcd1234 https://channel.works/x/user-chats/체리868-6ac6')
    multi = build(cfg, [{'chat': 'm1', 'category': 'a', 'causes': ['a', 'b']}],
                  {'m1': 'https://desk.channel.io/c/user-chats/m1'}, {})
    assert 'A — 1건' in multi and 'B — 1건' in multi and '(1건 —' in multi   # 두 원인 토글에 모두, 맨 위는 상담 수
    print('trust_links.py selftest ok')


if __name__ == '__main__':
    if sys.argv[1:2] == ['--selftest']:
        selftest()
    elif len(sys.argv) == 2:
        cfg = json.load(open(os.path.join(HERE, 'trust.json'), encoding='utf-8'))
        print(build(cfg, *load(sys.argv[1], cfg['topic'])))
    else:
        sys.exit(__doc__)
