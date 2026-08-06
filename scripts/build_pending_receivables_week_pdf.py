from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle


ROOT = Path("/Users/jhonnymiller/Documents/programa decodificador")
TODAY_JSON = ROOT / "outputs/conciliacao_shein_20260728/conciliacao_shein_20260728.json"
OUTPUT_DIR = ROOT / "output/pdf"
OUTPUT_PDF = OUTPUT_DIR / "relatorio_pendencias_shein_modal_semana_20260727_20260802.pdf"


def parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(value), fmt)
        except ValueError:
            pass
    return None


def br_money(value: Any) -> str:
    text = f"{float(value or 0):,.2f}"
    return "R$ " + text.replace(",", "X").replace(".", ",").replace("X", ".")


def br_datetime(value: Any) -> str:
    dt = parse_dt(value)
    return dt.strftime("%d/%m/%Y %H:%M") if dt else "-"


def p(value: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(str(value).replace("&", "&amp;"), style)


def page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawRightString(landscape(A4)[0] - 1.3 * cm, 0.8 * cm, f"Pagina {doc.page}")
    canvas.restoreState()


OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
data = json.loads(TODAY_JSON.read_text(encoding="utf-8"))

week_start = datetime(2026, 7, 27)
week_end = datetime(2026, 8, 2, 23, 59, 59)

overdue = []
for row in data["pending"]:
    success_dt = parse_dt(row["Tempo sucesso"])
    if success_dt and week_start <= success_dt <= week_end:
        overdue.append(
            {
                "Grupo retirada": row["Grupo retirada"],
                "Pedido retirada": row["Pedido retirada"],
                "Tempo sucesso": row["Tempo sucesso"],
                "Valor": float(row["Valor Shein"] or 0),
                "Situacao": row["Situacao"],
            }
        )

overdue.sort(key=lambda r: (parse_dt(r["Tempo sucesso"]) or datetime.min, r["Pedido retirada"]))
total_overdue = round(sum(r["Valor"] for r in overdue), 2)
total_processing = 0.0
total_open = total_overdue + total_processing

styles = getSampleStyleSheet()
title_style = ParagraphStyle("Title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=17, textColor=colors.HexColor("#0F172A"), alignment=TA_CENTER, spaceAfter=8)
subtitle_style = ParagraphStyle("Subtitle", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#475569"), alignment=TA_CENTER, spaceAfter=12)
section_style = ParagraphStyle("Section", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, textColor=colors.HexColor("#1E3A8A"), spaceBefore=12, spaceAfter=6)
body_style = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=9, leading=12)
small_style = ParagraphStyle("Small", parent=body_style, fontSize=8, leading=10)
header_style = ParagraphStyle("Header", parent=small_style, fontName="Helvetica-Bold", textColor=colors.white, alignment=TA_CENTER)

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
    Paragraph("Relatorio de Pendencias a Receber - Shein/Modal", title_style),
    Paragraph("Relatorio individual da semana de 27/07/2026 a 02/08/2026", subtitle_style),
]

summary_rows = [
    ["Categoria", "Quantidade", "Valor"],
    ["Retiradas bem-sucedidas nao localizadas no banco", str(len(overdue)), br_money(total_overdue)],
    ["Retiradas ainda pendentes na Shein", "0", br_money(total_processing)],
    ["Total em aberto", str(len(overdue)), br_money(total_open)],
]
summary_table = Table(summary_rows, colWidths=[12.2 * cm, 4 * cm, 4 * cm], hAlign="CENTER")
summary_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
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
    "respectivos comprovantes de pagamento com data, valor e identificacao bancaria para baixa da pendencia."
)
story.append(Paragraph(request_text, body_style))

story.append(Paragraph("Pendencias atrasadas - bem-sucedidas na Shein e nao localizadas no banco", section_style))
rows = [[p("Grupo retirada", header_style), p("Pedido retirada", header_style), p("Data sucesso", header_style), p("Valor", header_style), p("Situacao", header_style)]]
for row in overdue:
    rows.append(
        [
            p(row["Grupo retirada"], small_style),
            p(row["Pedido retirada"], small_style),
            p(br_datetime(row["Tempo sucesso"]), small_style),
            p(br_money(row["Valor"]), small_style),
            p(row["Situacao"], small_style),
        ]
    )
table = Table(rows, colWidths=[5.1 * cm, 5.1 * cm, 3.7 * cm, 2.7 * cm, 7.5 * cm], repeatRows=1, hAlign="LEFT")
table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]
    )
)
story.append(table)
story.append(Spacer(1, 10))
story.append(Paragraph("Fonte: conciliacao realizada em 28/07/2026 com relatorio financeiro Shein/Modal e extrato bancario Bradesco.", small_style))

doc.build(story)
print(OUTPUT_PDF)
print("Pendencias da semana:", len(overdue), br_money(total_overdue))
