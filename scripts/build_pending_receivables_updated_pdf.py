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
OLD_JSON = ROOT / "outputs/shein_moda_conciliacao/reconciliation_data.json"
TODAY_JSON = ROOT / "outputs/conciliacao_shein_20260728/conciliacao_shein_20260728.json"
OUTPUT_DIR = ROOT / "output/pdf"
OUTPUT_PDF = OUTPUT_DIR / "relatorio_pendencias_shein_modal_atualizado_20260728.pdf"


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


def make_table(headers: list[str], rows: list[list[Any]], widths: list[float], body_style: ParagraphStyle) -> Table:
    data = [[p(header, header_style) for header in headers]]
    for row in rows:
        data.append([p(cell, body_style) for cell in row])
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 7.1),
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
old = json.loads(OLD_JSON.read_text(encoding="utf-8"))
today = json.loads(TODAY_JSON.read_text(encoding="utf-8"))

overdue = [
    {
        "Grupo retirada": r["Grupo retirada"],
        "Pedido retirada": r["Número do pedido de retirada"],
        "Tempo sucesso": r["Tempo de sucesso"],
        "Valor": float(r["Valor Shein"] or 0),
        "Situacao": r["Situacao conciliacao"],
        "Origem": "Conciliação anterior",
    }
    for r in old["shein_pending"]
    if r["Situacao conciliacao"] == "Nao localizado no banco"
]
processing = [
    {
        "Grupo retirada": r["Grupo retirada"],
        "Pedido retirada": r["Número do pedido de retirada"],
        "Tempo retirada": r["Tempo de retirada"],
        "Valor": float(r["Valor Shein"] or 0),
        "Status": r["Status Shein"],
        "Origem": "Conciliação anterior",
    }
    for r in old["shein_pending"]
    if r["Situacao conciliacao"] == "Ainda pendente na Shein"
]

today_overdue = [
    {
        "Grupo retirada": r["Grupo retirada"],
        "Pedido retirada": r["Pedido retirada"],
        "Tempo sucesso": r["Tempo sucesso"],
        "Valor": float(r["Valor Shein"] or 0),
        "Situacao": r["Situacao"],
        "Origem": "Conciliação 28/07/2026",
    }
    for r in today["pending"]
]
overdue.extend(today_overdue)

overdue.sort(key=lambda r: (parse_dt(r["Tempo sucesso"]) or datetime.min, r["Pedido retirada"]))
processing.sort(key=lambda r: (parse_dt(r["Tempo retirada"]) or datetime.min, r["Pedido retirada"]))

total_overdue = round(sum(r["Valor"] for r in overdue), 2)
total_processing = round(sum(r["Valor"] for r in processing), 2)
total_open = round(total_overdue + total_processing, 2)

styles = getSampleStyleSheet()
title_style = ParagraphStyle("Title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=17, textColor=colors.HexColor("#0F172A"), alignment=TA_CENTER, spaceAfter=8)
subtitle_style = ParagraphStyle("Subtitle", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#475569"), alignment=TA_CENTER, spaceAfter=12)
section_style = ParagraphStyle("Section", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, textColor=colors.HexColor("#1E3A8A"), spaceBefore=12, spaceAfter=6)
body_style = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=9, leading=12, alignment=TA_LEFT)
small_style = ParagraphStyle("Small", parent=body_style, fontSize=7.1, leading=8.8)
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
    Paragraph("Atualizado com a conciliacao realizada em 28/07/2026", subtitle_style),
]

summary_rows = [
    ["Categoria", "Quantidade", "Valor"],
    ["Retiradas bem-sucedidas nao localizadas no banco", str(len(overdue)), br_money(total_overdue)],
    ["Retiradas ainda pendentes na Shein", str(len(processing)), br_money(total_processing)],
    ["Total em aberto", str(len(overdue) + len(processing)), br_money(total_open)],
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
    "respectivos comprovantes de pagamento com data, valor e identificacao bancaria para baixa da pendencia. "
    f"Tambem constam {len(processing)} retiradas ainda em processamento, no total de {br_money(total_processing)}, "
    "as quais devem ser acompanhadas ate a efetiva liquidacao."
)
story.append(Paragraph(request_text, body_style))

story.append(Paragraph("Pendencias atrasadas - bem-sucedidas na Shein e nao localizadas no banco", section_style))
overdue_rows = [
    [r["Grupo retirada"], r["Pedido retirada"], br_datetime(r["Tempo sucesso"]), br_money(r["Valor"]), r["Origem"], r["Situacao"]]
    for r in overdue
]
story.append(
    make_table(
        ["Grupo retirada", "Pedido retirada", "Data sucesso", "Valor", "Origem", "Situacao"],
        overdue_rows,
        [4.7 * cm, 4.8 * cm, 3.1 * cm, 2.4 * cm, 3.4 * cm, 5.6 * cm],
        small_style,
    )
)

story.append(PageBreak())
story.append(Paragraph("Retiradas ainda pendentes na Shein", section_style))
processing_rows = [
    [r["Grupo retirada"], r["Pedido retirada"], br_datetime(r["Tempo retirada"]), br_money(r["Valor"]), r["Status"], r["Origem"]]
    for r in processing
]
story.append(
    make_table(
        ["Grupo retirada", "Pedido retirada", "Data retirada", "Valor", "Status Shein", "Origem"],
        processing_rows,
        [4.9 * cm, 4.9 * cm, 3.4 * cm, 2.5 * cm, 5.0 * cm, 5.0 * cm],
        small_style,
    )
)
story.append(Spacer(1, 10))
story.append(Paragraph("Fonte: conciliacoes realizadas com os relatorios financeiros Shein/Modal e extratos bancarios Bradesco.", small_style))

doc.build(story)
print(OUTPUT_PDF)
print("Atrasados:", len(overdue), br_money(total_overdue))
print("Em processamento:", len(processing), br_money(total_processing))
print("Total em aberto:", br_money(total_open))
