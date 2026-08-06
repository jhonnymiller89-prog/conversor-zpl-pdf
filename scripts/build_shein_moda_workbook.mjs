import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "outputs", "shein_moda_conciliacao");
const inputJson = path.join(outputDir, "reconciliation_data.json");
const outputXlsx = path.join(outputDir, "conciliacao_shein_modal_moda_mundial.xlsx");

const raw = JSON.parse(await fs.readFile(inputJson, "utf8"));

function asDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function sum(rows, field) {
  return fmtMoney(rows.reduce((acc, row) => acc + Number(row[field] || 0), 0));
}

function addSheet(workbook, name, headers, rows, options = {}) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  const matrix = [headers, ...rows];
  sheet.getRangeByIndexes(0, 0, matrix.length, headers.length).values = matrix;
  const used = sheet.getRangeByIndexes(0, 0, matrix.length, headers.length);
  sheet.getRangeByIndexes(0, 0, 1, headers.length).format = {
    fill: options.headerFill || "#1F4E78",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
  };
  used.format.borders = {
    insideHorizontal: { style: "thin", color: "#E5E7EB" },
    bottom: { style: "thin", color: "#D1D5DB" },
  };
  used.format.autofitColumns();
  used.format.autofitRows();
  sheet.freezePanes.freezeRows(1);
  if (rows.length > 0) {
    sheet.tables.add(sheet.getRangeByIndexes(0, 0, matrix.length, headers.length), true, `${name.replace(/[^A-Za-z0-9]/g, "")}Table`);
  }
  for (const [colIndex, format] of Object.entries(options.numberFormats || {})) {
    sheet.getRangeByIndexes(1, Number(colIndex), Math.max(rows.length, 1), 1).format.numberFormat = format;
  }
  for (const [colIndex, width] of Object.entries(options.widths || {})) {
    sheet.getRangeByIndexes(0, Number(colIndex), Math.max(matrix.length, 1), 1).format.columnWidth = width;
  }
  return sheet;
}

const reconciledRows = raw.reconciled.map((row) => [
  row["Grupo retirada"],
  row["Número do pedido de retirada"],
  asDate(row["Tempo de retirada"]),
  asDate(row["Tempo de sucesso"]),
  row["Status Shein"],
  fmtMoney(row["Valor Shein"]),
  asDate(row["Data banco"]),
  row["Documento banco"],
  fmtMoney(row["Credito banco"]),
  fmtMoney(row["Diferenca"]),
  row["Dias entre retirada e banco"],
  row["Situacao conciliacao"],
]);

const sheinPendingRows = raw.shein_pending.map((row) => [
  row["Grupo retirada"],
  row["Número do pedido de retirada"],
  asDate(row["Tempo de retirada"]),
  asDate(row["Tempo de sucesso"]),
  row["Status Shein"],
  fmtMoney(row["Valor Shein"]),
  fmtMoney(row["Valor total do grupo"]),
  row["Situacao conciliacao"],
]);

const bankUnmatchedRows = raw.bank_unmatched.map((row) => [
  asDate(row["Data_dt"]),
  row["Documento"],
  row["Lancamento"],
  row["Remetente"],
  fmtMoney(row["Credito"]),
  fmtMoney(row["Saldo apos lancamento"]),
  row["Situacao conciliacao"],
]);

const groupRows = raw.shein_groups.map((row) => [
  row["Grupo retirada"],
  asDate(row["Tempo de retirada"]),
  row["Status"],
  row["Itens"],
  row["Itens bem-sucedidos"],
  row["Itens pendentes"],
  fmtMoney(row["Valor total"]),
  fmtMoney(row["Valor bem-sucedido"]),
  fmtMoney(row["Valor pendente"]),
  asDate(row["Primeiro sucesso"]),
  asDate(row["Ultimo sucesso"]),
]);

const sheinRawRows = raw.shein_rows.map((row) => [
  row["Grupo retirada"],
  row["Número do pedido de retirada"],
  asDate(row["Tempo de retirada_dt"]),
  asDate(row["Tempo de sucesso_dt"]),
  row["Status de retirada"],
  fmtMoney(row["Valor recebido"]),
  fmtMoney(row["valor líquido"]),
  fmtMoney(row["taxa de manuseio"]),
  row["Recebendo moeda"],
  row["Contas a receber"],
]);

const bankRows = raw.bank_rows.map((row) => [
  asDate(row["Data_dt"]),
  row["Documento"],
  row["Lancamento"],
  row["Remetente"],
  fmtMoney(row["Credito"]),
  fmtMoney(row["Debito"]),
  fmtMoney(row["Saldo apos lancamento"]),
  row["Linha original"],
]);

const workbook = Workbook.create();

const summary = workbook.worksheets.add("Resumo");
summary.showGridLines = false;
summary.getRange("A1:H1").merge();
summary.getRange("A1").values = [["Conciliação Shein/Modal x MODA MUNDIAL BRASIL"]];
summary.getRange("A1").format = {
  fill: "#0F172A",
  font: { bold: true, color: "#FFFFFF", size: 15 },
};

const matchedTotal = sum(raw.reconciled, "Credito banco");
const bankTotal = sum(raw.bank_rows, "Credito");
const bankOpenTotal = sum(raw.bank_unmatched, "Credito");
const sheinSuccessTotal = sum(raw.shein_rows.filter((r) => r["Status de retirada"] === "Retirada bem -sucedida"), "Valor recebido");
const sheinSuccessOpenTotal = sum(
  raw.shein_pending.filter((r) => r["Situacao conciliacao"] === "Nao localizado no banco"),
  "Valor Shein",
);
const sheinStillPendingTotal = sum(
  raw.shein_pending.filter((r) => r["Situacao conciliacao"] === "Ainda pendente na Shein"),
  "Valor Shein",
);

const summaryRows = [
  ["Critério", "Conciliação por valor exato do item de retirada Shein contra crédito bancário MODA MUNDIAL BRASIL"],
  ["Itens conciliados", raw.reconciled.length],
  ["Total conciliado", matchedTotal],
  ["Créditos MODA no extrato", raw.bank_rows.length],
  ["Total créditos MODA no extrato", bankTotal],
  ["Créditos bancários sem linha Shein", raw.bank_unmatched.length],
  ["Total bancário sem linha Shein", bankOpenTotal],
  ["Itens Shein bem-sucedidos no relatório", raw.shein_rows.filter((r) => r["Status de retirada"] === "Retirada bem -sucedida").length],
  ["Total Shein bem-sucedido", sheinSuccessTotal],
  ["Itens Shein bem-sucedidos sem crédito no extrato", raw.shein_pending.filter((r) => r["Situacao conciliacao"] === "Nao localizado no banco").length],
  ["Total Shein bem-sucedido sem crédito no extrato", sheinSuccessOpenTotal],
  ["Itens ainda pendentes na Shein", raw.shein_pending.filter((r) => r["Situacao conciliacao"] === "Ainda pendente na Shein").length],
  ["Total ainda pendente na Shein", sheinStillPendingTotal],
];
summary.getRangeByIndexes(2, 0, summaryRows.length, 2).values = summaryRows;
summary.getRange("A3:A15").format = { font: { bold: true }, fill: "#E5E7EB" };
summary.getRange("B5:B15").format.numberFormat = "#,##0.00";
summary.getRange("A18:H18").merge();
summary.getRange("A18").values = [["Observação: os créditos de R$ 113,36 e R$ 91,95 aparecem no banco em 11/05/2026, mas não há linhas equivalentes no relatório Shein recebido."]];
summary.getRange("A18").format = { fill: "#FEF3C7", font: { color: "#92400E" }, wrapText: true };
summary.getRange("A1:H18").format.autofitColumns();
summary.getRange("A1:H18").format.autofitRows();
summary.getRange("A:A").format.columnWidth = 42;
summary.getRange("B:B").format.columnWidth = 92;

addSheet(
  workbook,
  "Conciliados",
  [
    "Grupo retirada",
    "Pedido retirada",
    "Tempo retirada",
    "Tempo sucesso",
    "Status Shein",
    "Valor Shein",
    "Data banco",
    "Documento banco",
    "Crédito banco",
    "Diferença",
    "Dias",
    "Situação",
  ],
  reconciledRows,
  {
    headerFill: "#166534",
    numberFormats: { 2: "yyyy-mm-dd hh:mm", 3: "yyyy-mm-dd hh:mm", 5: "#,##0.00", 6: "yyyy-mm-dd", 8: "#,##0.00", 9: "#,##0.00" },
    widths: { 0: 24, 1: 24, 4: 22, 11: 16 },
  },
);

addSheet(
  workbook,
  "Pendencias Shein",
  ["Grupo retirada", "Pedido retirada", "Tempo retirada", "Tempo sucesso", "Status Shein", "Valor Shein", "Valor total grupo", "Situação"],
  sheinPendingRows,
  {
    headerFill: "#92400E",
    numberFormats: { 2: "yyyy-mm-dd hh:mm", 3: "yyyy-mm-dd hh:mm", 5: "#,##0.00", 6: "#,##0.00" },
    widths: { 0: 24, 1: 24, 4: 22, 7: 26 },
  },
);

addSheet(
  workbook,
  "Banco sem Shein",
  ["Data banco", "Documento", "Lançamento", "Remetente", "Crédito banco", "Saldo após", "Situação"],
  bankUnmatchedRows,
  {
    headerFill: "#991B1B",
    numberFormats: { 0: "yyyy-mm-dd", 4: "#,##0.00", 5: "#,##0.00" },
    widths: { 2: 24, 3: 28, 6: 24 },
  },
);

addSheet(
  workbook,
  "Shein por retirada",
  [
    "Grupo retirada",
    "Tempo retirada",
    "Status",
    "Itens",
    "Itens bem-sucedidos",
    "Itens pendentes",
    "Valor total",
    "Valor bem-sucedido",
    "Valor pendente",
    "Primeiro sucesso",
    "Último sucesso",
  ],
  groupRows,
  {
    headerFill: "#1D4ED8",
    numberFormats: { 1: "yyyy-mm-dd hh:mm", 6: "#,##0.00", 7: "#,##0.00", 8: "#,##0.00", 9: "yyyy-mm-dd hh:mm", 10: "yyyy-mm-dd hh:mm" },
    widths: { 0: 24, 2: 34 },
  },
);

addSheet(
  workbook,
  "Relatorio Shein",
  ["Grupo retirada", "Pedido retirada", "Tempo retirada", "Tempo sucesso", "Status", "Valor recebido", "Valor líquido", "Taxa", "Moeda", "Conta"],
  sheinRawRows,
  {
    headerFill: "#374151",
    numberFormats: { 2: "yyyy-mm-dd hh:mm", 3: "yyyy-mm-dd hh:mm", 5: "#,##0.00", 6: "#,##0.00", 7: "#,##0.00" },
    widths: { 0: 24, 1: 24, 4: 22 },
  },
);

addSheet(
  workbook,
  "Extrato MODA",
  ["Data", "Documento", "Lançamento", "Remetente", "Crédito", "Débito", "Saldo após", "Linha original"],
  bankRows,
  {
    headerFill: "#4B5563",
    numberFormats: { 0: "yyyy-mm-dd", 4: "#,##0.00", 5: "#,##0.00", 6: "#,##0.00" },
    widths: { 2: 24, 3: 28, 7: 34 },
  },
);

const errorScan = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "formula error scan",
});
console.log(errorScan.ndjson);

for (const sheetName of ["Resumo", "Conciliados", "Pendencias Shein", "Banco sem Shein", "Shein por retirada", "Relatorio Shein", "Extrato MODA"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(path.join(outputDir, `${sheetName.replace(/[^A-Za-z0-9]/g, "_")}.png`), new Uint8Array(await preview.arrayBuffer()));
}

await fs.mkdir(outputDir, { recursive: true });
const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputXlsx);
console.log(outputXlsx);
