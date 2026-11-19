"""라벨지 규격 맞추기 — /라벨 스킬의 도구.

쓰는 법 (결과는 기본으로 ~/Downloads 에 저장):
  python3 relabel.py specs
      등록된 라벨지 규격 보기

  python3 relabel.py pdf  원본.pdf  [--pick 7360,7367,김*현 ...] [--spec LS-3108] [--out 이름.pdf]
      우체국 등기 라벨처럼 '칸이 줄지어 있는 PDF'를 내용 그대로 두고 칸 위치만 규격에 맞게 옮긴다.
      --pick 을 주면 그 글자가 들어 있는 라벨만, 준 순서대로 담는다(등기번호 끝 4자리·이름 등).

  python3 relabel.py text  --line "케어아카데미" --line "주소: ..." [--count 14] [--out ...]
      모든 칸에 같은 글을 넣은 라벨을 만든다(첫 줄은 굵게).

  python3 relabel.py image  캡처1.png 캡처2.png ... [--gap 30] [--out ...]
      원본 PDF가 없을 때만. 캡처를 빈 줄 기준으로 라벨 한 장씩 잘라 칸에 넣는다(바코드가 흐릴 수 있음).

  python3 relabel.py preview  결과.pdf  [--spec LS-3108]
      칸 테두리를 빨간 점선으로 그린 확인용 PNG를 쪽마다 만든다(인쇄용 아님).

결과 PDF에는 테두리가 없다. 인쇄는 반드시 '실제 크기(100%)'.
"""
import argparse, base64, html, io, os, subprocess, sys, tempfile

MM = 72 / 25.4
A4 = (595.28, 841.89)

# 확인된 규격만 넣는다. 새 규격은 포장 상자·제조사 표기로 확인한 뒤 한 줄 추가.
# cols×rows, 칸 w×h(mm), 왼쪽·위 여백(mm), 칸 간격 가로·세로(mm)
SPECS = {
    "LS-3108": dict(name="폼텍 LS-3108 주소용 14칸", cols=2, rows=7, w=99.1, h=38.1,
                    left=4.65, top=15.15, gap_x=2.5, gap_y=0.0),
}

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def cells(spec):
    """규격의 칸들을 (x, y_bottom, w, h) pt 로, 위→아래·왼→오 순서로."""
    s = SPECS[spec]
    w, h = s["w"] * MM, s["h"] * MM
    for r in range(s["rows"]):
        for c in range(s["cols"]):
            x = (s["left"] + c * (s["w"] + s["gap_x"])) * MM
            top = (s["top"] + r * (s["h"] + s["gap_y"])) * MM
            yield x, A4[1] - top - h, w, h


def out_path(name):
    return name if os.path.isabs(name) else os.path.expanduser(f"~/Downloads/{name}")


# ---------------------------------------------------------------- pdf 모드
def read_cells(page, anchor_word):
    """원본 쪽에서 라벨 칸을 찾는다. anchor_word(기본 '귀하')가 든 줄을 칸마다 하나 있는 기준점으로 쓴다.
    돌려주는 것: ([{x, y, text, hi, lo}], 세로 간격, 가로 간격) — hi·lo는 기준점 대비 글의 위·아래 끝."""
    items, cur = [], None  # (x, y, 글자크기, 글) — 좌표가 0인 조각은 앞 조각 위치를 이어받음
    def v(t, cm, tm, fd, fs):
        nonlocal cur
        x, y = cm[4] + tm[4], cm[5] + tm[5]
        if x or y:
            cur = (x, y, (fs or 10) * max(abs(tm[3]), 1))
        if t.strip() and cur:
            items.append((cur[0], cur[1], cur[2], t.strip()))
    page.extract_text(visitor_text=v)
    anchors = [(x, y) for x, y, _, t in items if anchor_word in t]
    if not anchors:
        return None
    ys = sorted({round(y, 1) for _, y in anchors}, reverse=True)
    xs = sorted({round(x, 1) for x, _ in anchors})
    row_pitch = min((a - b for a, b in zip(ys, ys[1:])), default=200)
    col_pitch = min((b - a for a, b in zip(xs, xs[1:])), default=A4[0])
    labs = [dict(x=x, y=y, parts=[], lo=0.0, hi=0.0) for x, y in anchors]
    for x, y, fs, t in items:
        # 같은 열이고(기준점 x부터 가로 간격 안), 기준점보다 위로 0.75칸·아래로 0.5칸 안에 있는 글
        best = None
        for L in labs:
            dx, dy = x - L["x"], y - L["y"]
            if -5 <= dx < col_pitch - 5 and -row_pitch / 2 < dy < row_pitch * 0.75:
                if best is None or abs(dy) < abs(y - best["y"]):
                    best = L
        if best:
            best["parts"].append(t)
            dy = y - best["y"]
            best["hi"] = max(best["hi"], dy + fs * 0.85)
            best["lo"] = min(best["lo"], dy - fs * 0.25)
    for L in labs:
        L["text"] = " ".join(L["parts"])
    return labs, row_pitch, col_pitch


def cmd_pdf(a):
    import pypdf
    from pypdf.generic import StreamObject, NameObject, DictionaryObject, ArrayObject, FloatObject
    src = pypdf.PdfReader(a.src)
    found, pitches = [], []  # found: (원본 쪽 번호, 라벨)
    for pi, p in enumerate(src.pages):
        r = read_cells(p, a.anchor)
        if not r:
            continue
        labs, rp, cp = r
        pitches.append((rp, cp))
        found += [(pi, L) for L in labs]
    if not found:
        sys.exit(f"'{a.anchor}' 가 든 줄을 못 찾았어요 — 형식이 다르면 --anchor 로 칸마다 한 번씩 나오는 글자를 주세요.")
    if a.pick:
        keys = [k.strip() for k in ",".join(a.pick).split(",") if k.strip()]
        chosen, miss, dup = [], [], []
        for k in keys:
            hit = [f for f in found if k in f[1]["text"]]
            if not hit:
                miss.append(k)
            elif len(hit) > 1:
                dup.append(f"{k}({len(hit)}건)")
            else:
                chosen.append(hit[0])
        if miss or dup:
            sys.exit("고르기 실패 — 없음: " + (", ".join(miss) or "-") + " / 여러 건: " + (", ".join(dup) or "-"))
        found = chosen

    spec_cells = list(cells(a.spec))
    tw, th = spec_cells[0][2], spec_cells[0][3]
    out = pypdf.PdfWriter()
    xobj = {}

    def form(pi):  # 원본 쪽 하나를 한 번만 넣고 칸마다 불러 씀(파일 커지지 않게)
        if pi not in xobj:
            sp = src.pages[pi]
            xo = StreamObject()
            xo.set_data(sp.get_contents().get_data())
            xo.update({NameObject("/Type"): NameObject("/XObject"), NameObject("/Subtype"): NameObject("/Form"),
                       NameObject("/BBox"): ArrayObject([FloatObject(float(v)) for v in sp.mediabox]),
                       NameObject("/Resources"): sp["/Resources"].get_object().clone(out)})
            xobj[pi] = out._add_object(xo)
        return xobj[pi]

    rp = min(p[0] for p in pitches)
    cp = min(p[1] for p in pitches)
    clip_w, clip_h = min(cp - 4, tw), min(rp - 2, th)
    warn = []
    per = len(spec_cells)
    for start in range(0, len(found), per):
        page = out.add_blank_page(*A4)
        res, cs = DictionaryObject(), ""
        for (pi, L), (cx, cy, cw, ch) in zip(found[start:start + per], spec_cells):
            if L["hi"] - L["lo"] > clip_h - 2:
                warn.append(f"{L['text'][:25]}… 글 높이 {(L['hi']-L['lo'])/MM:.1f}mm")
            # 원본에서 잘라낼 상자: 글을 세로 가운데로, 왼쪽은 글 시작보다 pad(mm) 앞
            mid = L["y"] + (L["hi"] + L["lo"]) / 2
            x0, y0 = L["x"] - a.pad * MM, mid - clip_h / 2
            tx = cx + (cw - clip_w) / 2 - x0
            ty = cy + (ch - clip_h) / 2 - y0
            name = f"/P{pi}"
            res[NameObject(name)] = form(pi)
            cs += f"q 1 0 0 1 {tx:.2f} {ty:.2f} cm {x0:.2f} {y0:.2f} {clip_w:.2f} {clip_h:.2f} re W n {name} Do Q\n"
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/XObject"): res})
        s = StreamObject()
        s.set_data(cs.encode())
        page[NameObject("/Contents")] = out._add_object(s)
    dst = out_path(a.out or os.path.splitext(os.path.basename(a.src))[0] + f"_{a.spec}.pdf")
    out.write(dst)
    print(f"저장: {dst}")
    print(f"라벨 {len(found)}장 → {len(out.pages)}쪽 (한 쪽 {per}칸, 마지막 쪽 빈 칸 {(-len(found)) % per}개)")
    print(f"원본 칸 간격 세로 {rp/MM:.1f}mm·가로 {cp/MM:.1f}mm → {a.spec} 칸 {tw/MM:.1f}×{th/MM:.1f}mm")
    for i, (pi, L) in enumerate(found, 1):
        print(f"  {i:>2}. 원본 {pi+1}쪽 | {L['text'][:70]}")
    for w in warn:
        print("  ⚠ 칸보다 길어 잘릴 수 있음:", w)


# ---------------------------------------------------------------- text / image 모드 (HTML → Chrome PDF)
def html_sheet(spec, inner_list, css):
    s = SPECS[spec]
    per = s["cols"] * s["rows"]
    pages = []
    for start in range(0, len(inner_list), per):
        body = ""
        for k, inner in enumerate(inner_list[start:start + per]):
            r, c = divmod(k, s["cols"])
            top = s["top"] + r * (s["h"] + s["gap_y"])
            left = s["left"] + c * (s["w"] + s["gap_x"])
            body += f'<div class="label" style="top:{top:.2f}mm;left:{left:.2f}mm">{inner}</div>'
        pages.append(f'<div class="sheet">{body}</div>')
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@page{{size:A4;margin:0}}*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#000}}
.sheet{{position:relative;width:210mm;height:297mm;overflow:hidden;page-break-after:always}}
.sheet:last-child{{page-break-after:auto}}
.label{{position:absolute;width:{s['w']}mm;height:{s['h']}mm;display:flex;flex-direction:column;justify-content:center}}
{css}</style></head><body>{''.join(pages)}</body></html>"""


def to_pdf(html_text, dst):
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f:
        f.write(html_text)
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={dst}", f"file://{f.name}"], capture_output=True, timeout=120)
    os.unlink(f.name)
    print(f"저장: {dst}")


def cmd_text(a):
    s = SPECS[a.spec]
    lines = [html.escape(l) for l in a.line]
    inner = f'<div class="t">{lines[0]}</div>' + "".join(f'<div class="r">{l}</div>' for l in lines[1:])
    css = (".label{padding:0 7mm}.t{font-size:15pt;font-weight:700;margin-bottom:2.2mm}"
           ".r{font-size:9.5pt;line-height:1.55}")
    n = a.count or s["cols"] * s["rows"]
    to_pdf(html_sheet(a.spec, [inner] * n, css), out_path(a.out or f"라벨_{a.spec}.pdf"))


def cmd_image(a):
    import numpy as np
    from PIL import Image

    def runs(mask):
        r, s = [], None
        for i, v in enumerate(mask):
            if v and s is None: s = i
            if not v and s is not None: r.append((s, i)); s = None
        if s is not None: r.append((s, len(mask)))
        return r
    # 1차: 빈 줄로 조각 내기 (열: 넓은 빈 세로줄 / 줄: 빈 가로줄 중 --gap(px) 넘는 것)
    pieces = []  # (파일, 그림, 열, [y0, y1] 글 있는 범위)
    for f in a.images:
        im = Image.open(f).convert("RGBA")
        bg = Image.new("RGBA", im.size, "white"); bg.alpha_composite(im); im = bg.convert("L")
        ink = np.array(im) < 128
        H, W = ink.shape
        cg = [g for g in runs(~ink.any(0)) if g[1] - g[0] > 30 and 0 < g[0] and g[1] < W]
        xs = [0] + [(g[0] + g[1]) // 2 for g in cg] + [W]
        rg = [(g[0] + g[1]) // 2 for g in runs(~ink.any(1)) if g[1] - g[0] > a.gap and 0 < g[0] and g[1] < H]
        ys = [0] + rg + [H]
        for x0, x1 in zip(xs, xs[1:]):
            col = []
            for y0, y1 in zip(ys, ys[1:]):
                sub = ink[y0:y1, x0:x1]
                if sub.sum() < 50: continue
                yy = np.where(sub.any(1))[0]
                col.append([y0 + yy[0], y0 + yy[-1] + 1])
            pieces.append((f, im, ink, x0, x1, col))
    # 2차: 가장 큰 라벨 높이의 60%도 안 되는 조각은 아래 조각과 합침(주소 한 줄짜리가 둘로 잘리는 것 방지)
    full = max(b - a_ for *_, col in pieces for a_, b in col)
    order = []
    for f, im, ink, x0, x1, col in pieces:
        merged = []
        for seg in col:
            if merged and merged[-1][1] - merged[-1][0] < full * 0.6:
                merged[-1][1] = seg[1]
            else:
                merged.append(list(seg))
        for y0, y1 in merged:
            xx = np.where(ink[y0:y1, x0:x1].any(0))[0]
            P = 4  # 흐린 글자 가장자리가 잘리지 않게 사방 4px 여유
            c = im.crop((max(x0 + xx[0] - P, 0), max(y0 - P, 0),
                         min(x0 + xx[-1] + 1 + P, im.width), min(y1 + P, im.height)))
            order.append((f, y0, x0, c))
    # 캡처마다 위→아래, 한 줄 안에서는 왼→오 순서
    order.sort(key=lambda t: (a.images.index(t[0]), t[1] // 20, t[2]))
    crops = []
    for f, _, _, c in order:
        b = io.BytesIO(); c.save(b, "PNG")
        crops.append((f, c.size, base64.b64encode(b.getvalue()).decode()))
    for i, (f, size, _) in enumerate(crops, 1):
        print(f"  {i:>2}. {os.path.basename(f)} {size[0]}×{size[1]}px")
    inners = [f'<img src="data:image/png;base64,{b}">' for _, _, b in crops]
    css = ".label{padding:2mm 3mm;align-items:center}.label img{max-width:100%;max-height:100%}"
    to_pdf(html_sheet(a.spec, inners, css), out_path(a.out or f"라벨_캡처_{a.spec}.pdf"))
    print(f"라벨 {len(crops)}장 — 크기가 유난히 작거나(반쪽) 개수가 다르면 --gap 을 바꿔 다시")


# ---------------------------------------------------------------- 미리보기
def cmd_preview(a):
    import pypdf
    from pypdf.generic import StreamObject, NameObject
    r = pypdf.PdfReader(a.pdf)
    outdir = tempfile.mkdtemp(prefix="label_preview_")
    g = "q 0.85 0 0 RG 0.5 w [2 2] 0 d\n" + "".join(
        f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re S\n" for x, y, w, h in cells(a.spec)) + "Q\n"
    for i, p in enumerate(r.pages, 1):
        w = pypdf.PdfWriter()
        page = w.add_page(p)
        s = StreamObject(); s.set_data(g.encode())
        ov = pypdf.PageObject.create_blank_page(width=A4[0], height=A4[1])
        ov[NameObject("/Contents")] = w._add_object(s)
        page.merge_page(ov)
        pdf = os.path.join(outdir, f"p{i}.pdf")
        w.write(pdf)
        png = os.path.join(outdir, f"p{i}.png")
        subprocess.run(["sips", "-s", "format", "png", pdf, "--out", png], capture_output=True)
        subprocess.run(["sips", "-Z", "1100", png], capture_output=True)
        print(png)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("specs")
    p = sub.add_parser("pdf"); p.add_argument("src"); p.add_argument("--pick", nargs="*")
    p.add_argument("--anchor", default="귀하"); p.add_argument("--pad", type=float, default=3.7)
    t = sub.add_parser("text"); t.add_argument("--line", action="append", required=True)
    t.add_argument("--count", type=int)
    i = sub.add_parser("image"); i.add_argument("images", nargs="+"); i.add_argument("--gap", type=int, default=30)
    v = sub.add_parser("preview"); v.add_argument("pdf")
    for x in (p, t, i, v):
        x.add_argument("--spec", default="LS-3108", choices=list(SPECS))
    for x in (p, t, i):
        x.add_argument("--out")
    a = ap.parse_args()
    if a.cmd == "specs":
        for k, s in SPECS.items():
            print(f"{k}: {s['name']} — {s['cols']}×{s['rows']}칸, 칸 {s['w']}×{s['h']}mm, "
                  f"여백 왼 {s['left']}·위 {s['top']}mm, 간격 가로 {s['gap_x']}·세로 {s['gap_y']}mm")
    else:
        {"pdf": cmd_pdf, "text": cmd_text, "image": cmd_image, "preview": cmd_preview}[a.cmd](a)


if __name__ == "__main__":
    main()
