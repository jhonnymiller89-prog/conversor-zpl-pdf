import AdmZip from "adm-zip";
import cors from "cors";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, "../../client/dist");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1
  }
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "127.0.0.1";
const LABEL_WIDTH_CM = 10;
const LABEL_HEIGHT_CM = 15;
const CM_TO_POINTS = 28.3464567;
const PDF_WIDTH = LABEL_WIDTH_CM * CM_TO_POINTS;
const PDF_HEIGHT = LABEL_HEIGHT_CM * CM_TO_POINTS;
const LABELARY_SIZE_INCHES = "3.94x5.91";
const LABELARY_URL = `https://api.labelary.com/v1/printers/8dpmm/labels/${LABELARY_SIZE_INCHES}/0/`;

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/convert", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Envie um arquivo .zpl, .txt ou .zip." });
    }

    const sources = extractSources(req.file);
    const labels = sources.flatMap((source) =>
      extractPrintableLabels(source.content).map((zpl, index) => ({
        zpl,
        sourceName: source.name,
        index: index + 1
      }))
    );

    if (labels.length === 0) {
      return res.status(400).json({
        error: "Nenhuma etiqueta ZPL válida foi encontrada. Verifique se o conteúdo possui ^XA e ^XZ."
      });
    }

    const pdf = await PDFDocument.create();

    for (const label of labels) {
      const pngBytes = await renderZplToPng(label.zpl);
      const image = await pdf.embedPng(pngBytes);
      const page = pdf.addPage([PDF_WIDTH, PDF_HEIGHT]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: PDF_WIDTH,
        height: PDF_HEIGHT
      });
    }

    const pdfBytes = await pdf.save();
    const safeBaseName = req.file.originalname.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeBaseName || "etiquetas"}-10x15.pdf"`);
    res.setHeader("X-Label-Count", String(labels.length));
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error(error);
    const message =
      error?.publicMessage ||
      "Não foi possível converter o arquivo agora. Confira o ZPL ou tente novamente em instantes.";
    res.status(error?.statusCode || 500).json({ error: message });
  }
});

app.use(express.static(clientDistPath));

app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

function extractSources(file) {
  const originalName = file.originalname || "arquivo";
  const extension = originalName.toLowerCase().split(".").pop();

  if (extension === "zip") {
    const zip = new AdmZip(file.buffer);
    return zip
      .getEntries()
      .filter((entry) => !entry.isDirectory)
      .filter((entry) => /\.(zpl|txt)$/i.test(entry.entryName))
      .map((entry) => ({
        name: entry.entryName,
        content: entry.getData().toString("utf8")
      }));
  }

  if (!["zpl", "txt"].includes(extension)) {
    const error = new Error("Formato não aceito. Use arquivos .zpl, .txt ou .zip.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  return [{ name: originalName, content: file.buffer.toString("utf8") }];
}

function extractPrintableLabels(content) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLabelIndex = normalized.search(/\^XA/i);
  const resourcePrefix = firstLabelIndex > 0 ? normalized.slice(0, firstLabelIndex).trim() : "";
  const matches = normalized.match(/\^XA[\s\S]*?\^XZ/gim) || [];

  return matches
    .map((label) => label.trim())
    .filter(isPrintableLabel)
    .map((label) => {
      if (!resourcePrefix) return label;
      return `${resourcePrefix}\n${label}`;
    });
}

function isPrintableLabel(label) {
  const withoutWhitespace = label.replace(/\s+/g, "");
  const deletesResource = /\^ID/i.test(withoutWhitespace);
  const hasPrintableCommand = /\^(FO|FT|GB|GC|GD|GE|A[A-Z0-9]?|B[A-Z0-9]|XG|GF|FD)/i.test(
    withoutWhitespace
  );

  return hasPrintableCommand && !deletesResource;
}

async function renderZplToPng(zpl) {
  const response = await fetch(LABELARY_URL, {
    method: "POST",
    headers: {
      Accept: "image/png",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: zpl
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const error = new Error(details || "Falha ao renderizar etiqueta ZPL.");
    error.statusCode = 422;
    error.publicMessage =
      "O renderizador não conseguiu interpretar uma das etiquetas. Verifique o ZPL e tente novamente.";
    throw error;
  }

  return new Uint8Array(await response.arrayBuffer());
}

app.listen(PORT, HOST, () => {
  console.log(`Servidor ZPL ativo em http://${HOST}:${PORT}`);
});
