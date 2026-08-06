import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "outputs", "shein_valores_pendentes_possiveis_matches");
const inputJson = path.join(outputDir, "possiveis_matches_por_valor.json");
const outputXlsx = path.join(outputDir, "busca_valores_pendentes_shein_no_extrato.xlsx");

const data = JSON.parse(await fs.readFile(inputJson, "utf8"));

function asDate(value) {
  if (!value) return null;
  const d = new Date(value.includes("/") ? value.split("/").reverse().join("-") : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function money(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function addTableSheet(workbook, name, headers, rows, options = {}) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  const matrix = [headers, ...rows];
  sheet.getRangeByIndexes(0, 0, matrix.length, headers.length).values = matrix;
  sheet.getRangeByIndexes(0, 0, 1, headers.length).format = {
    fill: options.fill || "#1F4E78",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
  };
  sheet.getRangeByIndexes(0, 0, matrix.length, headers.length).format.borders = {
    insideHorizontal: { style: "thin", color: "#E5E7EB" },
    bottom: { style: "thin", color: "#CBD5E1" },
  };
  sheet.freezePanes.freezeRows(1);
  if (rows.length) {
    sheet.tables.add(sheet.getRangeByIndexes(0, 0, matrix.length, headers.length), true, `${name.replace(/[^A-Za-z0-9]/g, "")}Table`);
  }
  for (const [col, fmt] of Object.entries(options.formats || {})) {
    sheet.getRangeByIndexes(1, Number(col), Math.max(rows.length, 1), 1).format.numberFormat = fmt;
  }
  sheet.getRangeByIndexes(0, 0, matrix.length, headers.length).format.autofitColumns();
  sheet.getRangeByIndexes(0, 0, matrix.length, headers.length).format.autofitRows();
  for (const [col, width] of Object.entries(options.widths || {})) {
    sheet.getRangeByIndexes(0, Number(col), matrix.length, 1).format.columnWidth = width;
  }
  return sheet;
}

const wb = Workbook.create();
const summary = wb.worksheets.add("Resumo");
summary.showGridLines = false;
summary.getRange("A1:F1").merge();
summary.getRange("A1").values = [["Busca de valores pendentes da Shein no extrato completo"]];
summary.getRange("A1").format = {
  fill: "#0F172A",
  font: { bold: true, color: "#FFFFFF", size: 15 },
};
summary.getRange("A3:B10").values = [
  ["Regra de busca", "Valor exatamente igual ao item pendente da Shein, em qualquer crédito do extrato"],
  ["Pendências Shein analisadas", data.summary.pending_shein_count],
  ["Total pendente analisado", money(data.summary.pending_shein_total)],
  ["Créditos bancários pesquisados", data.summary.bank_credit_rows_scanned],
  ["Pendências com candidato por valor", data.summary.matched_pending_unique_count],
  ["Total com candidato", money(data.summary.matched_pending_unique_total)],
  ["Pendências sem candidato", data.summary.unmatched_pending_count],
  ["Total sem candidato", money(data.summary.unmatched_pending_total)],
];
summary.getRange("A3:A10").format = { fill: "#E5E7EB", font: { bold: true } };
summary.getRange("B5:B10").format.numberFormat = "#,##0.00";
summary.getRange("A12:F12").merge();
summary.getRange("A12").values = [["Conclusão: não foram encontrados créditos no extrato completo com valores exatamente iguais às pendências da Shein."]];
summary.getRange("A12").format = { fill: "#FEE2E2", font: { bold: true, color: "#991B1B" }, wrapText: true };
summary.getRange("A1:F12").format.autofitColumns();
summary.getRange("A:A").format.columnWidth = 34;
summary.getRange("B:B").format.columnWidth = 95;

const matchRows = data.matches.map((r) => [
  r["Pedido retirada"],
  r["Grupo retirada"],
  r["Status Shein"],
  r["Situacao Shein"],
  asDate(r["Data Shein"]),
  money(r["Valor Shein"]),
  asDate(r["Data banco"]),
  r["Lancamento banco"],
  r["Documento banco"],
  r["Detalhe banco"],
  money(r["Valor banco"]),
  r["Diferenca dias banco menos Shein"],
  r["Pagina banco"],
]);

addTableSheet(
  wb,
  "Candidatos por valor",
  ["Pedido Shein", "Grupo retirada", "Status Shein", "Situação Shein", "Data Shein", "Valor Shein", "Data banco", "Lançamento banco", "Documento banco", "Detalhe banco", "Valor banco", "Dif. dias", "Página"],
  matchRows,
  {
    fill: "#166534",
    formats: { 4: "yyyy-mm-dd", 5: "#,##0.00", 6: "yyyy-mm-dd", 10: "#,##0.00" },
    widths: { 0: 24, 1: 24, 7: 26, 9: 34 },
  },
);

const pendingRows = data.unmatched_pending.map((r) => [
  r["Número do pedido de retirada"],
  r["Grupo retirada"],
  asDate(r["Tempo de retirada"]),
  asDate(r["Tempo de sucesso"]),
  r["Status Shein"],
  r["Situacao conciliacao"],
  money(r["Valor Shein"]),
]);
addTableSheet(
  wb,
  "Pendencias sem candidato",
  ["Pedido Shein", "Grupo retirada", "Tempo retirada", "Tempo sucesso", "Status Shein", "Situação", "Valor Shein"],
  pendingRows,
  {
    fill: "#92400E",
    formats: { 2: "yyyy-mm-dd hh:mm", 3: "yyyy-mm-dd hh:mm", 6: "#,##0.00" },
    widths: { 0: 24, 1: 24, 4: 22, 5: 26 },
  },
);

const creditRows = data.bank_credits.map((r) => [
  asDate(r.Data),
  r.Documento,
  r.Lancamento,
  r.Detalhe,
  money(r.Valor),
  money(r["Saldo apos"]),
  r["Linha original"],
  r.Pagina,
]);
addTableSheet(
  wb,
  "Creditos pesquisados",
  ["Data", "Documento", "Lançamento", "Detalhe", "Valor", "Saldo após", "Linha original", "Página"],
  creditRows,
  {
    fill: "#374151",
    formats: { 0: "yyyy-mm-dd", 4: "#,##0.00", 5: "#,##0.00" },
    widths: { 2: 26, 3: 36, 6: 42 },
  },
);

const errors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

for (const sheetName of ["Resumo", "Candidatos por valor", "Pendencias sem candidato", "Creditos pesquisados"]) {
  const preview = await wb.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(path.join(outputDir, `${sheetName.replace(/[^A-Za-z0-9]/g, "_")}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(wb);
await output.save(outputXlsx);
console.log(outputXlsx);
