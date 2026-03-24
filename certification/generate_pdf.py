#!/usr/bin/env python3
"""
민간자격 관리·운영 규정 PDF 생성기
사용법: python3 generate_pdf.py <입력.md> [출력.pdf]
"""

import sys
import os
import re

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors

# ── 한글 폰트 등록 ──────────────────────────────────────────
def register_korean_fonts():
    candidates = [
        ("/System/Library/Fonts/AppleSDGothicNeo.ttc", "KoreanRegular", 0),
        ("/System/Library/Fonts/AppleSDGothicNeo.ttc", "KoreanBold", 4),
        ("/System/Library/Fonts/Supplemental/AppleGothic.ttf", "KoreanRegular", None),
    ]
    reg_name = bold_name = None
    for path, name, index in candidates:
        if not os.path.exists(path):
            continue
        try:
            if index is not None:
                pdfmetrics.registerFont(TTFont(name, path, subfontIndex=index))
            else:
                pdfmetrics.registerFont(TTFont(name, path))
            if name == "KoreanRegular":
                reg_name = name
            elif name == "KoreanBold":
                bold_name = name
        except Exception:
            continue
        if reg_name:
            break

    if not reg_name:
        raise RuntimeError("한글 폰트를 찾을 수 없습니다.")
    if not bold_name:
        bold_name = reg_name
    return reg_name, bold_name


# ── 스타일 정의 ────────────────────────────────────────────
def make_styles(reg, bold):
    return {
        "title": ParagraphStyle("title", fontName=bold, fontSize=20, alignment=TA_CENTER, leading=28),
        "title_en": ParagraphStyle("title_en", fontName=reg, fontSize=12, alignment=TA_CENTER, leading=18),
        "doc_type": ParagraphStyle("doc_type", fontName=bold, fontSize=16, alignment=TA_CENTER, leading=24),
        "chapter": ParagraphStyle("chapter", fontName=bold, fontSize=12, alignment=TA_CENTER,
                                  leading=20, spaceBefore=16, spaceAfter=8),
        "article": ParagraphStyle("article", fontName=reg, fontSize=10, alignment=TA_JUSTIFY,
                                  leading=18, spaceBefore=4, spaceAfter=2),
        "item": ParagraphStyle("item", fontName=reg, fontSize=10, alignment=TA_LEFT,
                               leading=18, leftIndent=12),
        "appendix_title": ParagraphStyle("appendix_title", fontName=bold, fontSize=10,
                                         alignment=TA_LEFT, leading=18, spaceBefore=10),
        "normal": ParagraphStyle("normal", fontName=reg, fontSize=10, alignment=TA_LEFT, leading=18),
    }


# ── 마크다운 파서 ──────────────────────────────────────────
def parse_markdown(md_text, styles):
    """마크다운을 ReportLab Flowable 목록으로 변환"""
    reg = styles["normal"].fontName
    bold = styles["title"].fontName
    elements = []
    lines = md_text.split("\n")

    # 표지 정보 추출
    cert_name = ""
    cert_en = ""
    body_start = 0
    for i, line in enumerate(lines):
        h1 = re.match(r'^#\s+(.+)$', line)
        en = re.match(r'^\((.+)\)\s*$', line)
        if h1 and not cert_name:
            cert_name = h1.group(1).strip()
            body_start = i + 1
        elif en and not cert_en:
            cert_en = en.group(1).strip()
            body_start = i + 1

    # 표지 박스
    if cert_name:
        title_data = [
            [Paragraph(cert_name, styles["title"])],
            [Paragraph(f"({cert_en})", styles["title_en"])],
            [Paragraph("자격 관리·운영 규정", styles["doc_type"])],
        ]
        title_table = Table(title_data, colWidths=[150 * mm])
        title_table.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 1.5, colors.black),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ]))
        elements.append(Spacer(1, 30 * mm))
        elements.append(title_table)
        elements.append(Spacer(1, 20 * mm))

    # 본문 파싱
    i = body_start
    while i < len(lines):
        line = lines[i]

        # 수평선
        if re.match(r'^---+\s*$', line):
            elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.grey))
            elements.append(Spacer(1, 3 * mm))
            i += 1
            continue

        # 표 감지
        if i + 1 < len(lines) and re.match(r'^\|', line) and re.match(r'^\|[-| :]+\|', lines[i + 1]):
            table_lines = []
            while i < len(lines) and re.match(r'^\|', lines[i]):
                table_lines.append(lines[i])
                i += 1
            elements.append(build_table(table_lines, reg, bold))
            elements.append(Spacer(1, 3 * mm))
            continue

        # ## 장 헤더
        h2 = re.match(r'^##\s+(.+)$', line)
        if h2:
            elements.append(Paragraph(h2.group(1).strip(), styles["chapter"]))
            i += 1
            continue

        # ### 별표 타이틀
        h3 = re.match(r'^###\s+(.+)$', line)
        if h3:
            elements.append(Paragraph(h3.group(1).strip(), styles["appendix_title"]))
            i += 1
            continue

        # 번호 목록 (1. 2. 3.)
        num_item = re.match(r'^(\d+)\.\s+(.+)$', line)
        if num_item:
            text = inline_format(num_item.group(2), reg, bold)
            elements.append(Paragraph(f"{num_item.group(1)}. {text}", styles["item"]))
            i += 1
            continue

        # blockquote (> ...) — 템플릿 주석 등이므로 건너뜀
        if line.strip().startswith(">"):
            i += 1
            continue

        # 일반 텍스트 / **제N조** 형식
        if line.strip():
            text = inline_format(line.strip(), reg, bold)
            elements.append(Paragraph(text, styles["article"]))

        i += 1

    return elements


def inline_format(text, reg, bold):
    """**굵게** 마크다운을 ReportLab 태그로 변환. HTML 특수문자 이스케이프 처리."""
    # **굵게** 구간을 임시 토큰으로 보호
    parts = re.split(r'(\*\*.+?\*\*)', text)
    result = []
    for part in parts:
        bold_match = re.match(r'\*\*(.+?)\*\*', part)
        if bold_match:
            inner = _escape_html(bold_match.group(1))
            result.append(f"<b>{inner}</b>")
        else:
            result.append(_escape_html(part))
    return "".join(result)


def _escape_html(text):
    """HTML 특수문자 이스케이프 (backtick 내부 포함)"""
    # backtick 코드 → 텍스트만 추출
    text = re.sub(r'`([^`]*)`', lambda m: m.group(1), text)
    text = text.replace('&', '&amp;')
    text = text.replace('<', '&lt;')
    text = text.replace('>', '&gt;')
    return text


def build_table(table_lines, reg, bold):
    """마크다운 표를 ReportLab Table로 변환 (빈 셀은 위 셀과 병합)"""
    rows = []
    for line in table_lines:
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        rows.append(cells)

    # 구분선 행 제거
    rows = [r for r in rows if not all(re.match(r'^[-: ]+$', c) for c in r)]
    if not rows:
        return Spacer(1, 1)

    col_count = max(len(r) for r in rows)
    # 열 너비
    page_w = 170 * mm
    if col_count >= 5:
        mid_cols = col_count - 2
        col_widths = [55 * mm] + [18 * mm] * mid_cols + [page_w - 55 * mm - 18 * mm * mid_cols]
    elif col_count == 4:
        col_widths = [32 * mm, 18 * mm, 18 * mm, page_w - 68 * mm]
    elif col_count == 3:
        col_widths = [32 * mm, 18 * mm, page_w - 50 * mm]
    elif col_count == 2:
        col_widths = [40 * mm, page_w - 40 * mm]
    else:
        col_widths = [page_w]

    # 열 수 맞추기
    for row in rows:
        while len(row) < col_count:
            row.append("")

    # 병합 범위 계산: 헤더(row 0) 제외, 빈 셀은 위 행과 SPAN
    span_cmds = []
    # col별로 연속 빈 셀 그룹 탐색
    for col in range(col_count):
        span_start = None
        for row_i in range(1, len(rows)):  # 헤더 제외
            cell = rows[row_i][col]
            if cell == "":
                if span_start is None:
                    span_start = row_i - 1  # 위 행부터 시작
            else:
                if span_start is not None:
                    span_end = row_i - 1
                    if span_end > span_start:
                        span_cmds.append(("SPAN", (col, span_start), (col, span_end)))
                    span_start = None
        # 마지막까지 빈 셀인 경우
        if span_start is not None:
            span_end = len(rows) - 1
            if span_end > span_start:
                span_cmds.append(("SPAN", (col, span_start), (col, span_end)))

    data = []
    for row_i, row in enumerate(rows):
        font = bold if row_i == 0 else reg
        data.append([Paragraph(inline_format(c, reg, bold), ParagraphStyle(
            "tc", fontName=font, fontSize=9, leading=14,
            alignment=TA_CENTER
        )) for c in row])

    style_cmds = [
        ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
        ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.93, 0.93, 0.93)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ] + span_cmds

    # 마지막 열(내용 열)은 좌측 정렬 (4열 이상 표에서)
    if col_count >= 3:
        style_cmds.append(("ALIGN", (col_count - 1, 1), (col_count - 1, -1), "LEFT"))

    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle(style_cmds))
    return t


# ── 메인 ───────────────────────────────────────────────────
def generate_pdf(input_path, output_path=None):
    if output_path is None:
        output_path = os.path.splitext(input_path)[0] + ".pdf"

    with open(input_path, encoding="utf-8") as f:
        md_text = f.read()

    reg, bold = register_korean_fonts()
    styles = make_styles(reg, bold)

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=20 * mm, bottomMargin=20 * mm,
    )

    elements = parse_markdown(md_text, styles)
    doc.build(elements)
    print(f"PDF 생성 완료: {output_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python3 generate_pdf.py <입력.md> [출력.pdf]")
        sys.exit(1)
    generate_pdf(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
