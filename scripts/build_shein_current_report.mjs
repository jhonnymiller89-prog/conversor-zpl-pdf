import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "outputs", "conciliacao_shein_20260728");
const inputJson = path.join(outputDir, "conciliacao_shein_20260728.json");
const outputXlsx = path.join(outputDir, "relatorio_conciliacao_shein_20260728.xlsx");

const data = JSON.parse(await fs.readFile(inputJson, "utf8"));

function asDate(value) {
  if (!value) return null;
  const d = new Date(value);
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
  if (rows.length > 0) {
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

const reconciledRows = data.reconciled.map((r) => [
  r["Pedido retirada"],
  r["Grupo retirada"],
  asDate(r["Tempo retirada"]),
  asDate(r["Tempo sucesso"]),
  money(r["Valor Shein"]),
  asDate(r["Data banco"]),
  r["Lancamento banco"],
  r["Documento banco"],
  r["Detalhe banco"],
  money(r["Credito banco"]),
  money(r["Diferenca"]),
  r["Dias entre datas"],
  r["Situacao"],
]);

const pendingRows = data.pending.map((r) => [
  r["Pedido retirada"],
  r["Grupo retirada"],
  asDate(r["Tempo retirada"]),
  asDate(r["Tempo sucesso"]),
  r["Status Shein"],
  money(r["Valor Shein"]),
  r["Situacao"],
]);

const bankUnmatchedRows = data.bank_unmatched.map((r) => [
  asDate(r["Data_dt"]),
  r["Documento"],
  r["Lancamento"],
  r["Detalhe"],
  money(r["Credito"]),
  money(r["Saldo apos"]),
  r["Situacao"],
  r["Linha original"],
]);

const sheinRows = data.shein_rows.map((r) => [
  r["Número do pedido de retirada"],
  r["Grupo retirada"],
  asDate(r["Tempo de retirada_dt"]),
  asDate(r["Tempo de sucesso_dt"]),
  r["Status de retirada"],
  money(r["Valor recebido"]),
  money(r["valor líquido"]),
  money(r["taxa de manuseio"]),
  r["Recebendo moeda"],
]);

const bankRows = data.bank_credits.map((r) => [
  asDate(r["Data_dt"]),
  r["Documento"],
  r["Lancamento"],
  r["Detalhe"],
  money(r["Credito"]),
  money(r["Saldo apos"]),
  r["Linha original"],
]);

const summary = wb.worksheets.add("Resumo");
summary.showGridLines = false;
summary.getRange("A1:F1").merge();
summary.getRange("A1").values = [["Relatorio de Conciliacao Shein x Bradesco - 28/07/2026"]];
summary.getRange("A1").format = { fill: "#0F172A", font: { bold: true, color: "#FFFFFF", size: 15 } };
summary.getRange("A3:B10").values = [
  ["Criterio", "Conciliacao por valor exato entre item de retirada Shein e credito bancario"],
  ["Itens Shein no relatorio", null],
  ["Total Shein no relatorio", null],
  ["Itens recebidos/conciliados", null],
  ["Total recebido/conciliado", null],
  ["Itens a receber", null],
  ["Total a receber", null],
  ["Creditos bancarios analisados", null],
];
summary.getRange("B4").formulas = [["=COUNTA('Relatorio Shein'!A2:A6)"]];
summary.getRange("B5").formulas = [["=SUM('Relatorio Shein'!F2:F6)"]];
summary.getRange("B6").formulas = [["=COUNTA(Conciliados!A2:A2)"]];
summary.getRange("B7").formulas = [["=SUM(Conciliados!E2:E2)"]];
summary.getRange("B8").formulas = [["=COUNTA('A receber'!A2:A5)"]];
summary.getRange("B9").formulas = [["=SUM('A receber'!F2:F5)"]];
summary.getRange("B10").formulas = [["=COUNTA('Creditos bancarios'!A2:A10)"]];
summary.getRange("A3:A10").format = { fill: "#E5E7EB", font: { bold: true } };
summary.getRange("B5:B9").format.numberFormat = "#,##0.00";
summary.getRange("A12:F12").merge();
summary.getRange("A12").values = [["Conclusao: foi localizado 1 recebimento da Shein no extrato, no valor de R$ 5.072,99. Permanecem 4 itens a receber, somando R$ 2.915,82."]];
summary.getRange("A12").format = { fill: "#FEF3C7", font: { bold: true, color: "#92400E" }, wrapText: true };
summary.getRange("A1:F12").format.autofitColumns();
summary.getRange("A:A").format.columnWidth = 32;
summary.getRange("B:B").format.columnWidth = 90;

addTableSheet(
  wb,
  "Conciliados",
  ["Pedido Shein", "Grupo retirada", "Tempo retirada", "Tempo sucesso", "Valor Shein", "Data banco", "Lancamento banco", "Documento banco", "Detalhe banco", "Credito banco", "Diferenca", "Dias", "Situacao"],
  reconciledRows,
  {
    fill: "#166534",
    formats: { 2: "yyyy-mm-dd hh:mm", 3: "yyyy-mm-dd hh:mm", 4: "#,##0.00", 5: "yyyy-mm-dd", 9: "#,##0.00", 10: "#,##0.00" },
    widths: { 0: 24, 1: 24, 6: 26, 8: 34, 12: 26 },
  },
);

addTableSheet(
  wb,
  "A receber",
  ["Pedido Shein", "Grupo retirada", "Tempo retirada", "Tempo sucesso", "Status Shein", "Valor Shein", "Situacao"],
  pendingRows,
  {
    fill: "#92400E",
    formats: { 2: "yyyy-mm-dd hh:mm", 3: "yyyy-mm-dd hh:mm", 5: "#,##0.00" },
    widths: { 0: 24, 1: 24, 4: 22, 6: 32 },
  },
);

addTableSheet(
  wb,
  "Creditos sem Shein",
  ["Data banco", "Documento", "Lancamento", "Detalhe", "Credito", "Saldo apos", "Situacao", "Linha original"],
  bankUnmatchedRows,
  {
    fill: "#991B1B",
    formats: { 0: "yyyy-mm-dd", 4: "#,##0.00", 5: "#,##0.00" },
    widths: { 2: 26, 3: 34, 6: 36, 7: 42 },
  },
);

addTableSheet(
  wb,
  "Relatorio Shein",
  ["Pedido Shein", "Grupo retirada", "Tempo retirada", "Tempo sucesso", "Status", "Valor recebido", "Valor liquido", "Taxa", "Moeda"],
  sheinRows,
  {
    fill: "#1D4ED8",
    formats: { 2: "yyyy-mm-dd hh:mm", 3: "yyyy-mm-dd hh:mm", 5: "#,##0.00", 6: "#,##0.00", 7: "#,##0.00" },
    widths: { 0: 24, 1: 24, 4: 22 },
  },
);

addTableSheet(
  wb,
  "Creditos bancarios",
  ["Data", "Documento", "Lancamento", "Detalhe", "Credito", "Saldo apos", "Linha original"],
  bankRows,
  {
    fill: "#374151",
    formats: { 0: "yyyy-mm-dd", 4: "#,##0.00", 5: "#,##0.00" },
    widths: { 2: 26, 3: 34, 6: 42 },
  },
);

const errors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

for (const sheetName of ["Resumo", "Conciliados", "A receber", "Creditos sem Shein", "Relatorio Shein", "Creditos bancarios"]) {
  const preview = await wb.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(path.join(outputDir, `${sheetName.replace(/[^A-Za-z0-9]/g, "_")}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(wb);
await output.save(outputXlsx);
console.log(outputXlsx);
