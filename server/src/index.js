import AdmZip from "adm-zip";
import cors from "cors";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PDFDocument,
  StandardFonts,
  clip,
  degrees,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb
} from "pdf-lib";

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
const MAX_PREVIEW_LABELS = 200;
const LABELARY_MIN_INTERVAL_MS = 450;
const LABELARY_MAX_ATTEMPTS = 4;
const LABEL_PRESETS = {
  "10x15": { label: "10 x 15 cm", widthCm: 10, heightCm: 15, labelarySize: "3.94x5.91" },
  "10x10": { label: "10 x 10 cm", widthCm: 10, heightCm: 10, labelarySize: "3.94x3.94" },
  "10x7": { label: "10 x 7 cm", widthCm: 10, heightCm: 7, labelarySize: "3.94x2.76" },
  "10x5": { label: "10 x 5 cm", widthCm: 10, heightCm: 5, labelarySize: "3.94x1.97" }
};
const ALLOWED_DENSITIES = new Set(["6", "8", "12", "24"]);
const ALLOWED_ROTATIONS = new Set(["0", "90", "180", "270"]);
const ALLOWED_SCALE_MODES = new Set(["fit", "fill", "original"]);
const PRODUCT_FONT_SIZES = {
  auto: { label: "Automático", min: 6, max: 9 },
  small: { label: "Pequeno", min: 6, max: 7 },
  medium: { label: "Médio", min: 7, max: 9 },
  large: { label: "Grande", min: 8, max: 11 }
};
const DEFAULT_TEMPLATE = {
  id: "jm-cosmeticos",
  name: "JM Cosméticos",
  protectedArea: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
  footer: {
    enabled: true,
    heightMm: 30,
    gapMm: 0,
    paddingMm: 3,
    showSku: true,
    showTotalItems: true,
    showQuantity: true,
    showMarker: true,
    marker: "✓",
    fontSize: "auto",
    lineSpacing: 1.08,
    align: "left",
    textColor: "#111827"
  }
};
let lastLabelaryRequestAt = 0;
let ocrWorkerPromise = null;

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

    for (let globalIndex = 0; globalIndex < labelsToPreview.length; globalIndex += 1) {
      const label = labelsToPreview[globalIndex];
      const pngBytes = await renderZplToPng(label.zpl, settings);
      const footerPngBytes = label.productFooterZpl ? await renderZplToPng(label.productFooterZpl, settings) : null;
      const imageProductFooter = footerPngBytes ? await extractProductsFromChecklistImage(footerPngBytes) : null;
      const previewFooterPngBytes =
        footerPngBytes && !imageProductFooter?.lines?.length ? await prepareChecklistFooterImage(footerPngBytes) : null;

      previews.push({
        globalIndex,
        sourceName: label.sourceName,
        index: label.index,
        productFooter: imageProductFooter || label.productFooter,
        productFooterImage: previewFooterPngBytes
          ? `data:image/png;base64,${Buffer.from(previewFooterPngBytes).toString("base64")}`
          : null,
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
      await drawLabelPage(pdf, page, image, settings, label);
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

app.post("/api/convert-label", upload.array("files", 20), async (req, res) => {
  try {
    const settings = getConversionSettings(req.body);
    const payload = buildLabelPayload(req);
    const labelIndex = Math.floor(clampNumber(Number(req.body?.labelIndex ?? 0), 0, payload.labels.length - 1));
    const label = payload.labels[labelIndex];
    const pdf = await PDFDocument.create();
    const pngBytes = await renderZplToPng(label.zpl, settings);
    const image = await pdf.embedPng(pngBytes);
    const page = pdf.addPage([settings.pdfWidth, settings.pdfHeight]);
    await drawLabelPage(pdf, page, image, settings, label);

    const pdfBytes = await pdf.save();
    const safeBaseName = payload.baseName.replace(/[^\w.-]+/g, "-");
    const labelNumber = labelIndex + 1;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeBaseName || "etiqueta"}-${settings.pageSize}-etiqueta-${labelNumber}.pdf"`
    );
    res.setHeader("X-Label-Count", "1");
    res.setHeader("X-Source-Count", "1");
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

  const labels = sources.flatMap((source) => normalizeSourceLabels(source));

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
  const matches = [...normalized.matchAll(/\^XA[\s\S]*?\^XZ/gim)];
  const labels = [];
  let previousEnd = 0;

  for (const match of matches) {
    const label = match[0].trim();
    const localPrefix = normalized.slice(previousEnd, match.index).trim();
    previousEnd = match.index + match[0].length;

    if (!isPrintableLabel(label)) continue;

    labels.push({
      zpl: localPrefix ? `${localPrefix}\n${label}` : label,
      productFooter: extractProductFooter(localPrefix, label)
    });
  }

  return labels;
}

function normalizeSourceLabels(source) {
  const entries = extractPrintableLabels(source.content);
  const shouldMergeImageChecklist = shouldMergePairedChecklist(source, entries);
  const labels = [];

  if (shouldMergeImageChecklist) {
    for (let index = 0; index < entries.length; index += 2) {
      const labelEntry = entries[index];
      const checklistEntry = entries[index + 1];

      labels.push({
        zpl: labelEntry.zpl,
        productFooter: labelEntry.productFooter,
        productFooterZpl: checklistEntry?.zpl || null,
        sourceName: source.name,
        index: labels.length + 1
      });
    }

    return labels;
  }

  return entries.map((entry, index) => ({
    zpl: entry.zpl,
    productFooter: entry.productFooter,
    productFooterZpl: null,
    sourceName: source.name,
    index: index + 1
  }));
}

function shouldMergePairedChecklist(source, entries) {
  if (entries.length < 2 || entries.length % 2 !== 0) return false;
  if (entries.some((entry) => entry.productFooter?.lines?.length)) return false;

  return /(lista|checklist|produto|pedido|separacao|separação)/i.test(source.name);
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
  const template = getTemplateSettings(body);

  return {
    pageSize,
    density,
    rotation,
    scaleMode,
    marginPoints: marginMm * MM_TO_POINTS,
    preset,
    template,
    pdfWidth: preset.widthCm * CM_TO_POINTS,
    pdfHeight: preset.heightCm * CM_TO_POINTS,
    labelaryUrl: `https://api.labelary.com/v1/printers/${density}dpmm/labels/${preset.labelarySize}/0/`
  };
}

async function drawLabelPage(pdf, page, image, settings, label) {
  const hasProductFooter = Boolean(
    settings.template.footer.enabled && (label.productFooter?.lines?.length || label.productFooterZpl)
  );

  if (!hasProductFooter) {
    drawLabelImage(page, image, settings, null);
    return;
  }

  drawLabelImage(page, image, settings, getProtectedAreaForLabel(label, settings));

  if (label.productFooterZpl) {
    const footerPngBytes = await renderZplToPng(label.productFooterZpl, settings);
    const imageProductFooter = await extractProductsFromChecklistImage(footerPngBytes);

    if (imageProductFooter?.lines?.length) {
      await drawProductFooter(pdf, page, imageProductFooter, settings);
      return;
    }

    const preparedFooterPngBytes = await prepareChecklistFooterImage(footerPngBytes);
    const preparedFooterImage = await pdf.embedPng(preparedFooterPngBytes);
    drawImageFooter(page, preparedFooterImage, settings, label);
    return;
  }

  await drawProductFooter(pdf, page, label.productFooter, settings);
}

function getProtectedAreaForLabel(label, settings) {
  if (!label.productFooterZpl) return settings.template.protectedArea;

  return {
    ...settings.template.protectedArea,
    xMm: 2,
    yMm: 2,
    widthMm: 96,
    heightMm: clampNumber(150 - getFooterHeightMm(label, settings) - 2, 118, 150)
  };
}

function drawLabelImage(page, image, settings, area) {
  const pageWidth = settings.pdfWidth;
  const pageHeight = settings.pdfHeight;
  const margin = settings.marginPoints;
  const areaX = area ? area.xMm * MM_TO_POINTS : 0;
  const areaY = area ? area.yMm * MM_TO_POINTS : 0;
  const areaWidth = area ? area.widthMm * MM_TO_POINTS : pageWidth;
  const areaHeight = area ? area.heightMm * MM_TO_POINTS : pageHeight;
  const contentWidth = Math.max(pageWidth - margin * 2, 1);
  const contentHeight = Math.max(pageHeight - margin * 2, 1);
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const rotated = settings.rotation === 90 || settings.rotation === 270;
  const imageBoxWidth = rotated ? sourceHeight : sourceWidth;
  const imageBoxHeight = rotated ? sourceWidth : sourceHeight;
  const targetWidth = Math.max(Math.min(areaWidth, contentWidth), 1);
  const targetHeight = Math.max(Math.min(areaHeight, contentHeight), 1);
  const fitScale = Math.min(targetWidth / imageBoxWidth, targetHeight / imageBoxHeight);
  const fillScale = Math.max(targetWidth / imageBoxWidth, targetHeight / imageBoxHeight);
  const scale =
    settings.scaleMode === "original" ? fitScale : settings.scaleMode === "fill" ? fillScale : fitScale;
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const boxWidth = imageBoxWidth * scale;
  const boxHeight = imageBoxHeight * scale;
  const left = margin + areaX + (targetWidth - boxWidth) / 2;
  const bottom = pageHeight - margin - areaY - targetHeight + (targetHeight - boxHeight) / 2;

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

function drawImageFooter(page, image, settings, label) {
  const footer = settings.template.footer;
  const footerHeight = getFooterHeightMm(label, settings) * MM_TO_POINTS;
  const padding = footer.paddingMm * MM_TO_POINTS;
  const targetWidth = Math.max(settings.pdfWidth - padding * 2, 1);
  const targetHeight = Math.max(footerHeight - padding * 2, 1);
  const scale = Math.min(targetWidth / image.width, targetHeight / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const left = padding + (targetWidth - drawWidth) / 2;
  const bottom = padding + (targetHeight - drawHeight) / 2;

  page.drawRectangle({
    x: 0,
    y: 0,
    width: settings.pdfWidth,
    height: footerHeight,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.78, 0.82, 0.88),
    borderWidth: 0.6
  });

  page.pushOperators(
    pushGraphicsState(),
    rectangle(padding, padding, targetWidth, targetHeight),
    clip(),
    endPath()
  );

  try {
    page.drawImage(image, {
      x: left,
      y: bottom,
      width: drawWidth,
      height: drawHeight
    });
  } finally {
    page.pushOperators(popGraphicsState());
  }
}

function getFooterHeightMm(label, settings) {
  if (label.productFooterZpl) return 23;
  return Number(settings.template.footer.heightMm) || DEFAULT_TEMPLATE.footer.heightMm;
}

async function drawProductFooter(pdf, page, productFooter, settings) {
  const template = settings.template;
  const footer = template.footer;
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const footerHeight = footer.heightMm * MM_TO_POINTS;
  const padding = footer.paddingMm * MM_TO_POINTS;
  const x = padding;
  const y = padding;
  const width = settings.pdfWidth - padding * 2;
  const height = Math.min(footerHeight, settings.pdfHeight - padding * 2);
  const color = hexToRgb(footer.textColor);
  const headerParts = [];

  if (footer.showSku && productFooter.skuCount) headerParts.push(`SKU: ${productFooter.skuCount}`);
  if (footer.showTotalItems && productFooter.itemsCount) headerParts.push(`ITENS: ${productFooter.itemsCount}`);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: settings.pdfWidth,
    height: footerHeight,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.78, 0.82, 0.88),
    borderWidth: 0.6
  });

  const lines = buildFooterLines(productFooter, footer);
  const fontSize = pickFooterFontSize(lines, width, height, regularFont, boldFont, footer, headerParts.length > 0);
  const lineHeight = fontSize * footer.lineSpacing;
  let cursorY = y + height - fontSize - 2;

  if (headerParts.length) {
    page.drawText(toPdfSafeText(headerParts.join(" - ")), {
      x,
      y: cursorY,
      size: fontSize + 0.8,
      font: boldFont,
      color
    });
    cursorY -= lineHeight + 2;
  }

  for (const line of lines) {
    for (const wrapped of wrapText(line, width, regularFont, fontSize)) {
      if (cursorY < y) return;
      page.drawText(toPdfSafeText(wrapped), {
        x,
        y: cursorY,
        size: fontSize,
        font: regularFont,
        color
      });
      cursorY -= lineHeight;
    }
  }
}

function buildFooterLines(productFooter, footer) {
  return productFooter.lines.map((item) => {
    const parts = [];
    if (footer.showMarker && footer.marker) parts.push("-");
    if (footer.showQuantity && item.quantity) parts.push(`${item.quantity}x`);
    parts.push(item.text);
    return parts.join(" ");
  });
}

function pickFooterFontSize(lines, width, height, regularFont, boldFont, footer, hasHeader) {
  const sizeRange = PRODUCT_FONT_SIZES[footer.fontSize] || PRODUCT_FONT_SIZES.auto;

  for (let size = sizeRange.max; size >= sizeRange.min; size -= 0.5) {
    const lineHeight = size * footer.lineSpacing;
    const wrappedCount = lines.reduce((sum, line) => sum + wrapText(line, width, regularFont, size).length, 0);
    const headerHeight = hasHeader ? lineHeight + 2 : 0;
    const totalHeight = headerHeight + wrappedCount * lineHeight;
    const longestHeader = hasHeader ? boldFont.widthOfTextAtSize("SKU: 999 • ITENS: 999", size + 0.8) : 0;

    if (totalHeight <= height && longestHeader <= width) return size;
  }

  return sizeRange.min;
}

function wrapText(text, width, font, size) {
  const words = toPdfSafeText(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines.length ? lines : [String(text)];
}

function extractProductFooter(prefix, label) {
  const candidates = [
    ...extractPlainProductLines(prefix),
    ...extractPlainProductLines(label),
    ...extractFdFields(label)
  ];
  const usable = normalizeProductCandidates(candidates);

  if (!usable.lines.length) return null;
  return usable;
}

function extractPlainProductLines(text) {
  return String(text)
    .replace(/:Z64:[A-Za-z0-9+/=\s]+:[A-F0-9]{4}/gim, " ")
    .replace(/~DGR:[\s\S]*?(?=\^XA|$)/gim, " ")
    .replace(/\^[A-Z0-9@]{1,3}[^~^]*/gim, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractFdFields(text) {
  const fields = [];
  for (const match of String(text).matchAll(/\^FD([\s\S]*?)\^FS/gim)) {
    const value = match[1].replace(/\^FH\\?/gi, "").replace(/\\[0-9A-F]{2}/gi, " ").trim();
    if (value) fields.push(value);
  }
  return fields;
}

function normalizeProductCandidates(candidates) {
  const cleaned = candidates
    .flatMap((line) => String(line).split(/\r?\n+/))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^\^|^~|Z64:|DEMO\.GRF/i.test(line));
  const headerIndex = cleaned.findIndex((line) => /\b(SKU|ITENS?|QTD|QUANTIDADE|PRODUTOS?)\b/i.test(line));
  const productLike = cleaned.filter((line) => isProductLine(line));
  const selected = headerIndex >= 0 ? cleaned.slice(headerIndex, headerIndex + 30) : productLike;
  const header = selected.find((line) => /\b(SKU|ITENS?)\b/i.test(line)) || "";
  const lines = selected
    .filter((line) => line !== header)
    .filter((line) => isProductLine(line))
    .map(parseProductLine);
  const uniqueLines = dedupeProducts(lines);

  return {
    skuCount: extractHeaderNumber(header, /SKU\s*:?\s*(\d+)/i) || uniqueLines.length || null,
    itemsCount:
      extractHeaderNumber(header, /ITENS?\s*:?\s*(\d+)/i) ||
      uniqueLines.reduce((sum, item) => sum + (item.quantity || 1), 0) ||
      null,
    lines: uniqueLines
  };
}

async function extractProductsFromChecklistImage(pngBytes) {
  try {
    const text = await recognizeTextFromImage(pngBytes);
    return normalizeOcrProductText(text);
  } catch (error) {
    console.warn("OCR indisponível ou sem leitura útil:", error?.message || error);
    return null;
  }
}

async function recognizeTextFromImage(pngBytes) {
  const worker = await getOcrWorker();
  const variants = await buildOcrImageVariants(pngBytes);
  let bestText = "";
  let bestScore = 0;

  for (const variant of variants) {
    const result = await worker.recognize(Buffer.from(variant));
    const text = result?.data?.text || "";
    const score = scoreOcrText(text);

    if (score > bestScore) {
      bestText = text;
      bestScore = score;
    }
  }

  return bestText;
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createOcrWorker();
  }

  return ocrWorkerPromise;
}

async function createOcrWorker() {
  const { createWorker } = await import("tesseract.js");

  try {
    return await createWorker("por");
  } catch {
    return createWorker("eng");
  }
}

async function buildOcrImageVariants(pngBytes) {
  const variants = [Buffer.from(pngBytes)];

  try {
    const { default: sharp } = await import("sharp");
    const rotations = [90, 270, 180];

    for (const rotation of rotations) {
      const rotated = await sharp(Buffer.from(pngBytes)).rotate(rotation).png().toBuffer();
      variants.push(rotated);

      const metadata = await sharp(rotated).metadata();
      if (metadata.width && metadata.height) {
        const cropTop = Math.floor(metadata.height * 0.52);
        const cropHeight = metadata.height - cropTop;
        if (cropHeight > 20) {
          variants.push(
            await sharp(rotated)
              .extract({ left: 0, top: cropTop, width: metadata.width, height: cropHeight })
              .resize({ width: Math.max(metadata.width * 2, 1200), withoutEnlargement: false })
              .grayscale()
              .png()
              .toBuffer()
          );
        }
      }
    }
  } catch (error) {
    console.warn("Pré-processamento de OCR indisponível:", error?.message || error);
  }

  return dedupeBuffers(variants).slice(0, 6);
}

async function prepareChecklistFooterImage(pngBytes) {
  try {
    const { default: sharp } = await import("sharp");
    const source = Buffer.from(pngBytes);
    const candidates = [];

    for (const rotation of [0, 90, 270, 180]) {
      const rotated = await sharp(source)
        .rotate(rotation)
        .flatten({ background: "#ffffff" })
        .png()
        .toBuffer();
      const trimmed = await cropImageToInk(rotated);
      if (trimmed) candidates.push(trimmed);

      const metadata = await sharp(rotated).metadata();
      if (metadata.width && metadata.height && metadata.height > 40) {
        for (const start of [0.28, 0.4, 0.52, 0.64]) {
          const cropTop = Math.floor(metadata.height * start);
          const cropHeight = metadata.height - cropTop;
          if (cropHeight <= 20) continue;

          const partial = await sharp(rotated)
            .extract({ left: 0, top: cropTop, width: metadata.width, height: cropHeight })
            .png()
            .toBuffer();
          const partialTrimmed = await cropImageToInk(partial);
          if (partialTrimmed) candidates.push(partialTrimmed);
        }
      }
    }

    const ranked = [];
    for (const candidate of dedupeBuffers(candidates)) {
      const metadata = await sharp(candidate).metadata();
      if (!metadata.width || !metadata.height) continue;
      const ink = await getInkStats(candidate);
      if (ink.darkPixels < 80) continue;
      ranked.push({
        buffer: candidate,
        score: scoreFooterImageCandidate(metadata.width, metadata.height, ink.darkPixels)
      });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked[0]?.buffer || Buffer.from(pngBytes);
  } catch (error) {
    console.warn("Recorte do checklist indisponível:", error?.message || error);
    return Buffer.from(pngBytes);
  }
}

async function cropImageToInk(imageBytes) {
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(imageBytes)
    .flatten({ background: "#ffffff" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bounds = getInkBounds(data, info.width, info.height);

  if (!bounds || bounds.darkPixels < 80) return null;

  const padding = 8;
  const left = Math.max(bounds.minX - padding, 0);
  const top = Math.max(bounds.minY - padding, 0);
  const right = Math.min(bounds.maxX + padding, info.width - 1);
  const bottom = Math.min(bounds.maxY + padding, info.height - 1);

  return sharp(imageBytes)
    .extract({
      left,
      top,
      width: Math.max(right - left + 1, 1),
      height: Math.max(bottom - top + 1, 1)
    })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
}

async function getInkStats(imageBytes) {
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(imageBytes)
    .flatten({ background: "#ffffff" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return getInkBounds(data, info.width, info.height) || { darkPixels: 0 };
}

function getInkBounds(data, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let darkPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = data[y * width + x];
      if (value > 210) continue;

      darkPixels += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (!darkPixels) return null;
  return { minX, minY, maxX, maxY, darkPixels };
}

function scoreFooterImageCandidate(width, height, darkPixels) {
  const ratio = width / Math.max(height, 1);
  const area = width * height;
  const wideBonus = ratio >= 1.8 ? 800000 : 0;
  const tableRatioBonus = ratio >= 2.5 && ratio <= 9 ? 500000 : 0;
  const veryTallPenalty = ratio < 1.2 ? 900000 : 0;

  return darkPixels * 10 + area + wideBonus + tableRatioBonus - veryTallPenalty;
}

function scoreOcrText(text) {
  const normalized = normalizeOcrProductText(text);
  if (!normalized?.lines?.length) return 0;

  return (
    normalized.lines.length * 10 +
    normalized.lines.reduce((sum, item) => sum + Math.min(item.text.length, 80), 0)
  );
}

function normalizeOcrProductText(text) {
  const lines = String(text)
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const productHeaderIndex = lines.findIndex((line) => /produto/i.test(line));
  const candidateLines = (productHeaderIndex >= 0 ? lines.slice(productHeaderIndex + 1) : lines)
    .filter((line) => !isOcrNoiseLine(line))
    .map(parseOcrProductLine)
    .filter((item) => item.text.length >= 4);
  const products = dedupeProducts(candidateLines).slice(0, 12);

  if (!products.length) return null;

  return {
    skuCount: products.length,
    itemsCount: products.reduce((sum, item) => sum + (item.quantity || 1), 0),
    lines: products
  };
}

function isOcrNoiseLine(line) {
  return (
    /^(shopee|checklist|id pedido|pedido|nf|série|serie|emissão|emissao|sku|qnt|quantidade|variação|variacao)$/i.test(
      line
    ) ||
    /atenção|atencao|vendedor|pacote|controle/i.test(line) ||
    /^[\W_]+$/.test(line) ||
    /^\d+$/.test(line)
  );
}

function parseOcrProductLine(line) {
  const withoutPrefix = line
    .replace(/^[✓✔*\-•\s]+/, "")
    .replace(/^\d+\s*[-.)]?\s*/, "")
    .trim();
  const quantityMatch =
    withoutPrefix.match(/(?:^|\s)(\d+)\s*x\s+(.+)/i) || withoutPrefix.match(/(.+?)\s+(\d+)\s*$/);

  if (quantityMatch?.[2] && /^\d+$/.test(quantityMatch[2])) {
    return {
      quantity: Number(quantityMatch[2]),
      text: quantityMatch[1].trim()
    };
  }

  if (quantityMatch?.[1] && quantityMatch?.[2]) {
    return {
      quantity: Number(quantityMatch[1]),
      text: quantityMatch[2].trim()
    };
  }

  return {
    quantity: null,
    text: withoutPrefix
  };
}

function isProductLine(line) {
  return /^(✓|✔|-|\*)\s*\S+/.test(line) || /^\d+\s*x\s+\S+/i.test(line);
}

function parseProductLine(line) {
  const withoutMarker = line.replace(/^(✓|✔|-|\*)\s*/, "").trim();
  const quantityMatch = withoutMarker.match(/^(\d+)\s*x\s+(.+)/i);

  if (quantityMatch) {
    return {
      quantity: Number(quantityMatch[1]),
      text: quantityMatch[2].trim()
    };
  }

  return {
    quantity: null,
    text: withoutMarker
  };
}

function dedupeProducts(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    const key = `${line.quantity || ""}:${line.text}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeBuffers(buffers) {
  const seen = new Set();

  return buffers.filter((buffer) => {
    const key = `${buffer.length}:${buffer.subarray(0, 24).toString("base64")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractHeaderNumber(header, pattern) {
  const match = String(header).match(pattern);
  return match ? Number(match[1]) : null;
}

function getTemplateSettings(body) {
  const clientTemplate = parseTemplate(body?.templateJson);
  const template = mergeTemplate(DEFAULT_TEMPLATE, clientTemplate);
  const footer = template.footer;

  footer.heightMm = clampNumber(Number(footer.heightMm), 12, 55);
  footer.gapMm = clampNumber(Number(footer.gapMm), 0, 8);
  footer.paddingMm = clampNumber(Number(footer.paddingMm), 1, 8);
  footer.lineSpacing = clampNumber(Number(footer.lineSpacing), 0.9, 1.8);
  footer.fontSize = PRODUCT_FONT_SIZES[footer.fontSize] ? footer.fontSize : "auto";
  footer.marker = String(footer.marker || "✓").slice(0, 2);
  footer.textColor = /^#[0-9a-f]{6}$/i.test(footer.textColor) ? footer.textColor : "#111827";

  template.protectedArea = {
    xMm: 0,
    yMm: 0,
    widthMm: 100,
    heightMm: clampNumber(150 - footer.heightMm - footer.gapMm, 80, 150)
  };

  return template;
}

function parseTemplate(templateJson) {
  if (!templateJson) return null;

  try {
    return JSON.parse(String(templateJson));
  } catch {
    return null;
  }
}

function mergeTemplate(base, override) {
  if (!override || typeof override !== "object") return structuredClone(base);

  return {
    ...base,
    ...override,
    protectedArea: {
      ...base.protectedArea,
      ...(override.protectedArea || {})
    },
    footer: {
      ...base.footer,
      ...(override.footer || {})
    }
  };
}

function hexToRgb(hex) {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "111827";
  const value = Number.parseInt(normalized, 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function toPdfSafeText(text) {
  return String(text)
    .replace(/[✓✔]/g, "-")
    .replace(/[•]/g, "-")
    .replace(/[^\x20-\x7eÀ-ÿ]/g, "");
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

async function renderZplToPng(zpl, settings) {
  let lastErrorDetails = "";

  for (let attempt = 1; attempt <= LABELARY_MAX_ATTEMPTS; attempt += 1) {
    await waitForLabelarySlot();

    const formData = new FormData();
    formData.append("file", new Blob([zpl], { type: "text/plain" }), "label.zpl");

    const response = await fetch(settings.labelaryUrl, {
      method: "POST",
      headers: {
        Accept: "image/png"
      },
      body: formData
    });

    if (response.ok) {
      return new Uint8Array(await response.arrayBuffer());
    }

    lastErrorDetails = await response.text().catch(() => "");

    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const retryDelay = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : LABELARY_MIN_INTERVAL_MS * (attempt + 1);
      await delay(retryDelay);
      continue;
    }

    break;
  }

  const error = new Error(lastErrorDetails || "Falha ao renderizar etiqueta ZPL.");
  error.statusCode = 422;
  error.publicMessage =
    "O renderizador não conseguiu interpretar uma das etiquetas. Verifique o ZPL e tente novamente.";
  throw error;
}

async function waitForLabelarySlot() {
  const now = Date.now();
  const waitMs = Math.max(0, lastLabelaryRequestAt + LABELARY_MIN_INTERVAL_MS - now);
  if (waitMs > 0) {
    await delay(waitMs);
  }
  lastLabelaryRequestAt = Date.now();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
