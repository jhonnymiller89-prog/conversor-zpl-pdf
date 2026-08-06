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
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle


ROOT = Path("/Users/jhonnymiller/Documents/programa decodificador")
INPUT_JSON = ROOT / "outputs/shein_moda_conciliacao/reconciliation_data.json"
OUTPUT_DIR = ROOT / "output/pdf"
OUTPUT_PDF = OUTPUT_DIR / "relatorio_recebidos_nao_encontrados_shein.pdf"


def parse_date(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%d/%m/%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                pass
    return None


def br_money(value: Any) -> str:
    number = float(value or 0)
    text = f"{number:,.2f}"
    return "R$ " + text.replace(",", "X").replace(".", ",").replace("X", ".")


def br_date(value: Any) -> str:
    dt = parse_date(value)
    return dt.strftime("%d/%m/%Y") if dt else "-"


def p(text: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(str(text).replace("&", "&amp;"), style)


def page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawRightString(landscape(A4)[0] - 1.3 * cm, 0.8 * cm, f"Pagina {doc.page}")
    canvas.restoreState()


OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
payload = json.loads(INPUT_JSON.read_text(encoding="utf-8"))
items = payload["bank_unmatched"]
items.sort(key=lambda r: (parse_date(r.get("Data_dt")) or parse_date(r.get("Data")) or datetime.min, str(r.get("Documento"))))
total = round(sum(float(r["Credito"] or 0) for r in items), 2)

styles = getSampleStyleSheet()
title_style = ParagraphStyle(
    "Title",
    parent=styles["Title"],
    fontName="Helvetica-Bold",
    fontSize=17,
    textColor=colors.HexColor("#0F172A"),
    alignment=TA_CENTER,
    spaceAfter=8,
)
subtitle_style = ParagraphStyle(
    "Subtitle",
    parent=styles["Normal"],
    fontName="Helvetica",
    fontSize=9,
    textColor=colors.HexColor("#475569"),
    alignment=TA_CENTER,
    spaceAfter=14,
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
small_style = ParagraphStyle("Small", parent=body_style, fontSize=8, leading=10)
header_style = ParagraphStyle(
    "Header",
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
doc.addPageTemplates([PageTemplate(id="main", frames=frame, onPage=page_number)])

story = [
    Paragraph("Relatorio de Recebimentos Nao Encontrados na Shein", title_style),
    Paragraph("Creditos bancarios MODA MUNDIAL BRASIL sem correspondente no relatorio financeiro Shein/Modal", subtitle_style),
]

summary = [
    ["Quantidade de recebimentos", str(len(items))],
    ["Total recebido sem correspondente Shein", br_money(total)],
    ["Periodo", "11/05/2026"],
]
summary_table = Table(summary, colWidths=[8.5 * cm, 6 * cm], hAlign="CENTER")
summary_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#E5E7EB")),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#DBEAFE")),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]
    )
)
story.append(summary_table)
story.append(Spacer(1, 10))

story.append(Paragraph("Analise", section_style))
story.append(
    Paragraph(
        "Os valores abaixo constam como creditos recebidos no extrato bancario com remetente MODA MUNDIAL BRASIL, "
        "mas nao foram encontrados como itens equivalentes no relatorio financeiro Shein/Modal utilizado na conciliacao. "
        "Por isso, recomenda-se verificar se pertencem a outro periodo, se houve agrupamento de pagamento ou se falta "
        "algum detalhe/arquivo complementar do relatorio Shein.",
        body_style,
    )
)

rows = [[p("Data banco", header_style), p("Documento", header_style), p("Lancamento", header_style), p("Remetente", header_style), p("Credito", header_style), p("Saldo apos", header_style), p("Situacao", header_style)]]
for r in items:
    rows.append(
        [
            p(br_date(r.get("Data_dt") or r.get("Data")), small_style),
            p(r.get("Documento", ""), small_style),
            p(r.get("Lancamento", ""), small_style),
            p(r.get("Remetente", ""), small_style),
            p(br_money(r.get("Credito")), small_style),
            p(br_money(r.get("Saldo apos lancamento")), small_style),
            p(r.get("Situacao conciliacao", "Nao localizado na Shein"), small_style),
        ]
    )

table = Table(rows, colWidths=[2.6 * cm, 2.8 * cm, 4.2 * cm, 4.7 * cm, 2.7 * cm, 2.7 * cm, 5.0 * cm], hAlign="LEFT", repeatRows=1)
table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]
    )
)
story.append(Spacer(1, 10))
story.append(table)
story.append(Spacer(1, 12))
story.append(Paragraph("Fonte: conciliacao entre relatorio financeiro Shein/Modal e extrato bancario filtrado por MODA MUNDIAL BRASIL.", small_style))

doc.build(story)
print(OUTPUT_PDF)
print("Quantidade:", len(items))
print("Total:", br_money(total))
