import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  CheckCircle2,
  FileArchive,
  FileText,
  LoaderCircle,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  UploadCloud,
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

function App() {
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [pageSize, setPageSize] = useState("10x15");
  const [density, setDensity] = useState("8");
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  const totalSize = useMemo(() => files.reduce((sum, item) => sum + item.file.size, 0), [files]);
  const canConvert = files.length > 0 && !isConverting;

  function selectFiles(fileList) {
    setError("");
    setResult(null);

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

    if (accepted.length) {
      setFiles((current) => [...current, ...accepted]);
    }

    if (rejected.length) {
      setError("Alguns arquivos foram ignorados. Use apenas .zpl, .txt ou .zip.");
    }
  }

  async function convertFiles() {
    if (!files.length) {
      setError("Selecione ao menos um arquivo para converter.");
      return;
    }

    setIsConverting(true);
    setError("");
    setResult(null);

    const formData = new FormData();
    files.forEach((item) => formData.append("files", item.file));
    formData.append("pageSize", pageSize);
    formData.append("density", density);

    try {
      const response = await fetch(`${API_URL}/api/convert`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Não foi possível converter estes arquivos.");
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const labelCount = response.headers.get("X-Label-Count") || "1";
      const sourceCount = response.headers.get("X-Source-Count") || String(files.length);
      const finalPageSize = response.headers.get("X-Page-Size") || currentPageSizeLabel();
      const name = buildDownloadName();
      const nextResult = {
        url: downloadUrl,
        labelCount,
        sourceCount,
        pageSize: finalPageSize,
        name,
        createdAt: new Date().toLocaleString("pt-BR", {
          dateStyle: "short",
          timeStyle: "short"
        })
      };

      setResult(nextResult);
      setHistory((current) => [nextResult, ...current].slice(0, 5));
    } catch (conversionError) {
      setError(conversionError.message);
    } finally {
      setIsConverting(false);
    }
  }

  function removeFile(id) {
    setFiles((current) => current.filter((item) => item.id !== id));
    setResult(null);
  }

  function clearAll() {
    setFiles([]);
    setError("");
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function buildDownloadName() {
    if (files.length === 1) {
      return `${files[0].file.name.replace(/\.[^.]+$/, "") || "etiquetas"}-${pageSize}.pdf`;
    }

    return `etiquetas-convertidas-${pageSize}.pdf`;
  }

  function currentPageSizeLabel() {
    return PAGE_SIZES.find((item) => item.value === pageSize)?.label || "10 x 15 cm";
  }

  return (
    <main className="page-shell">
      <section className="workspace">
        <aside className="intro-panel">
          <span className="eyebrow">Conversor ZPL online</span>
          <h1>ZPL para PDF profissional</h1>
          <p>
            Envie um ou vários arquivos de etiquetas, ajuste o formato de impressão e baixe um PDF
            pronto para usar.
          </p>

          <div className="stats-grid" aria-label="Recursos do conversor">
            <article>
              <FileText size={21} aria-hidden="true" />
              <div>
                <strong>Blocos ^XA/^XZ</strong>
                <span>Separa múltiplas etiquetas automaticamente.</span>
              </div>
            </article>
            <article>
              <FileArchive size={21} aria-hidden="true" />
              <div>
                <strong>ZIP, TXT e ZPL</strong>
                <span>Processa arquivos avulsos ou compactados.</span>
              </div>
            </article>
            <article>
              <ShieldCheck size={21} aria-hidden="true" />
              <div>
                <strong>PDF padronizado</strong>
                <span>Gera páginas no tamanho selecionado.</span>
              </div>
            </article>
          </div>
        </aside>

        <section className="converter-panel" aria-label="Conversor de etiquetas ZPL para PDF">
          <div className="panel-header">
            <div>
              <strong>Arquivos para conversão</strong>
              <span>
                {files.length ? `${files.length} arquivo(s), ${formatBytes(totalSize)}` : "Nenhum arquivo selecionado"}
              </span>
            </div>
            {files.length > 0 && (
              <button className="ghost-button" onClick={clearAll}>
                <Trash2 size={17} aria-hidden="true" />
                Limpar
              </button>
            )}
          </div>

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

          <section className="options-panel" aria-label="Opções de conversão">
            <div className="section-title">
              <Settings2 size={19} aria-hidden="true" />
              <strong>Configurações</strong>
            </div>

            <label>
              Tamanho da página
              <select value={pageSize} onChange={(event) => setPageSize(event.target.value)}>
                {PAGE_SIZES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="density-group" role="group" aria-label="Resolução da impressora">
              {DENSITIES.map((item) => (
                <button
                  key={item.value}
                  className={density === item.value ? "is-selected" : ""}
                  onClick={() => setDensity(item.value)}
                  type="button"
                >
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </button>
              ))}
            </div>
          </section>

          {error && <p className="message error">{error}</p>}

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
            <button className="primary-button" onClick={convertFiles} disabled={!canConvert}>
              {isConverting ? (
                <>
                  <LoaderCircle className="spin" size={20} aria-hidden="true" />
                  Convertendo
                </>
              ) : (
                <>
                  <ArrowDownToLine size={20} aria-hidden="true" />
                  Converter para PDF
                </>
              )}
            </button>

            <button className="secondary-button" onClick={() => inputRef.current?.click()}>
              <Plus size={19} aria-hidden="true" />
              Adicionar
            </button>

            {result && (
              <a className="download-button" href={result.url} download={result.name}>
                Baixar PDF
              </a>
            )}
          </div>
        </section>
      </section>

      {history.length > 0 && (
        <section className="history-panel" aria-label="Histórico da sessão">
          <div className="section-title">
            <CheckCircle2 size={19} aria-hidden="true" />
            <strong>Últimas conversões</strong>
          </div>
          <div className="history-list">
            {history.map((item) => (
              <a key={`${item.createdAt}-${item.name}`} href={item.url} download={item.name}>
                <span>{item.name}</span>
                <small>
                  {item.labelCount} etiqueta(s) - {item.createdAt}
                </small>
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
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

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

createRoot(document.getElementById("root")).render(<App />);
