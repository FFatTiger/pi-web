"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

/**
 * Codex app-shell panel animation:
 * - outer shell animates width/opacity with spring { duration: 0.5, bounce: 0.1 }
 * - inner content keeps a fixed target width so the tree does not reflow every frame
 */
export const CODEX_PANEL_SPRING = {
  type: "spring" as const,
  duration: 0.5,
  bounce: 0.1,
};

export const CODEX_PANEL_INSTANT = {
  type: "tween" as const,
  duration: 0,
};

interface MotionPanelShellProps {
  open: boolean;
  /** Target content width in px while open (regular mode). */
  targetWidth: number;
  side: "left" | "right";
  /** Maximize/full-width mode skips width tween and fills remaining row. */
  maximized?: boolean;
  /** Disable animation while the user is actively resizing. */
  isResizing?: boolean;
  /**
   * When false, render a static shell and let CSS transform handle open/close
   * (compact overlay / mobile). Desktop split layout should pass true.
   */
  motionEnabled?: boolean;
  className?: string;
  style?: CSSProperties;
  panelRef?: React.Ref<HTMLDivElement>;
  children: ReactNode;
  id?: string;
}

export function MotionPanelShell({
  open,
  targetWidth,
  side,
  maximized = false,
  isResizing = false,
  motionEnabled = true,
  className,
  style,
  panelRef,
  children,
  id,
}: MotionPanelShellProps) {
  const reduceMotion = useReducedMotion();
  const transition = isResizing || reduceMotion ? CODEX_PANEL_INSTANT : CODEX_PANEL_SPRING;
  const contentWidth = Math.max(0, Math.round(targetWidth));
  const closedBorder = side === "left"
    ? { borderRight: "none" }
    : { borderLeft: "none" };

  // Overlay/mobile breakpoints keep CSS transform slides — don't fight them with width spring.
  if (!motionEnabled) {
    return (
      <div
        ref={panelRef}
        id={id}
        className={className}
        data-panel-motion={open ? (maximized ? "maximized" : "open") : "closed"}
        style={{
          ...style,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    );
  }

  // Maximize is a discrete layout mode in Codex (width:auto / flex:1), not a tween.
  if (maximized && open) {
    return (
      <div
        ref={panelRef}
        id={id}
        className={className}
        data-panel-motion="maximized"
        style={{
          ...style,
          flex: "1 1 auto",
          width: "auto",
          minWidth: 0,
          overflow: "hidden",
          ...(side === "right" ? { borderLeft: "none", boxShadow: "none" } : null),
        }}
      >
        <div
          className="motion-panel-shell-inner"
          style={{
            width: "100%",
            minWidth: 0,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
            contain: "layout paint",
          }}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      ref={panelRef}
      id={id}
      className={className}
      data-panel-motion={open ? "open" : "closed"}
      data-panel-side={side}
      initial={false}
      animate={{
        width: open ? contentWidth : 0,
        opacity: open ? 1 : 0,
      }}
      transition={transition}
      style={{
        ...style,
        ...(open ? null : closedBorder),
        flexShrink: 0,
        minWidth: 0,
        overflow: "hidden",
        height: "100%",
        willChange: isResizing ? "auto" : "width, opacity",
      }}
    >
      <div
        className="motion-panel-shell-inner"
        style={{
          width: contentWidth,
          minWidth: contentWidth,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
          contain: "layout paint",
        }}
      >
        {children}
      </div>
    </motion.div>
  );
}
