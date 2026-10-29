# 국비 바탕(gov-bg.png) 하나로 교육 이수증·시험응시 확인서 바탕을 만든다.
#   python3 cert/tools/make_bg.py cert/gov-bg.png cert/edu-bg.png cert/exam-bg.png
# edu-bg.png  : 한국노인인력개발원 로고·'수료증' 제목·아래 문구 두 줄을 지운 것
# exam-bg.png : edu-bg.png 에서 4·5번째 칸 이름(수강시간·수강기간)까지 지운 것
# 지운 것은 cert/index.html 이 캔버스에 직접 쓴다.
# 글자 뒤 연한 초록 무늬 되살리기:
#   1) 지운 글자 자리를 바깥에서 안쪽으로 한 겹씩 이웃 색으로 채운다(onion peel)
#   2) 초록/흰색으로 나눈 뒤, 둘레를 흐리게 했다가 다시 나눠 들쭉날쭉한 테두리를 매끈하게 편다
import sys
import numpy as np
from PIL import Image

WHITE = np.array([255., 255, 255]); GREEN = np.array([240., 249, 242])
SENTENCE_BOXES = [(540, 1968, 1940, 2045), (680, 2084, 1800, 2160)]   # 문구 두 줄
EXAM_LABEL_BOXES = [(535, 1520, 835, 1590), (535, 1644, 835, 1714)]   # 수강시간 · 수강기간 (콜론 870~ 은 남김)
R = 8


def grow(m, n):
    for _ in range(n):
        g = m.copy()
        g[1:] |= m[:-1]; g[:-1] |= m[1:]; g[:, 1:] |= m[:, :-1]; g[:, :-1] |= m[:, 1:]
        m = g
    return m


def box(m, r):
    c = np.pad(m, ((r + 1, r), (r + 1, r))).cumsum(0).cumsum(1)
    return (c[2*r+1:, 2*r+1:] - c[:-2*r-1, 2*r+1:] - c[2*r+1:, :-2*r-1] + c[:-2*r-1, :-2*r-1]) / (2*r+1)**2


def erase(a, boxes):
    H, W, _ = a.shape
    mask = np.zeros((H, W), bool)
    for x0, y0, x1, y1 in boxes:
        reg = a[y0:y1, x0:x1]
        bg = (np.abs(reg - WHITE).sum(-1) <= 3) | (np.abs(reg - GREEN).sum(-1) <= 3)
        mask[y0:y1, x0:x1] = ~bg
    mask = grow(mask, 2)  # 글자 가장자리 번짐까지

    f = a.copy(); known = ~mask; todo = mask.copy()
    while todo.any():
        acc = np.zeros_like(f); cnt = np.zeros((H, W))
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            k = np.roll(known, (dy, dx), (0, 1))
            acc += np.roll(f, (dy, dx), (0, 1)) * k[..., None]; cnt += k
        fill = todo & (cnt > 0)
        f[fill] = acc[fill] / cnt[fill][:, None]
        known |= fill; todo &= ~fill

    t = np.clip((255 - f[..., 0]) / (255 - 240), 0, 1)  # 초록일 확률
    sm = box(box((t > 0.5).astype(float), R), R)
    alpha = box((sm > 0.5).astype(float), 1)
    out = alpha[..., None] * GREEN + (1 - alpha[..., None]) * WHITE
    near = grow(mask, R + 2)  # 지운 자리와 그 둘레만 바꾼다 — 나머지 무늬는 원본 그대로
    a = a.copy()
    a[near] = out[near]
    return a


def save(a, path):
    Image.fromarray(a.round().clip(0, 255).astype(np.uint8)).save(path, optimize=True)


gov, edu_out, exam_out = sys.argv[1:4]
a = np.asarray(Image.open(gov).convert('RGB')).astype(float).copy()
a[165:1159, 170:2310] = WHITE  # 로고 · 제목 (바탕이 흰색뿐인 자리)
edu = erase(a, SENTENCE_BOXES)
save(edu, edu_out)
save(erase(edu, EXAM_LABEL_BOXES), exam_out)
