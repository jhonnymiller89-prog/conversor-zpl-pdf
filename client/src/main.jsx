import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  CheckCircle2,
  FileArchive,
  FileText,
  LoaderCircle,
  ShieldCheck,
  UploadCloud,
  X
} from "lucide-react";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL || "";
const ACCEPTED_EXTENSIONS = [".zpl", ".txt", ".zip"];

function App() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const fileMeta = useMemo(() => {
    if (!file) return null;
    return {
      name: file.name,
      size: formatBytes(file.size),
      icon: file.name.toLowerCase().endsWith(".zip") ? FileArchive : FileText
    };
  }, [file]);

  function selectFile(nextFile) {
    setError("");
    setResult(null);

    if (!nextFile) return;

    const isAccepted = ACCEPTED_EXTENSIONS.some((extension) =>
      nextFile.name.toLowerCase().endsWith(extension)
    );

    if (!isAccepted) {
      setFile(null);
      setError("Formato não aceito. Envie arquivos .zpl, .txt ou .zip.");
      return;
    }

    setFile(nextFile);
  }

  async function convertFile() {
    if (!file) {
      setError("Selecione um arquivo para converter.");
      return;
    }

    setIsConverting(true);
    setError("");
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${API_URL}/api/convert`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Não foi possível converter este arquivo.");
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const labelCount = response.headers.get("X-Label-Count") || "1";

      setResult({
        url: downloadUrl,
        labelCount,
        name: `${file.name.replace(/\.[^.]+$/, "") || "etiquetas"}-10x15.pdf`
      });
    } catch (conversionError) {
      setError(conversionError.message);
    } finally {
      setIsConverting(false);
    }
  }

  function clearFile() {
    setFile(null);
    setError("");
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Conversor ZPL online</span>
          <h1>ZPL para PDF 10x15 cm</h1>
          <p>
            Converta arquivos de etiqueta Zebra em um PDF pronto para baixar, com suporte a
            múltiplas etiquetas no mesmo arquivo ou dentro de um ZIP.
          </p>
        </div>

        <div className="converter-panel" aria-label="Conversor de etiquetas ZPL para PDF">
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
              selectFile(event.dataTransfer.files?.[0]);
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
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
            <div className="upload-icon">
              <UploadCloud size={34} aria-hidden="true" />
            </div>
            <strong>Arraste seu arquivo aqui</strong>
            <span>ou clique para selecionar .zpl, .txt ou .zip</span>
          </div>

          {fileMeta && (
            <div className="file-card">
              <fileMeta.icon size={25} aria-hidden="true" />
              <div>
                <strong>{fileMeta.name}</strong>
                <span>{fileMeta.size}</span>
              </div>
              <button className="icon-button" onClick={clearFile} aria-label="Remover arquivo">
                <X size={18} />
              </button>
            </div>
          )}

          {error && <p className="message error">{error}</p>}

          {result && (
            <div className="result-box">
              <CheckCircle2 size={24} aria-hidden="true" />
              <div>
                <strong>PDF gerado com sucesso</strong>
                <span>{result.labelCount} etiqueta(s) em páginas 10x15 cm</span>
              </div>
            </div>
          )}

          <div className="actions">
            <button className="primary-button" onClick={convertFile} disabled={isConverting || !file}>
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

            {result && (
              <a className="secondary-button" href={result.url} download={result.name}>
                Baixar PDF
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="trust-row" aria-label="Recursos do conversor">
        <article>
          <ShieldCheck size={22} aria-hidden="true" />
          <div>
            <strong>Formato de etiqueta</strong>
            <span>Cada página sai em 10x15 cm.</span>
          </div>
        </article>
        <article>
          <FileText size={22} aria-hidden="true" />
          <div>
            <strong>Várias etiquetas</strong>
            <span>Detecta blocos ^XA até ^XZ.</span>
          </div>
        </article>
        <article>
          <FileArchive size={22} aria-hidden="true" />
          <div>
            <strong>Arquivos ZIP</strong>
            <span>Lê .zpl e .txt compactados.</span>
          </div>
        </article>
      </section>
    </main>
  );
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

createRoot(document.getElementById("root")).render(<App />);
