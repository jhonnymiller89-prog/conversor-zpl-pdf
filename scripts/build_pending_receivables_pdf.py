from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path("/Users/jhonnymiller/Documents/programa decodificador")
INPUT_JSON = ROOT / "outputs/shein_moda_conciliacao/reconciliation_data.json"
OUTPUT_DIR = ROOT / "output/pdf"
OUTPUT_PDF = OUTPUT_DIR / "relatorio_pendencias_shein_modal.pdf"


def parse_date(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def br_money(value: Any) -> str:
    number = float(value or 0)
    text = f"{number:,.2f}"
    return "R$ " + text.replace(",", "X").replace(".", ",").replace("X", ".")


def br_date(value: Any) -> str:
    dt = parse_date(value)
    return dt.strftime("%d/%m/%Y") if dt else "-"


def br_datetime(value: Any) -> str:
    dt = parse_date(value)
    return dt.strftime("%d/%m/%Y %H:%M") if dt else "-"


def paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(str(text).replace("&", "&amp;"), style)


def add_page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawRightString(landscape(A4)[0] - 1.3 * cm, 0.8 * cm, f"Pagina {doc.page}")
    canvas.restoreState()


def make_table(headers: list[str], rows: list[list[Any]], widths: list[float], body_style: ParagraphStyle) -> Table:
    data = [[paragraph(h, header_cell_style) for h in headers]]
    for row in rows:
        data.append([paragraph(cell, body_style) for cell in row])
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 7.2),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
payload = json.loads(INPUT_JSON.read_text(encoding="utf-8"))

overdue = [
    row
    for row in payload["shein_pending"]
    if row["Situacao conciliacao"] == "Nao localizado no banco"
]
pending = [
    row
    for row in payload["shein_pending"]
    if row["Situacao conciliacao"] == "Ainda pendente na Shein"
]

overdue.sort(key=lambda r: (parse_date(r["Tempo de sucesso"]) or datetime.min, r["Número do pedido de retirada"]))
pending.sort(key=lambda r: (parse_date(r["Tempo de retirada"]) or datetime.min, r["Número do pedido de retirada"]))

total_overdue = round(sum(float(r["Valor Shein"] or 0) for r in overdue), 2)
total_pending = round(sum(float(r["Valor Shein"] or 0) for r in pending), 2)
total_open = round(total_overdue + total_pending, 2)

styles = getSampleStyleSheet()
title_style = ParagraphStyle(
    "Title",
    parent=styles["Title"],
    fontName="Helvetica-Bold",
    fontSize=17,
    textColor=colors.HexColor("#0F172A"),
    alignment=TA_CENTER,
    spaceAfter=10,
)
subtitle_style = ParagraphStyle(
    "Subtitle",
    parent=styles["Normal"],
    fontName="Helvetica",
    fontSize=9,
    textColor=colors.HexColor("#475569"),
    alignment=TA_CENTER,
    spaceAfter=12,
)
section_style = ParagraphStyle(
    "Section",
    parent=styles["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=12,
    textColor=colors.HexColor("#1E3A8A"),
    spaceBefore=12,
    spaceAfter=6,
)
body_style = ParagraphStyle(
    "Body",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=9,
    leading=12,
    textColor=colors.HexColor("#111827"),
    alignment=TA_LEFT,
)
small_style = ParagraphStyle(
    "Small",
    parent=body_style,
    fontSize=7.1,
    leading=8.8,
)
header_cell_style = ParagraphStyle(
    "HeaderCell",
    parent=small_style,
    fontName="Helvetica-Bold",
    textColor=colors.white,
    alignment=TA_CENTER,
)

doc = BaseDocTemplate(
    str(OUTPUT_PDF),
    pagesize=landscape(A4),
    rightMargin=1.2 * cm,
    leftMargin=1.2 * cm,
    topMargin=1.1 * cm,
    bottomMargin=1.2 * cm,
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
doc.addPageTemplates([PageTemplate(id="main", frames=frame, onPage=add_page_number)])

story = []
story.append(Paragraph("Relatorio de Pendencias a Receber - Shein/Modal", title_style))
story.append(Paragraph("Conferencia contra creditos bancarios MODA MUNDIAL BRASIL", subtitle_style))

summary_rows = [
    ["Categoria", "Quantidade", "Valor"],
    ["Retiradas bem-sucedidas nao localizadas no banco", str(len(overdue)), br_money(total_overdue)],
    ["Retiradas ainda pendentes na Shein", str(len(pending)), br_money(total_pending)],
    ["Total em aberto", str(len(overdue) + len(pending)), br_money(total_open)],
]
summary_table = Table(summary_rows, colWidths=[12.2 * cm, 4 * cm, 4 * cm], hAlign="CENTER")
summary_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#DBEAFE")),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]
    )
)
story.append(summary_table)

story.append(Paragraph("Texto para solicitacao de pagamento", section_style))
request_text = (
    "Prezados, apos conciliacao do relatorio financeiro Shein/Modal com os creditos bancarios recebidos "
    "de MODA MUNDIAL BRASIL, identificamos retiradas marcadas como bem-sucedidas na plataforma que ainda "
    "nao foram localizadas no extrato bancario analisado. Solicitamos, por gentileza, a regularizacao do "
    f"pagamento dos valores atrasados, atualmente somando {br_money(total_overdue)}, ou o envio dos "
    "respectivos comprovantes de pagamento com data, valor e identificacao bancaria para baixa da pendencia. "
    f"Tambem constam {len(pending)} retiradas ainda em processamento, no total de {br_money(total_pending)}, "
    "as quais devem ser acompanhadas ate a efetiva liquidacao."
)
story.append(Paragraph(request_text, body_style))

story.append(Paragraph("Pendencias atrasadas - bem-sucedidas na Shein e nao localizadas no banco", section_style))
overdue_rows = [
    [
        r["Grupo retirada"],
        r["Número do pedido de retirada"],
        br_datetime(r["Tempo de sucesso"]),
        br_money(r["Valor Shein"]),
        r["Situacao conciliacao"],
    ]
    for r in overdue
]
story.append(
    make_table(
        ["Grupo retirada", "Pedido retirada", "Data sucesso", "Valor", "Situacao"],
        overdue_rows,
        [5.0 * cm, 5.0 * cm, 3.4 * cm, 2.5 * cm, 8.0 * cm],
        small_style,
    )
)

story.append(PageBreak())
story.append(Paragraph("Retiradas ainda pendentes na Shein", section_style))
pending_rows = [
    [
        r["Grupo retirada"],
        r["Número do pedido de retirada"],
        br_datetime(r["Tempo de retirada"]),
        br_money(r["Valor Shein"]),
        r["Status Shein"],
    ]
    for r in pending
]
story.append(
    make_table(
        ["Grupo retirada", "Pedido retirada", "Data retirada", "Valor", "Status Shein"],
        pending_rows,
        [5.0 * cm, 5.0 * cm, 3.4 * cm, 2.5 * cm, 8.0 * cm],
        small_style,
    )
)

story.append(Spacer(1, 10))
story.append(
    Paragraph(
        "Fonte: conciliacao gerada a partir do relatorio financeiro Shein/Modal e do extrato bancario filtrado por MODA MUNDIAL BRASIL.",
        small_style,
    )
)

doc.build(story)
print(OUTPUT_PDF)
print("Atrasados:", len(overdue), br_money(total_overdue))
print("Ainda pendentes:", len(pending), br_money(total_pending))
print("Total aberto:", br_money(total_open))
