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
    files: 20
  }
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "127.0.0.1";
const CM_TO_POINTS = 28.3464567;
const LABEL_PRESETS = {
  "10x15": { label: "10 x 15 cm", widthCm: 10, heightCm: 15, labelarySize: "3.94x5.91" },
  "10x10": { label: "10 x 10 cm", widthCm: 10, heightCm: 10, labelarySize: "3.94x3.94" },
  "10x7": { label: "10 x 7 cm", widthCm: 10, heightCm: 7, labelarySize: "3.94x2.76" },
  "10x5": { label: "10 x 5 cm", widthCm: 10, heightCm: 5, labelarySize: "3.94x1.97" }
};
const ALLOWED_DENSITIES = new Set(["6", "8", "12", "24"]);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/convert", upload.array("files", 20), async (req, res) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ error: "Envie ao menos um arquivo .zpl, .txt ou .zip." });
    }

    const settings = getConversionSettings(req.body);
    const sources = req.files.flatMap(extractSources);
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
      const pngBytes = await renderZplToPng(label.zpl, settings);
      const image = await pdf.embedPng(pngBytes);
      const page = pdf.addPage([settings.pdfWidth, settings.pdfHeight]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: settings.pdfWidth,
        height: settings.pdfHeight
      });
    }

    const pdfBytes = await pdf.save();
    const baseName =
      req.files.length === 1 ? req.files[0].originalname.replace(/\.[^.]+$/, "") : "etiquetas-convertidas";
    const safeBaseName = baseName.replace(/[^\w.-]+/g, "-");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeBaseName || "etiquetas"}-${settings.pageSize}.pdf"`
    );
    res.setHeader("X-Label-Count", String(labels.length));
    res.setHeader("X-Source-Count", String(sources.length));
    res.setHeader("X-Page-Size", settings.preset.label);
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

function getConversionSettings(body) {
  const pageSize = LABEL_PRESETS[body?.pageSize] ? body.pageSize : "10x15";
  const density = ALLOWED_DENSITIES.has(String(body?.density)) ? String(body.density) : "8";
  const preset = LABEL_PRESETS[pageSize];

  return {
    pageSize,
    density,
    preset,
    pdfWidth: preset.widthCm * CM_TO_POINTS,
    pdfHeight: preset.heightCm * CM_TO_POINTS,
    labelaryUrl: `https://api.labelary.com/v1/printers/${density}dpmm/labels/${preset.labelarySize}/0/`
  };
}

async function renderZplToPng(zpl, settings) {
  const response = await fetch(settings.labelaryUrl, {
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
