"""trust.json에서 신뢰 원문 분류 프롬프트의 '기준' 부분을 뽑는다 — 손으로 옮겨 적지 않게.

사용법:
  python3 trust_prompt.py > <저장소 밖 폴더>/기준표.txt     # 하위 에이전트에게 원문 묶음과 함께 준다
  python3 trust_prompt.py --selftest
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def build(cfg):
    out = [f"신뢰 원인 기준표 {cfg['version']} — 상담마다 category 하나, causes 목록, refund 하나를 정한다.", '', '[판단 순서]']
    out += cfg['rules']
    out += ['', '[경계]'] + [f'- {b}' for b in cfg['boundaries']]
    out += ['', '[category — 설명 / 고객이 한 말 예시]']
    for c in cfg['categories']:
        ex = ' · '.join(f'"{e}"' for e in c.get('examples', []))
        out.append(f"- {c['code']} — {c['desc']}" + (f' / 예: {ex}' if ex else ''))
    out += ['', '[causes] 이 상담에 나온 신뢰 원인 코드 전부(category 포함, 중복 없이, 위 category 코드만) — 판단 순서 5번',
            '[refund] 결제 후 환불·취소를 요청했으면 true, 아니면 false (원인과 따로)',
            f"[mentions 후보] {json.dumps(cfg['mentions'], ensure_ascii=False)}",
            f"[outcome 후보] {' / '.join(cfg['outcomes'])}",
            f"[stage 후보] {' / '.join(cfg['stages'])}"]
    return '\n'.join(out)


def selftest():
    cfg = {'version': 'vT', 'rules': ['1. r'], 'boundaries': ['a ↔ b'], 'mentions': ['비용'], 'outcomes': ['o'], 'stages': ['s'],
           'categories': [{'code': '인정', 'desc': 'd', 'examples': ['e']}, {'code': '기타', 'desc': 'x', 'examples': []}]}
    text = build(cfg)
    assert '기준표 vT' in text and '- 인정 — d / 예: "e"' in text and '- 기타 — x' in text and '[refund]' in text and '[causes]' in text
    build(json.load(open(os.path.join(HERE, 'trust.json'), encoding='utf-8')))   # 실제 파일도 깨지지 않는지
    print('trust_prompt.py selftest ok')


if __name__ == '__main__':
    if sys.argv[1:2] == ['--selftest']:
        selftest()
    else:
        print(build(json.load(open(os.path.join(HERE, 'trust.json'), encoding='utf-8'))))
