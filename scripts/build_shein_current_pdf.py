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
INPUT_JSON = ROOT / "outputs/conciliacao_shein_20260728/conciliacao_shein_20260728.json"
OUTPUT_DIR = ROOT / "output/pdf"
OUTPUT_PDF = OUTPUT_DIR / "relatorio_conciliacao_shein_20260728.pdf"


def parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        try:
            return datetime.strptime(str(value), "%d/%m/%Y")
        except ValueError:
            return None


def br_money(value: Any) -> str:
    text = f"{float(value or 0):,.2f}"
    return "R$ " + text.replace(",", "X").replace(".", ",").replace("X", ".")


def br_date(value: Any) -> str:
    dt = parse_dt(value)
    return dt.strftime("%d/%m/%Y") if dt else "-"


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
data = json.loads(INPUT_JSON.read_text(encoding="utf-8"))
summary = data["summary"]

styles = getSampleStyleSheet()
title_style = ParagraphStyle("Title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=17, textColor=colors.HexColor("#0F172A"), alignment=TA_CENTER)
subtitle_style = ParagraphStyle("Subtitle", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#475569"), alignment=TA_CENTER, spaceAfter=12)
section_style = ParagraphStyle("Section", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, textColor=colors.HexColor("#1E3A8A"), spaceBefore=10, spaceAfter=6)
body_style = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=9, leading=12, alignment=TA_LEFT)
small_style = ParagraphStyle("Small", parent=body_style, fontSize=8, leading=10)
header_style = ParagraphStyle("Header", parent=small_style, fontName="Helvetica-Bold", textColor=colors.white, alignment=TA_CENTER)

doc = BaseDocTemplate(str(OUTPUT_PDF), pagesize=landscape(A4), rightMargin=1.2 * cm, leftMargin=1.2 * cm, topMargin=1.1 * cm, bottomMargin=1.2 * cm)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
doc.addPageTemplates([PageTemplate(id="main", frames=frame, onPage=page_number)])

story = [
    Paragraph("Relatorio de Conciliacao Shein x Bradesco", title_style),
    Paragraph("Arquivos: 2438356_20260729002019.xlsx e Bradesco_28072026_131839.PDF", subtitle_style),
]

summary_rows = [
    ["Categoria", "Quantidade", "Valor"],
    ["Shein - itens no relatorio", summary["shein_count"], br_money(summary["shein_total"])],
    ["Recebidos/conciliados", summary["reconciled_count"], br_money(summary["reconciled_total"])],
    ["A receber", summary["pending_count"], br_money(summary["pending_total"])],
    ["Creditos bancarios analisados", summary["bank_credit_count"], br_money(summary["bank_credit_total"])],
]
summary_table = Table(summary_rows, colWidths=[10.5 * cm, 4 * cm, 4 * cm], hAlign="CENTER")
summary_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("FONTNAME", (0, -2), (-1, -2), "Helvetica-Bold"),
    ("BACKGROUND", (0, -2), (-1, -2), colors.HexColor("#FEF3C7")),
    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
    ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story.append(summary_table)
story.append(Spacer(1, 10))

story.append(Paragraph("Recebidos e conciliados", section_style))
rec_rows = [[p("Pedido Shein", header_style), p("Data banco", header_style), p("Documento", header_style), p("Pagador/detalhe", header_style), p("Valor", header_style), p("Situacao", header_style)]]
for r in data["reconciled"]:
    rec_rows.append([p(r["Pedido retirada"], small_style), p(br_date(r["Data banco"]), small_style), p(r["Documento banco"], small_style), p(r["Detalhe banco"], small_style), p(br_money(r["Valor Shein"]), small_style), p(r["Situacao"], small_style)])
rec_table = Table(rec_rows, colWidths=[5.0 * cm, 2.7 * cm, 2.8 * cm, 5.2 * cm, 2.7 * cm, 5.0 * cm], repeatRows=1)
rec_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#166534")),
    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
]))
story.append(rec_table)

story.append(Paragraph("A receber", section_style))
pend_rows = [[p("Pedido Shein", header_style), p("Tempo sucesso", header_style), p("Status", header_style), p("Valor", header_style), p("Situacao", header_style)]]
for r in data["pending"]:
    pend_rows.append([p(r["Pedido retirada"], small_style), p(br_datetime(r["Tempo sucesso"]), small_style), p(r["Status Shein"], small_style), p(br_money(r["Valor Shein"]), small_style), p(r["Situacao"], small_style)])
pend_table = Table(pend_rows, colWidths=[5.2 * cm, 4.0 * cm, 4.0 * cm, 3.0 * cm, 7.5 * cm], repeatRows=1)
pend_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#92400E")),
    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
]))
story.append(pend_table)
story.append(Spacer(1, 10))
story.append(Paragraph("Conclusao: foi localizado 1 recebimento no extrato, no valor de R$ 5.072,99. Permanecem 4 itens a receber, somando R$ 2.915,82.", body_style))

doc.build(story)
print(OUTPUT_PDF)
