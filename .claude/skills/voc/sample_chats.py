"""채널톡 export에서 주제별 원문 표본을 뽑고 긴 숫자(전화번호·계좌)를 가린다.

사용법:
  python3 sample_chats.py voc-원문/0914 "A=환불수강취소" "B=자격증신뢰" --n 30 --out /tmp/voc
  python3 sample_chats.py --selftest

- 주제=파일 이름 앞부분. 앞부분이 같은 파일(환불수강취소.xlsx, 환불수강취소2.xlsx)을 한 주제로 묶는다.
- 채널톡은 채널별로 파일을 나눠 준다. 파일별 상담 수 비율대로 N건을 나눠 뽑는다(전체가 N 이하면 전부).
- 결과는 --out 폴더에 raw_<주제>.txt(대화)·links_<주제>.md(상담 링크). 공개 저장소라 저장소 안에는 쓰지 않는다.
- 못 가리는 것: 사람 이름, 전화 상담에서 한글로 읽은 숫자("공일공…"), 도로명·지번 주소 앞부분. 인용 전에 직접 확인한다.
"""
import glob
import os
import random
import re
import sys
import unicodedata

REPO = os.path.realpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SEED = 7                      # 같은 파일이면 같은 표본 — 나중에 근거를 되짚을 수 있게
# 숫자 8개 이상이 공백·-·~·. 으로 이어진 것 = 전화번호·계좌번호·생년월일(8자리). 날짜·등록번호도 같이 가려지지만 개인정보 쪽을 택한다.
LONG_NUMBER = re.compile(r'\d(?:[\s\-~.]*\d){7,}')
# 상담원이 붙여넣은 배송지의 동·호수 (○○동 ○○○○호, ○○○호). 2026-09-14 시험 운영에서 원문에 그대로 남았다.
UNIT = re.compile(r'\d+\s*동\s*\d+\s*호|(?<!\d)\d{3,4}\s*호(?!선)')
WHO = {'user': '고객', 'manager': '상담원', 'bot': '봇'}


def mask(text):
    return LONG_NUMBER.sub('[숫자]', UNIT.sub('[주소]', text))


def allocate(sizes, n):
    """파일별 상담 수 → 파일별 뽑을 수. 반올림 합이 n이 되게 맞춘다."""
    total = sum(sizes)
    if total <= n:
        return list(sizes)
    alloc = [round(n * s / total) for s in sizes]
    alloc[alloc.index(max(alloc))] += n - sum(alloc)
    return [min(a, s) for a, s in zip(alloc, sizes)]


def channel(messages):
    """매니저 인사말로 채널을 가른다. 링크 주소가 채널마다 다르다."""
    text = ' '.join(messages[messages.personType == 'manager'].plainText.dropna().astype(str))
    academy, partner = text.count('케어아카데미 입니다'), len(re.findall('케어파트너 ?입니다', text))
    if academy == partner:
        return '?'
    return 'carepartner-academy' if academy > partner else 'carepartner'


def selftest():
    assert '[숫자]' in mask('010~1234~5678') and not re.search(r'\d{4}', mask('010-1234-5678'))
    assert '456789' not in mask('테스트은행 123 456789 01234')
    assert mask('93,000원 · 시험 75점') == '93,000원 · 시험 75점'
    assert '19000101' not in mask('상장+카드 19000101 테스트시')
    assert '1001' not in mask('테스트로 1 101동 1001호') and '2002' not in mask('테스트로 2 /202동2002호')
    assert mask('지하철 2호선') == '지하철 2호선'
    assert allocate([27, 57], 30) == [10, 20]
    assert allocate([90, 28], 30) == [23, 7]
    assert allocate([5, 3], 30) == [5, 3]
    print('sample_chats.py selftest ok')


def main(argv):
    if argv[:1] == ['--selftest']:
        return selftest()
    import pandas as pd

    n, out = 30, None
    if '--n' in argv:
        n = int(argv.pop(argv.index('--n') + 1)); argv.remove('--n')
    if '--out' in argv:
        out = argv.pop(argv.index('--out') + 1); argv.remove('--out')
    if not out or len(argv) < 2 or any('=' not in t for t in argv[1:]):
        sys.exit(__doc__)
    out = os.path.realpath(out)
    if out == REPO or out.startswith(REPO + os.sep):
        sys.exit('--out은 저장소 밖이어야 해요 (원문에 개인정보가 있고 저장소는 공개예요).')
    os.makedirs(out, exist_ok=True)

    folder = argv[0]
    files = {unicodedata.normalize('NFC', os.path.basename(f)): f
             for f in glob.glob(os.path.join(folder, '*.xlsx'))}
    for spec in argv[1:]:
        topic, prefix = [x.strip() for x in spec.split('=', 1)]
        mine = sorted(name for name in files if name.startswith(prefix))
        if not mine:
            sys.exit(f"'{prefix}'로 시작하는 파일이 {folder}에 없어요. 있는 파일: {', '.join(files)}")
        books = []
        for name in mine:
            x = pd.ExcelFile(files[name])
            chats, msgs = x.parse('UserChat'), x.parse('Message data')
            msgs = msgs[msgs.isPrivate != True].sort_values('createdAt')
            books.append((name, chats, msgs, channel(msgs)))

        lines, links = [], []
        rng = random.Random(SEED)
        for (name, chats, msgs, ch), k in zip(books, allocate([len(b[1]) for b in books], n)):
            picked = chats.iloc[sorted(rng.sample(range(len(chats)), k))]
            print(f"{topic} · {name} · 채널 {ch} · 상담 {len(chats)}건 중 {k}건")
            for _, c in picked.iterrows():
                cid = str(c['id'])
                lines.append(f"\n#### {topic} chat={cid[-8:]} channel={ch} medium={c.get('mediumType')} "
                             f"managed={str(c.get('managedAt'))[:16]} tags=[{c.get('tags')}]")
                for _, m in msgs[msgs.chatId == c['id']].iterrows():
                    if pd.notna(m.plainText):
                        body = mask(str(m.plainText)).replace('\n', ' ')[:400]
                        lines.append(f"{WHO.get(m.personType, m.personType)}: {body}")
                links.append(f"- {cid[-8:]} https://desk.channel.io/{ch}/user-chats/{cid}")
        with open(os.path.join(out, f'raw_{topic}.txt'), 'w') as f:
            f.write('\n'.join(lines))
        with open(os.path.join(out, f'links_{topic}.md'), 'w') as f:
            f.write('\n'.join(links) + '\n')
        print(f"→ {out}/raw_{topic}.txt · links_{topic}.md")


if __name__ == '__main__':
    main(sys.argv[1:])
