from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import pdfplumber


ROOT = Path("/Users/jhonnymiller/Documents/programa decodificador")
PDF_PATH = Path("/Users/jhonnymiller/Downloads/Bradesco_20072026_165054.PDF")
RECON_JSON = ROOT / "outputs/shein_moda_conciliacao/reconciliation_data.json"
OUT_DIR = ROOT / "outputs/shein_valores_pendentes_possiveis_matches"
OUT_JSON = OUT_DIR / "possiveis_matches_por_valor.json"

DATE_RE = re.compile(r"^(\d{2}/\d{2}/\d{4})\b")
MONEY_RE = re.compile(r"(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})$")


def br_to_float(value: str | float | int | None) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (float, int)):
        return round(float(value), 2)
    return round(float(value.replace(".", "").replace(",", ".")), 2)


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


def is_probably_transaction(line: str) -> bool:
    return bool(MONEY_RE.search(line))


def extract_bank_transactions() -> list[dict[str, Any]]:
    with pdfplumber.open(str(PDF_PATH)) as pdf:
        lines = []
        for page_num, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(x_tolerance=1, y_tolerance=3) or ""
            for line in text.splitlines():
                line = line.strip()
                if line:
                    lines.append((page_num, line))

    transactions: list[dict[str, Any]] = []
    current_date = ""
    for idx, (page_num, line) in enumerate(lines):
        date_match = DATE_RE.match(line)
        if date_match:
            current_date = date_match.group(1)

        money_match = MONEY_RE.search(line)
        if not money_match:
            continue

        value_txt, balance_txt = money_match.groups()
        prefix = line[: money_match.start()].strip()
        tx_date = current_date
        date_match = DATE_RE.match(prefix)
        if date_match:
            tx_date = date_match.group(1)
            prefix = prefix[date_match.end() :].strip()

        parts = prefix.split()
        if not parts:
            continue
        doc = None
        doc_pos = None
        for pos in range(len(parts) - 1, -1, -1):
            if parts[pos].isdigit():
                doc = parts[pos]
                doc_pos = pos
                break
        if doc is None or doc_pos is None:
            continue

        launch = " ".join(parts[:doc_pos]).strip()
        if not launch and idx > 0:
            previous = lines[idx - 1][1]
            if not is_probably_transaction(previous) and "REMET." not in previous and "REM:" not in previous and "DES:" not in previous:
                launch = previous

        detail = ""
        if idx + 1 < len(lines):
            next_line = lines[idx + 1][1]
            if not is_probably_transaction(next_line) and not next_line.startswith("Data "):
                if not DATE_RE.match(next_line) or next_line.startswith(("REM:", "REMET.", "DES:")):
                    detail = next_line

        value = br_to_float(value_txt)
        transactions.append(
            {
                "Data": tx_date,
                "Lancamento": launch,
                "Documento": doc,
                "Valor": value,
                "Saldo apos": br_to_float(balance_txt),
                "Detalhe": detail,
                "Linha original": line,
                "Pagina": page_num,
                "Tipo": "Credito" if value > 0 else "Debito",
            }
        )
    return transactions


payload = json.loads(RECON_JSON.read_text(encoding="utf-8"))
pending_shein = [
    row
    for row in payload["shein_pending"]
    if row["Situacao conciliacao"] in {"Nao localizado no banco", "Ainda pendente na Shein"}
]
bank_transactions = extract_bank_transactions()
bank_credits = [row for row in bank_transactions if row["Valor"] > 0]

credits_by_value: dict[float, list[dict[str, Any]]] = defaultdict(list)
for credit in bank_credits:
    credits_by_value[round(float(credit["Valor"]), 2)].append(credit)

matches = []
unmatched_pending = []
for row in pending_shein:
    value = round(float(row["Valor Shein"] or 0), 2)
    candidates = credits_by_value.get(value, [])
    if candidates:
        for candidate in candidates:
            success_dt = parse_date(row.get("Tempo de sucesso")) or parse_date(row.get("Tempo de retirada"))
            bank_dt = parse_date(candidate["Data"])
            day_diff = None
            if success_dt and bank_dt:
                day_diff = (bank_dt.date() - success_dt.date()).days
            matches.append(
                {
                    "Grupo retirada": row["Grupo retirada"],
                    "Pedido retirada": row["Número do pedido de retirada"],
                    "Status Shein": row["Status Shein"],
                    "Situacao Shein": row["Situacao conciliacao"],
                    "Data Shein": (success_dt.date().isoformat() if success_dt else ""),
                    "Valor Shein": value,
                    "Data banco": candidate["Data"],
                    "Lancamento banco": candidate["Lancamento"],
                    "Documento banco": candidate["Documento"],
                    "Detalhe banco": candidate["Detalhe"],
                    "Valor banco": candidate["Valor"],
                    "Saldo banco": candidate["Saldo apos"],
                    "Diferenca dias banco menos Shein": day_diff,
                    "Linha banco": candidate["Linha original"],
                    "Pagina banco": candidate["Pagina"],
                }
            )
    else:
        unmatched_pending.append(row)

OUT_DIR.mkdir(parents=True, exist_ok=True)
result = {
    "matches": matches,
    "unmatched_pending": unmatched_pending,
    "bank_credits": bank_credits,
    "summary": {
        "pending_shein_count": len(pending_shein),
        "pending_shein_total": round(sum(float(r["Valor Shein"] or 0) for r in pending_shein), 2),
        "matched_pending_unique_count": len({m["Pedido retirada"] for m in matches}),
        "matched_pending_unique_total": round(
            sum({m["Pedido retirada"]: m["Valor Shein"] for m in matches}.values()), 2
        ),
        "candidate_rows_count": len(matches),
        "unmatched_pending_count": len(unmatched_pending),
        "unmatched_pending_total": round(sum(float(r["Valor Shein"] or 0) for r in unmatched_pending), 2),
        "bank_credit_rows_scanned": len(bank_credits),
    },
}
OUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

print(json.dumps(result["summary"], ensure_ascii=False, indent=2))
for match in matches:
    print(
        "MATCH",
        match["Pedido retirada"],
        match["Valor Shein"],
        match["Data banco"],
        match["Lancamento banco"],
        match["Detalhe banco"],
        match["Documento banco"],
    )
