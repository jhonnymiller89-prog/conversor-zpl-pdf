import AdmZip from "adm-zip";
import cors from "cors";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, degrees } from "pdf-lib";

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
const MM_TO_POINTS = 2.83464567;
const MAX_PREVIEW_LABELS = 12;
const LABEL_PRESETS = {
  "10x15": { label: "10 x 15 cm", widthCm: 10, heightCm: 15, labelarySize: "3.94x5.91" },
  "10x10": { label: "10 x 10 cm", widthCm: 10, heightCm: 10, labelarySize: "3.94x3.94" },
  "10x7": { label: "10 x 7 cm", widthCm: 10, heightCm: 7, labelarySize: "3.94x2.76" },
  "10x5": { label: "10 x 5 cm", widthCm: 10, heightCm: 5, labelarySize: "3.94x1.97" }
};
const ALLOWED_DENSITIES = new Set(["6", "8", "12", "24"]);
const ALLOWED_ROTATIONS = new Set(["0", "90", "180", "270"]);
const ALLOWED_SCALE_MODES = new Set(["fit", "fill", "original"]);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/analyze", upload.array("files", 20), async (req, res) => {
  try {
    const payload = buildLabelPayload(req);
    res.json(toAnalysis(payload));
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/preview", upload.array("files", 20), async (req, res) => {
  try {
    const settings = getConversionSettings(req.body);
    const payload = buildLabelPayload(req);
    const labelsToPreview = payload.labels.slice(0, MAX_PREVIEW_LABELS);
    const previews = [];

    for (const label of labelsToPreview) {
      const pngBytes = await renderZplToPng(label.zpl, settings);
      previews.push({
        sourceName: label.sourceName,
        index: label.index,
        image: `data:image/png;base64,${Buffer.from(pngBytes).toString("base64")}`
      });
    }

    res.json({
      ...toAnalysis(payload),
      previewLimit: MAX_PREVIEW_LABELS,
      previews
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/convert", upload.array("files", 20), async (req, res) => {
  try {
    const settings = getConversionSettings(req.body);
    const payload = buildLabelPayload(req);
    const pdf = await PDFDocument.create();

    for (const label of payload.labels) {
      const pngBytes = await renderZplToPng(label.zpl, settings);
      const image = await pdf.embedPng(pngBytes);
      const page = pdf.addPage([settings.pdfWidth, settings.pdfHeight]);
      drawLabelImage(page, image, settings);
    }

    const pdfBytes = await pdf.save();
    const safeBaseName = payload.baseName.replace(/[^\w.-]+/g, "-");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeBaseName || "etiquetas"}-${settings.pageSize}.pdf"`
    );
    res.setHeader("X-Label-Count", String(payload.labels.length));
    res.setHeader("X-Source-Count", String(payload.sources.length));
    res.setHeader("X-Page-Size", settings.preset.label);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    sendError(res, error);
  }
});

app.use(express.static(clientDistPath));

app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

function buildLabelPayload(req) {
  const sources = [
    ...(req.files || []).flatMap(extractSources),
    ...extractRawZplSources(req.body?.rawZpl)
  ];

  if (!sources.length) {
    const error = new Error("Envie arquivos ou cole um código ZPL para continuar.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  const labels = sources.flatMap((source) =>
    extractPrintableLabels(source.content).map((zpl, index) => ({
      zpl,
      sourceName: source.name,
      index: index + 1
    }))
  );

  if (labels.length === 0) {
    const error = new Error("Nenhuma etiqueta ZPL válida foi encontrada.");
    error.statusCode = 400;
    error.publicMessage = "Nenhuma etiqueta ZPL válida foi encontrada. Verifique se o conteúdo possui ^XA e ^XZ.";
    throw error;
  }

  const baseName =
    sources.length === 1 && sources[0].name !== "ZPL colado"
      ? sources[0].name.replace(/\.[^.]+$/, "")
      : "etiquetas-convertidas";

  return {
    baseName,
    labels,
    sources,
    warnings: buildWarnings(sources, labels)
  };
}

function toAnalysis(payload) {
  return {
    labelsCount: payload.labels.length,
    sourcesCount: payload.sources.length,
    sources: payload.sources.map((source) => ({
      name: source.name,
      labelsCount: source.labelsCount,
      size: source.content.length
    })),
    warnings: payload.warnings
  };
}

function extractRawZplSources(rawZpl) {
  if (!rawZpl || !String(rawZpl).trim()) return [];

  return [
    {
      name: "ZPL colado",
      content: String(rawZpl),
      labelsCount: countLabelBlocks(String(rawZpl))
    }
  ];
}

function extractSources(file) {
  const originalName = file.originalname || "arquivo";
  const extension = originalName.toLowerCase().split(".").pop();

  if (extension === "zip") {
    const zip = new AdmZip(file.buffer);
    return zip
      .getEntries()
      .filter((entry) => !entry.isDirectory)
      .filter((entry) => /\.(zpl|txt)$/i.test(entry.entryName))
      .map((entry) => {
        const content = entry.getData().toString("utf8");
        return {
          name: entry.entryName,
          content,
          labelsCount: countLabelBlocks(content)
        };
      });
  }

  if (!["zpl", "txt"].includes(extension)) {
    const error = new Error("Formato não aceito. Use arquivos .zpl, .txt ou .zip.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  const content = file.buffer.toString("utf8");
  return [
    {
      name: originalName,
      content,
      labelsCount: countLabelBlocks(content)
    }
  ];
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

function countLabelBlocks(content) {
  return (content.match(/\^XA[\s\S]*?\^XZ/gim) || []).length;
}

function isPrintableLabel(label) {
  const withoutWhitespace = label.replace(/\s+/g, "");
  const deletesResource = /\^ID/i.test(withoutWhitespace);
  const hasPrintableCommand = /\^(FO|FT|GB|GC|GD|GE|A[A-Z0-9]?|B[A-Z0-9]|XG|GF|FD)/i.test(
    withoutWhitespace
  );

  return hasPrintableCommand && !deletesResource;
}

function buildWarnings(sources, labels) {
  const warnings = [];
  const emptySources = sources.filter((source) => source.labelsCount === 0);

  if (emptySources.length) {
    warnings.push(`${emptySources.length} origem(ns) não tinham blocos ^XA/^XZ.`);
  }

  if (labels.length > 100) {
    warnings.push("Arquivos com muitas etiquetas podem demorar mais para converter.");
  }

  return warnings;
}

function getConversionSettings(body) {
  const pageSize = LABEL_PRESETS[body?.pageSize] ? body.pageSize : "10x15";
  const density = ALLOWED_DENSITIES.has(String(body?.density)) ? String(body.density) : "8";
  const rotation = ALLOWED_ROTATIONS.has(String(body?.rotation)) ? Number(body.rotation) : 0;
  const scaleMode = ALLOWED_SCALE_MODES.has(String(body?.scaleMode)) ? body.scaleMode : "fit";
  const marginMm = clampNumber(Number(body?.marginMm ?? 0), 0, 20);
  const preset = LABEL_PRESETS[pageSize];

  return {
    pageSize,
    density,
    rotation,
    scaleMode,
    marginPoints: marginMm * MM_TO_POINTS,
    preset,
    pdfWidth: preset.widthCm * CM_TO_POINTS,
    pdfHeight: preset.heightCm * CM_TO_POINTS,
    labelaryUrl: `https://api.labelary.com/v1/printers/${density}dpmm/labels/${preset.labelarySize}/0/`
  };
}

function drawLabelImage(page, image, settings) {
  const pageWidth = settings.pdfWidth;
  const pageHeight = settings.pdfHeight;
  const margin = settings.marginPoints;
  const contentWidth = Math.max(pageWidth - margin * 2, 1);
  const contentHeight = Math.max(pageHeight - margin * 2, 1);
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const rotated = settings.rotation === 90 || settings.rotation === 270;
  const imageBoxWidth = rotated ? sourceHeight : sourceWidth;
  const imageBoxHeight = rotated ? sourceWidth : sourceHeight;
  const fitScale = Math.min(contentWidth / imageBoxWidth, contentHeight / imageBoxHeight);
  const fillScale = Math.max(contentWidth / imageBoxWidth, contentHeight / imageBoxHeight);
  const scale =
    settings.scaleMode === "original" ? fitScale : settings.scaleMode === "fill" ? fillScale : fitScale;
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const boxWidth = imageBoxWidth * scale;
  const boxHeight = imageBoxHeight * scale;
  const left = margin + (contentWidth - boxWidth) / 2;
  const bottom = margin + (contentHeight - boxHeight) / 2;

  if (settings.rotation === 90) {
    page.drawImage(image, {
      x: left + boxWidth,
      y: bottom,
      width: drawWidth,
      height: drawHeight,
      rotate: degrees(90)
    });
    return;
  }

  if (settings.rotation === 180) {
    page.drawImage(image, {
      x: left + boxWidth,
      y: bottom + boxHeight,
      width: drawWidth,
      height: drawHeight,
      rotate: degrees(180)
    });
    return;
  }

  if (settings.rotation === 270) {
    page.drawImage(image, {
      x: left,
      y: bottom + boxHeight,
      width: drawWidth,
      height: drawHeight,
      rotate: degrees(270)
    });
    return;
  }

  page.drawImage(image, {
    x: left,
    y: bottom,
    width: drawWidth,
    height: drawHeight
  });
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
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

function sendError(res, error) {
  console.error(error);
  const message =
    error?.publicMessage ||
    "Não foi possível converter o arquivo agora. Confira o ZPL ou tente novamente em instantes.";
  res.status(error?.statusCode || 500).json({ error: message });
}

app.listen(PORT, HOST, () => {
  console.log(`Servidor ZPL ativo em http://${HOST}:${PORT}`);
});
