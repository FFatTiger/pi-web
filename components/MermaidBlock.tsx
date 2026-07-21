"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type WheelEvent } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { copyText } from "@/lib/clipboard";

interface MermaidBlockProps {
  code: string;
  isStreaming?: boolean;
}

/**
 * Renders a Mermaid diagram from a fenced code block.
 * Shows source code by default with a "Preview" toggle.
 * When preview is active, dynamically imports mermaid and renders to SVG.
 */
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const FIT_PADDING = 0.9; // 90% of viewport reserved for the diagram when fitting

export function MermaidBlock({ code, isStreaming }: MermaidBlockProps) {
  const { isDark } = useTheme();
  const [showPreview, setShowPreview] = useState(true);
  const [svg, setSvg] = useState<string | null>(null);
  const [renderedKey, setRenderedKey] = useState("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ active: false, startX: 0, startY: 0, panStartX: 0, panStartY: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const fitDoneRef = useRef(false);
  const currentKey = `${isDark ? "dark" : "light"}\n${code}`;

  // Fit-to-screen: measure SVG natural size and scale to fit viewport.
  useEffect(() => {
    if (!zoomOpen || !canvasRef.current || fitDoneRef.current) return;
    const raf = requestAnimationFrame(() => {
      const svgEl = canvasRef.current?.querySelector("svg");
      if (!svgEl) return;
      const vw = window.innerWidth * FIT_PADDING;
      const vh = window.innerHeight * FIT_PADDING;
      const rect = svgEl.getBoundingClientRect();
      const sw = rect.width || 800;
      const sh = rect.height || 600;
      // Fit the smaller axis; no upper bound — let the diagram fill the viewport.
      const fit = Math.min(vw / sw, vh / sh);
      const scale = Math.max(ZOOM_MIN, fit);
      setZoomLevel(scale);
      setPan({ x: 0, y: 0 });
      fitDoneRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [zoomOpen, svg]);

  // Zoom modal: lock body scroll and handle Escape key.
  useEffect(() => {
    if (!zoomOpen) return;

    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeZoom();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [zoomOpen]);

  useEffect(() => {
    if (!showPreview || isStreaming) return;

    let cancelled = false;
    setFailedKey(null);

    const render = async () => {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: isDark ? "dark" : "default",
      });

      const parsed = await mermaid.parse(code, { suppressErrors: true });
      if (!parsed) throw new Error("Invalid Mermaid diagram");

      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `mermaid-${crypto.randomUUID()}`
          : `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await mermaid.render(id, code);
      if (!cancelled) {
        setSvg(result.svg);
        setRenderedKey(currentKey);
      }
    };

    render().catch(() => {
      if (!cancelled) setFailedKey(currentKey);
    });

    return () => {
      cancelled = true;
    };
  }, [code, isDark, isStreaming, showPreview]);

  const previewButton = (
    <button
      onClick={() => setShowPreview((v) => !v)}
      disabled={isStreaming}
      title={isStreaming ? "Preview available after streaming" : (showPreview ? "Show Mermaid source" : "Preview Mermaid diagram")}
      className={["markdown-code-action", showPreview ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      {showPreview ? "Source" : "Preview"}
    </button>
  );

  if (!showPreview || isStreaming) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} />;
  }

  const closeZoom = () => {
    setZoomOpen(false);
    setZoomLevel(1);
    setPan({ x: 0, y: 0 });
  };

  const resetZoom = () => {
    setZoomLevel(1);
    setPan({ x: 0, y: 0 });
  };

  // Wheel zoom inside the modal — no upper bound.
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    setZoomLevel((z) => Math.max(ZOOM_MIN, z - e.deltaY * 0.002));
  };

  // Drag-to-pan inside the modal.
  const handleMouseDown = (e: MouseEvent) => {
    // Only left button.
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      panStartX: pan.x,
      panStartY: pan.y,
    };
  };

  useEffect(() => {
    if (!zoomOpen) return;
    const onMove = (e: globalThis.MouseEvent) => {
      if (!dragRef.current.active) return;
      setPan({
        x: dragRef.current.panStartX + (e.clientX - dragRef.current.startX),
        y: dragRef.current.panStartY + (e.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => {
      dragRef.current.active = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [zoomOpen, pan.x, pan.y]);

  const body =
    failedKey === currentKey ? (
      <div className="mermaid-block mermaid-block-error">Invalid Mermaid diagram</div>
    ) : !svg || renderedKey !== currentKey ? (
      <div className="mermaid-block mermaid-block-loading" aria-label="Rendering Mermaid diagram" />
    ) : (
      <>
        {/* Clickable inline preview — opens zoom modal */}
        <div
          className="mermaid-block mermaid-block-clickable"
          style={{ cursor: "pointer" }}
          title="Click to zoom"
          onClick={() => { setZoomOpen(true); fitDoneRef.current = false; }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {/* Zoom modal */}
        {zoomOpen && (
          <div
            className="mermaid-zoom-backdrop"
            onClick={(e) => {
              // Close only when clicking the backdrop, not the SVG inside.
              if (e.target === e.currentTarget) closeZoom();
            }}
          >
            <div className="mermaid-zoom-toolbar">
              <button
                style={{ touchAction: "manipulation" }}
                onClick={() => setZoomLevel((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
                disabled={zoomLevel <= ZOOM_MIN}
                title="Zoom out"
              >
                -
              </button>
              <span style={{ fontSize: 12, minWidth: 48, textAlign: "center", userSelect: "none" }}>
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                style={{ touchAction: "manipulation" }}
                onClick={() => setZoomLevel((z) => z + ZOOM_STEP)}
                title="Zoom in"
              >
                +
              </button>
              <button
                style={{ touchAction: "manipulation", marginLeft: 8 }}
                onClick={resetZoom}
                title="Reset zoom & pan"
              >
                reset
              </button>
            </div>
            <div
              ref={canvasRef}
              className="mermaid-zoom-canvas"
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomLevel})`,
                cursor: dragRef.current.active ? "grabbing" : "grab",
              }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        )}
      </>
    );

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">mermaid</span>
        {previewButton}
      </div>
      {body}
    </div>
  );
}

interface CodeBlockProps {
  code: string;
  lang: string;
  headerAction?: ReactNode;
}

/**
 * Syntax-highlighted code block with copy button.
 * Used as the "source" view for mermaid blocks and for all non-mermaid code fences.
 */
export function CodeBlock({ code, lang, headerAction }: CodeBlockProps) {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    copyText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{lang || "text"}</span>
        <div className="markdown-code-actions">
          {headerAction}
          <button
            onClick={copy}
            className="markdown-code-action"
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        language={lang || "text"}
        style={isDark ? vscDarkPlus : vs}
        showLineNumbers
        lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal" }}
        customStyle={{
          margin: 0,
          padding: "11px 13px",
          fontSize: 12.5,
          lineHeight: 1.62,
          borderRadius: 0,
          background: "color-mix(in srgb, var(--bg) 92%, var(--bg-panel))",
        }}
        codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
