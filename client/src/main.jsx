import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  CheckCircle2,
  Eye,
  FileArchive,
  FileText,
  History,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RotateCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  UserRound,
  X
} from "lucide-react";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL || "";
const ACCEPTED_EXTENSIONS = [".zpl", ".txt", ".zip"];
const PAGE_SIZES = [
  { value: "10x15", label: "10 x 15 cm" },
  { value: "10x10", label: "10 x 10 cm" },
  { value: "10x7", label: "10 x 7 cm" },
  { value: "10x5", label: "10 x 5 cm" }
];
const DENSITIES = [
  { value: "8", label: "203 dpi", hint: "Mais comum" },
  { value: "12", label: "300 dpi", hint: "Mais nítido" },
  { value: "24", label: "600 dpi", hint: "Alta definição" },
  { value: "6", label: "152 dpi", hint: "Legado" }
];
const ROTATIONS = ["0", "90", "180", "270"];
const SCALE_MODES = [
  { value: "fit", label: "Encaixar" },
  { value: "fill", label: "Preencher" },
  { value: "original", label: "Original" }
];
const DEFAULT_SETTINGS = {
  pageSize: "10x15",
  density: "8",
  rotation: "0",
  marginMm: 0,
  scaleMode: "fit"
};
const DEFAULT_TEMPLATE = {
  id: "jm-cosmeticos",
  name: "JM Cosméticos",
  footer: {
    enabled: true,
    heightMm: 30,
    paddingMm: 3,
    showSku: true,
    showTotalItems: true,
    showQuantity: true,
    showMarker: true,
    marker: "✓",
    fontSize: "auto",
    lineSpacing: 1.08,
    textColor: "#111827"
  }
};
const FONT_SIZE_OPTIONS = [
  { value: "auto", label: "Automático" },
  { value: "small", label: "Pequeno" },
  { value: "medium", label: "Médio" },
  { value: "large", label: "Grande" }
];

function App() {
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [rawZpl, setRawZpl] = useState("");
  const [mode, setMode] = useState("upload");
  const [settings, setSettings] = useState(loadStored("zpl-settings", DEFAULT_SETTINGS));
  const [template, setTemplate] = useState(loadStored("zpl-template", DEFAULT_TEMPLATE));
  const [profile, setProfile] = useState(loadStored("zpl-profile", { name: "" }));
  const [history, setHistory] = useState(loadStored("zpl-history", []));
  const [isDragging, setIsDragging] = useState(false);
  const [isWorking, setIsWorking] = useState("");
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [previews, setPreviews] = useState([]);
  const [selectedPreview, setSelectedPreview] = useState(null);
  const [result, setResult] = useState(null);

  const totalSize = useMemo(() => files.reduce((sum, item) => sum + item.file.size, 0), [files]);
  const hasInput = files.length > 0 || rawZpl.trim().length > 0;

  useEffect(() => {
    localStorage.setItem("zpl-settings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem("zpl-template", JSON.stringify(template));
  }, [template]);

  useEffect(() => {
    localStorage.setItem("zpl-profile", JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    localStorage.setItem("zpl-history", JSON.stringify(history));
  }, [history]);

  function updateSetting(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
    clearOutput();
  }

  function updateTemplate(path, value) {
    setTemplate((current) => {
      if (path.startsWith("footer.")) {
        return {
          ...current,
          footer: {
            ...current.footer,
            [path.replace("footer.", "")]: value
          }
        };
      }

      return { ...current, [path]: value };
    });
    clearOutput();
  }

  function selectFiles(fileList) {
    setError("");
    clearOutput();

    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const accepted = [];
    const rejected = [];

    for (const nextFile of incoming) {
      const isAccepted = ACCEPTED_EXTENSIONS.some((extension) =>
        nextFile.name.toLowerCase().endsWith(extension)
      );

      if (isAccepted) {
        accepted.push({
          id: `${nextFile.name}-${nextFile.size}-${nextFile.lastModified}-${crypto.randomUUID()}`,
          file: nextFile
        });
      } else {
        rejected.push(nextFile.name);
      }
    }

    if (accepted.length) setFiles((current) => [...current, ...accepted]);
    if (rejected.length) setError("Alguns arquivos foram ignorados. Use apenas .zpl, .txt ou .zip.");
  }

  async function analyzeInput() {
    await runRequest("analyze", "/api/analyze", async (response) => {
      setAnalysis(await response.json());
      setPreviews([]);
      setResult(null);
    });
  }

  async function previewInput() {
    await runRequest("preview", "/api/preview", async (response) => {
      const payload = await response.json();
      setAnalysis(payload);
      setPreviews(payload.previews || []);
      setSelectedPreview(null);
      setResult(null);
    });
  }

  async function convertInput() {
    await runRequest("convert", "/api/convert", async (response) => {
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const labelCount = response.headers.get("X-Label-Count") || "1";
      const sourceCount = response.headers.get("X-Source-Count") || "1";
      const finalPageSize = response.headers.get("X-Page-Size") || currentPageSizeLabel();
      const nextResult = {
        url: downloadUrl,
        labelCount,
        sourceCount,
        pageSize: finalPageSize,
        name: buildDownloadName(),
        createdAt: new Date().toLocaleString("pt-BR", {
          dateStyle: "short",
          timeStyle: "short"
        })
      };

      setResult(nextResult);
      setHistory((current) => [nextResult, ...current].slice(0, 10));
    });
  }

  async function convertSinglePreview(preview) {
    await runRequest("convert-single", "/api/convert-label", async (response) => {
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const labelNumber = preview.globalIndex + 1;
      const nextResult = {
        url: downloadUrl,
        labelCount: "1",
        sourceCount: "1",
        pageSize: response.headers.get("X-Page-Size") || currentPageSizeLabel(),
        name: `${preview.sourceName.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-")}-etiqueta-${labelNumber}-${settings.pageSize}.pdf`,
        createdAt: new Date().toLocaleString("pt-BR", {
          dateStyle: "short",
          timeStyle: "short"
        })
      };

      setResult(nextResult);
      setHistory((current) => [nextResult, ...current].slice(0, 10));
      triggerDownload(nextResult.url, nextResult.name);
    }, { labelIndex: String(preview.globalIndex) });
  }

  async function runRequest(action, endpoint, onSuccess, extraFields = {}) {
    if (!hasInput) {
      setError("Envie arquivos ou cole um código ZPL para continuar.");
      return;
    }

    setIsWorking(action);
    setError("");

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        body: buildFormData(extraFields)
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Não foi possível processar a solicitação.");
      }

      await onSuccess(response);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsWorking("");
    }
  }

  function buildFormData(extraFields = {}) {
    const formData = new FormData();
    files.forEach((item) => formData.append("files", item.file));
    formData.append("rawZpl", rawZpl);
    formData.append("pageSize", settings.pageSize);
    formData.append("density", settings.density);
    formData.append("rotation", settings.rotation);
    formData.append("marginMm", settings.marginMm);
    formData.append("scaleMode", settings.scaleMode);
    formData.append("templateJson", JSON.stringify(template));
    Object.entries(extraFields).forEach(([key, value]) => formData.append(key, value));
    return formData;
  }

  function removeFile(id) {
    setFiles((current) => current.filter((item) => item.id !== id));
    clearOutput();
  }

  function clearAll() {
    setFiles([]);
    setRawZpl("");
    setError("");
    clearOutput();
    if (inputRef.current) inputRef.current.value = "";
  }

  function clearOutput() {
    setAnalysis(null);
    setPreviews([]);
    setSelectedPreview(null);
    setResult(null);
  }

  function buildDownloadName() {
    if (files.length === 1 && !rawZpl.trim()) {
      return `${files[0].file.name.replace(/\.[^.]+$/, "") || "etiquetas"}-${settings.pageSize}.pdf`;
    }

    return `etiquetas-convertidas-${settings.pageSize}.pdf`;
  }

  function currentPageSizeLabel() {
    return PAGE_SIZES.find((item) => item.value === settings.pageSize)?.label || "10 x 15 cm";
  }

  return (
    <main className="page-shell">
      <section className="workspace">
        <aside className="intro-panel">
          <span className="eyebrow">Conversor ZPL online</span>
          <h1>ZPL para PDF profissional</h1>
          <p>
            Envie arquivos, cole ZPL, valide o conteúdo, visualize etiquetas e gere PDFs prontos
            para impressão térmica.
          </p>

          <LocalPanel profile={profile} setProfile={setProfile} history={history} setHistory={setHistory} />
        </aside>

        <section className="converter-panel" aria-label="Conversor de etiquetas ZPL para PDF">
          <div className="panel-header">
            <div>
              <strong>Entrada da conversão</strong>
              <span>
                {files.length || rawZpl.trim()
                  ? `${files.length} arquivo(s), ${formatBytes(totalSize)}${rawZpl.trim() ? " + ZPL colado" : ""}`
                  : "Envie arquivos ou cole o ZPL"}
              </span>
            </div>
            {hasInput && (
              <button className="ghost-button" onClick={clearAll}>
                <Trash2 size={17} aria-hidden="true" />
                Limpar
              </button>
            )}
          </div>

          <div className="tabs" role="tablist" aria-label="Tipo de entrada">
            <button className={mode === "upload" ? "is-selected" : ""} onClick={() => setMode("upload")}>
              <UploadCloud size={17} aria-hidden="true" />
              Arquivo
            </button>
            <button className={mode === "paste" ? "is-selected" : ""} onClick={() => setMode("paste")}>
              <FileText size={17} aria-hidden="true" />
              Colar ZPL
            </button>
          </div>

          {mode === "upload" ? (
            <UploadArea
              inputRef={inputRef}
              files={files}
              isDragging={isDragging}
              setIsDragging={setIsDragging}
              selectFiles={selectFiles}
              removeFile={removeFile}
            />
          ) : (
            <textarea
              className="zpl-editor"
              value={rawZpl}
              onChange={(event) => {
                setRawZpl(event.target.value);
                clearOutput();
              }}
              placeholder="Cole aqui o conteúdo ZPL iniciado por ^XA e finalizado por ^XZ"
            />
          )}

          <SettingsPanel
            settings={settings}
            template={template}
            updateSetting={updateSetting}
            updateTemplate={updateTemplate}
          />

          {error && <p className="message error">{error}</p>}

          {analysis && <AnalysisPanel analysis={analysis} />}

          {previews.length > 0 && (
            <PreviewPanel
              previews={previews}
              total={analysis?.labelsCount || previews.length}
              limit={analysis?.previewLimit}
              onSelect={setSelectedPreview}
            />
          )}

          {result && (
            <div className="result-box">
              <CheckCircle2 size={24} aria-hidden="true" />
              <div>
                <strong>PDF gerado com sucesso</strong>
                <span>
                  {result.labelCount} etiqueta(s), {result.sourceCount} origem(ns), {result.pageSize}
                </span>
              </div>
            </div>
          )}

          <div className="actions">
            <button className="secondary-button" onClick={analyzeInput} disabled={!!isWorking || !hasInput}>
              {isWorking === "analyze" ? <LoaderCircle className="spin" size={19} /> : <SlidersHorizontal size={19} />}
              Analisar
            </button>
            <button className="secondary-button" onClick={previewInput} disabled={!!isWorking || !hasInput}>
              {isWorking === "preview" ? <LoaderCircle className="spin" size={19} /> : <Eye size={19} />}
              Pré-visualizar
            </button>
            <button className="primary-button" onClick={convertInput} disabled={!!isWorking || !hasInput}>
              {isWorking === "convert" ? (
                <>
                  <LoaderCircle className="spin" size={20} aria-hidden="true" />
                  Convertendo
                </>
              ) : (
                <>
                  <ArrowDownToLine size={20} aria-hidden="true" />
                  Gerar PDF
                </>
              )}
            </button>
            {result && (
              <a className="download-button" href={result.url} download={result.name}>
                Baixar PDF
              </a>
            )}
          </div>
        </section>
      </section>

      <TrustSections />

      {selectedPreview && (
        <PreviewModal
          preview={selectedPreview}
          isGenerating={isWorking === "convert-single"}
          onClose={() => setSelectedPreview(null)}
          onDownload={() => convertSinglePreview(selectedPreview)}
        />
      )}
    </main>
  );
}

function UploadArea({ inputRef, files, isDragging, setIsDragging, selectFiles, removeFile }) {
  return (
    <>
      <div
        className={`dropzone ${isDragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          selectFiles(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".zpl,.txt,.zip"
          multiple
          onChange={(event) => selectFiles(event.target.files)}
        />
        <div className="upload-icon">
          <UploadCloud size={34} aria-hidden="true" />
        </div>
        <strong>Arraste arquivos aqui</strong>
        <span>ou clique para adicionar .zpl, .txt e .zip</span>
      </div>

      {files.length > 0 && (
        <div className="file-list" aria-label="Arquivos selecionados">
          {files.map((item) => (
            <FileItem key={item.id} item={item} onRemove={() => removeFile(item.id)} />
          ))}
        </div>
      )}
    </>
  );
}

function SettingsPanel({ settings, template, updateSetting, updateTemplate }) {
  return (
    <section className="options-panel" aria-label="Opções de conversão">
      <div className="section-title">
        <Settings2 size={19} aria-hidden="true" />
        <strong>Configurações de impressão</strong>
      </div>

      <div className="settings-grid">
        <label>
          Tamanho
          <select value={settings.pageSize} onChange={(event) => updateSetting("pageSize", event.target.value)}>
            {PAGE_SIZES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Escala
          <select value={settings.scaleMode} onChange={(event) => updateSetting("scaleMode", event.target.value)}>
            {SCALE_MODES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Margem: {settings.marginMm} mm
          <input
            type="range"
            min="0"
            max="20"
            value={settings.marginMm}
            onChange={(event) => updateSetting("marginMm", event.target.value)}
          />
        </label>
      </div>

      <div className="density-group" role="group" aria-label="Resolução da impressora">
        {DENSITIES.map((item) => (
          <button
            key={item.value}
            className={settings.density === item.value ? "is-selected" : ""}
            onClick={() => updateSetting("density", item.value)}
            type="button"
          >
            <strong>{item.label}</strong>
            <span>{item.hint}</span>
          </button>
        ))}
      </div>

      <div className="rotation-group" role="group" aria-label="Rotação da etiqueta">
        {ROTATIONS.map((rotation) => (
          <button
            key={rotation}
            className={settings.rotation === rotation ? "is-selected" : ""}
            onClick={() => updateSetting("rotation", rotation)}
            type="button"
          >
            <RotateCw size={16} aria-hidden="true" />
            {rotation}°
          </button>
        ))}
      </div>

      <div className="template-panel">
        <div className="section-title">
          <SlidersHorizontal size={19} aria-hidden="true" />
          <strong>Template operacional</strong>
          <span>{template.name}</span>
        </div>

        <div className="toggle-grid">
          <label>
            <input
              type="checkbox"
              checked={template.footer.enabled}
              onChange={(event) => updateTemplate("footer.enabled", event.target.checked)}
            />
            Rodapé automático
          </label>
          <label>
            <input
              type="checkbox"
              checked={template.footer.showSku}
              onChange={(event) => updateTemplate("footer.showSku", event.target.checked)}
            />
            Mostrar SKU
          </label>
          <label>
            <input
              type="checkbox"
              checked={template.footer.showTotalItems}
              onChange={(event) => updateTemplate("footer.showTotalItems", event.target.checked)}
            />
            Total de itens
          </label>
          <label>
            <input
              type="checkbox"
              checked={template.footer.showQuantity}
              onChange={(event) => updateTemplate("footer.showQuantity", event.target.checked)}
            />
            Quantidade
          </label>
          <label>
            <input
              type="checkbox"
              checked={template.footer.showMarker}
              onChange={(event) => updateTemplate("footer.showMarker", event.target.checked)}
            />
            Marcador
          </label>
        </div>

        <div className="settings-grid">
          <label>
            Fonte
            <select
              value={template.footer.fontSize}
              onChange={(event) => updateTemplate("footer.fontSize", event.target.value)}
            >
              {FONT_SIZE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Altura do rodapé: {template.footer.heightMm} mm
            <input
              type="range"
              min="12"
              max="55"
              value={template.footer.heightMm}
              onChange={(event) => updateTemplate("footer.heightMm", Number(event.target.value))}
            />
          </label>
          <label>
            Espaçamento: {template.footer.lineSpacing}
            <input
              type="range"
              min="0.9"
              max="1.8"
              step="0.02"
              value={template.footer.lineSpacing}
              onChange={(event) => updateTemplate("footer.lineSpacing", Number(event.target.value))}
            />
          </label>
        </div>
      </div>
    </section>
  );
}

function AnalysisPanel({ analysis }) {
  return (
    <section className="analysis-panel" aria-label="Resumo da análise">
      <div className="metric">
        <strong>{analysis.labelsCount}</strong>
        <span>etiqueta(s)</span>
      </div>
      <div className="metric">
        <strong>{analysis.sourcesCount}</strong>
        <span>origem(ns)</span>
      </div>
      <div className="source-list">
        {analysis.sources.slice(0, 4).map((source) => (
          <span key={source.name}>
            {source.name} - {source.labelsCount} etiqueta(s)
          </span>
        ))}
      </div>
      {analysis.warnings?.map((warning) => (
        <p className="message warning" key={warning}>
          {warning}
        </p>
      ))}
    </section>
  );
}

function PreviewPanel({ previews, total, limit, onSelect }) {
  return (
    <section className="preview-panel" aria-label="Pré-visualização das etiquetas">
      <div className="section-title">
        <Eye size={19} aria-hidden="true" />
        <strong>Pré-visualização</strong>
        <span>
          {previews.length} de {total} etiqueta(s)
          {total > previews.length ? `, limite ${limit}` : ""}
        </span>
      </div>
      <div className="preview-grid">
        {previews.map((preview, index) => (
          <button
            className="preview-card"
            key={`${preview.sourceName}-${preview.index}-${index}`}
            onClick={() => onSelect({ ...preview, globalIndex: preview.globalIndex ?? index })}
            type="button"
          >
            <PreviewImage preview={preview} index={index} />
            <span>
              {preview.sourceName} #{preview.index}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PreviewImage({ preview, index }) {
  if (!preview.productFooter?.lines?.length && !preview.productFooterImage) {
    return <img src={preview.image} alt={`Etiqueta ${index + 1}`} />;
  }

  return (
    <div className="preview-composed">
      <img src={preview.image} alt={`Etiqueta ${index + 1}`} />
      {preview.productFooter?.lines?.length ? (
        <div className="preview-footer">
          <strong>
            {preview.productFooter.skuCount ? `SKU: ${preview.productFooter.skuCount}` : ""}
            {preview.productFooter.skuCount && preview.productFooter.itemsCount ? " • " : ""}
            {preview.productFooter.itemsCount ? `ITENS: ${preview.productFooter.itemsCount}` : ""}
          </strong>
          {preview.productFooter.lines.slice(0, 4).map((item, itemIndex) => (
            <small key={`${item.text}-${itemIndex}`}>
              ✓ {item.quantity ? `${item.quantity}x ` : ""}
              {item.text}
            </small>
          ))}
        </div>
      ) : preview.productFooterImage ? (
        <div className="preview-footer preview-footer-image">
          <img src={preview.productFooterImage} alt={`Lista da etiqueta ${index + 1}`} />
        </div>
      ) : null}
    </div>
  );
}

function PreviewModal({ preview, isGenerating, onClose, onDownload }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Etiqueta ampliada">
      <div className="preview-modal">
        <div className="modal-header">
          <div>
            <strong>Etiqueta #{preview.index}</strong>
            <span>{preview.sourceName}</span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar pré-visualização">
            <X size={18} />
          </button>
        </div>

        <div className="modal-image-frame">
          <PreviewImage preview={preview} index={preview.index - 1} />
        </div>

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Voltar
          </button>
          <button className="primary-button" onClick={onDownload} disabled={isGenerating}>
            {isGenerating ? (
              <>
                <LoaderCircle className="spin" size={19} />
                Gerando
              </>
            ) : (
              <>
                <ArrowDownToLine size={19} />
                Gerar PDF desta etiqueta
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function LocalPanel({ profile, setProfile, history, setHistory }) {
  return (
    <section className="local-panel" aria-label="Painel local">
      <div className="section-title">
        <UserRound size={19} aria-hidden="true" />
        <strong>Painel local</strong>
      </div>
      <label>
        Nome do usuário
        <input
          value={profile.name}
          onChange={(event) => setProfile({ name: event.target.value })}
          placeholder="Seu nome ou empresa"
        />
      </label>
      <div className="mini-status">
        <History size={17} aria-hidden="true" />
        <span>{history.length} conversão(ões) salvas neste navegador</span>
      </div>
      {history.length > 0 && (
        <div className="history-list">
          {history.slice(0, 4).map((item) => (
            <a key={`${item.createdAt}-${item.name}`} href={item.url} download={item.name}>
              <span>{item.name}</span>
              <small>
                {item.labelCount} etiqueta(s) - {item.createdAt}
              </small>
            </a>
          ))}
          <button className="ghost-button" onClick={() => setHistory([])}>
            <Trash2 size={16} aria-hidden="true" />
            Limpar histórico
          </button>
        </div>
      )}
    </section>
  );
}

function TrustSections() {
  return (
    <section className="trust-layout">
      <article>
        <ShieldCheck size={22} aria-hidden="true" />
        <div>
          <strong>Privacidade</strong>
          <p>
            Os arquivos são usados apenas durante a conversão. O serviço não cria banco de dados nem
            mantém histórico no servidor.
          </p>
        </div>
      </article>
      <article>
        <LockKeyhole size={22} aria-hidden="true" />
        <div>
          <strong>Uso profissional</strong>
          <p>
            O conversor suporta etiquetas de marketplaces, transportadoras e sistemas ERP que geram
            ZPL padrão.
          </p>
        </div>
      </article>
      <article>
        <FileText size={22} aria-hidden="true" />
        <div>
          <strong>Perguntas rápidas</strong>
          <p>
            Use 203 dpi para impressoras térmicas comuns. Se a etiqueta cortar, teste encaixar,
            margem maior ou rotação.
          </p>
        </div>
      </article>
    </section>
  );
}

function FileItem({ item, onRemove }) {
  const Icon = item.file.name.toLowerCase().endsWith(".zip") ? FileArchive : FileText;

  return (
    <div className="file-card">
      <Icon size={24} aria-hidden="true" />
      <div>
        <strong>{item.file.name}</strong>
        <span>{formatBytes(item.file.size)}</span>
      </div>
      <button className="icon-button" onClick={onRemove} aria-label={`Remover ${item.file.name}`}>
        <X size={18} />
      </button>
    </div>
  );
}

function loadStored(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function triggerDownload(url, name) {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

createRoot(document.getElementById("root")).render(<App />);
