"use client";

import { useEffect, useRef, useState, useCallback, useMemo, type RefObject } from "react";
import { createPortal } from "react-dom";
import { splitFinalAssistantBlocks } from "@/lib/message-display";
import type { AgentMessage, AssistantMessage, TextContent, UserMessage } from "@/lib/types";
import styles from "./ChatMinimap.module.css";

interface Props {
  messages: AgentMessage[];
  streamingMessage: Partial<AgentMessage> | null;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  onRevealHistory: () => void;
  /** Hide while a right-side panel (side chat / file) is open. */
  hidden?: boolean;
}

const PREVIEW_HIDE_DELAY = 180;
const NAVIGATION_ACTIVE_LOCK_MS = 1600;
const MAX_ROW_HEIGHT = 50;
const MIN_ROW_HEIGHT = 10;

interface AssistantPreview {
  text: string;
  element: HTMLDivElement | null;
}

interface TurnInfo {
  userMessage: UserMessage;
  userPreview: string;
  assistantPreviews: AssistantPreview[];
  scrollTop: number | null;
  element: HTMLDivElement | null;
}

interface NodeInfo {
  targetTurn: TurnInfo;
  index: number;
}

function getUserPreview(message: UserMessage): string {
  if (typeof message.content === "string") return message.content.trim();
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function getAssistantAnswerText(message: AgentMessage | Partial<AgentMessage>): string {
  if (message.role !== "assistant") return "";
  const { answerBlocks } = splitFinalAssistantBlocks(message as AssistantMessage);
  return answerBlocks
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function ChatMinimap({
  messages,
  streamingMessage,
  scrollContainer,
  messageRefs,
  onRevealHistory,
  hidden = false,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  const railRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<NodeInfo[]>([]);
  const previewHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeNodeLockRef = useRef<{ index: number; until: number } | null>(null);
  const scrubbingRef = useRef(false);
  const pendingNavigationRef = useRef<{
    nodeIndex: number;
    target: "user" | "assistant";
    assistantIndex?: number;
  } | null>(null);

  const allMessages = useMemo(
    () => (streamingMessage ? [...messages, streamingMessage] : messages) as (AgentMessage | Partial<AgentMessage>)[],
    [messages, streamingMessage],
  );
  const allMessagesRef = useRef(allMessages);
  allMessagesRef.current = allMessages;

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const lockActiveNode = useCallback((index: number) => {
    activeNodeLockRef.current = {
      index,
      until: Date.now() + NAVIGATION_ACTIVE_LOCK_MS,
    };
    setActiveIndex(index);
  }, []);

  const syncActiveNode = useCallback((scrollEl: HTMLDivElement, nextNodes: NodeInfo[]) => {
    const activeLock = activeNodeLockRef.current;
    if (activeLock && Date.now() < activeLock.until) {
      setActiveIndex(activeLock.index);
      return;
    }
    activeNodeLockRef.current = null;

    const measured = nextNodes.filter((node) => node.targetTurn.scrollTop !== null);
    if (measured.length === 0) {
      setActiveIndex(null);
      return;
    }
    const focusTop = scrollEl.scrollTop + scrollEl.clientHeight * 0.3;
    const nextActive = measured.reduce((best, node) => (
      Math.abs((node.targetTurn.scrollTop ?? 0) - focusTop)
        < Math.abs((best.targetTurn.scrollTop ?? 0) - focusTop)
        ? node
        : best
    ), measured[0]);
    setActiveIndex(nextActive.index);
  }, []);

  const updateScroll = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const scrollable = scrollEl.scrollHeight - scrollEl.clientHeight;
    setVisible(scrollable > 20);
    syncActiveNode(scrollEl, nodesRef.current);
  }, [scrollContainer, syncActiveNode]);

  const measureThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureNodes = useCallback(() => {
    if (measureThrottleRef.current) return;
    measureThrottleRef.current = setTimeout(() => {
      measureThrottleRef.current = null;
      const scrollEl = scrollContainer.current;
      if (!scrollEl) return;

      const refs = messageRefs.current;
      const containerRect = scrollEl.getBoundingClientRect();
      const turns: TurnInfo[] = [];
      let refIndex = 0;
      let currentTurn: TurnInfo | null = null;

      for (const message of allMessagesRef.current) {
        if (message.role !== "user" && message.role !== "assistant") continue;
        const element = refs?.[refIndex] ?? null;
        refIndex += 1;

        if (message.role === "user") {
          const elementRect = element?.getBoundingClientRect();
          currentTurn = {
            userMessage: message as UserMessage,
            userPreview: getUserPreview(message as UserMessage),
            assistantPreviews: [],
            scrollTop: elementRect
              ? elementRect.top - containerRect.top + scrollEl.scrollTop
              : null,
            element,
          };
          turns.push(currentTurn);
          continue;
        }

        if (!currentTurn) continue;
        const answerText = getAssistantAnswerText(message);
        if (answerText) {
          currentTurn.assistantPreviews.push({
            text: answerText,
            element,
          });
        }
      }

      const nextNodes: NodeInfo[] = turns.map((turn, index) => ({
        targetTurn: turn,
        index,
      }));
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      setVisible(scrollEl.scrollHeight - scrollEl.clientHeight > 20);
      syncActiveNode(scrollEl, nextNodes);

      const pending = pendingNavigationRef.current;
      const pendingNode = pending ? nextNodes[pending.nodeIndex] : null;
      if (pending && pendingNode) {
        let targetTop = pendingNode.targetTurn.scrollTop;
        if (pending.target === "assistant") {
          const assistant = pending.assistantIndex === undefined
            ? null
            : pendingNode.targetTurn.assistantPreviews[pending.assistantIndex];
          const assistantRect = assistant?.element?.getBoundingClientRect();
          targetTop = assistantRect
            ? assistantRect.top - containerRect.top + scrollEl.scrollTop
            : null;
        }
        if (targetTop == null) return;
        pendingNavigationRef.current = null;
        lockActiveNode(pendingNode.index);
        scrollEl.scrollTo({
          top: Math.max(0, targetTop - scrollEl.clientHeight * 0.3),
          behavior: "smooth",
        });
      }
    }, 120);
  }, [lockActiveNode, messageRefs, scrollContainer, syncActiveNode]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    el.addEventListener("scroll", updateScroll, { passive: true });
    return () => el.removeEventListener("scroll", updateScroll);
  }, [scrollContainer, updateScroll]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    const syncLayout = () => {
      measureNodes();
      updateScroll();
    };
    const ro = new ResizeObserver(syncLayout);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    syncLayout();
    return () => {
      ro.disconnect();
      if (measureThrottleRef.current) {
        clearTimeout(measureThrottleRef.current);
        measureThrottleRef.current = null;
      }
    };
  }, [measureNodes, scrollContainer, updateScroll]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      measureNodes();
      updateScroll();
    }, 50);
    return () => clearTimeout(timeout);
  }, [messages.length, measureNodes, updateScroll]);

  const scrollToNode = useCallback((node: NodeInfo, behavior: ScrollBehavior) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    lockActiveNode(node.index);
    if (node.targetTurn.scrollTop == null) {
      pendingNavigationRef.current = { nodeIndex: node.index, target: "user" };
      onRevealHistory();
      return;
    }
    scrollEl.scrollTo({
      top: Math.max(0, node.targetTurn.scrollTop - scrollEl.clientHeight * 0.3),
      behavior,
    });
  }, [lockActiveNode, onRevealHistory, scrollContainer]);

  const scrollToAssistant = useCallback((node: NodeInfo, assistantIndex = 0) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const assistantElement = node.targetTurn.assistantPreviews[assistantIndex]?.element;
    if (!assistantElement) {
      pendingNavigationRef.current = {
        nodeIndex: node.index,
        target: "assistant",
        assistantIndex,
      };
      onRevealHistory();
      return;
    }
    const containerRect = scrollEl.getBoundingClientRect();
    const assistantRect = assistantElement.getBoundingClientRect();
    const targetTop = (
      assistantRect.top
      - containerRect.top
      + scrollEl.scrollTop
      - scrollEl.clientHeight * 0.3
    );
    lockActiveNode(node.index);
    scrollEl.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  }, [lockActiveNode, onRevealHistory, scrollContainer]);

  const cancelPreviewHide = useCallback(() => {
    if (!previewHideTimerRef.current) return;
    clearTimeout(previewHideTimerRef.current);
    previewHideTimerRef.current = null;
  }, []);

  const schedulePreviewHide = useCallback(() => {
    cancelPreviewHide();
    previewHideTimerRef.current = setTimeout(() => {
      previewHideTimerRef.current = null;
      if (scrubbingRef.current) return;
      setHoveredIndex(null);
      setTooltipPos(null);
    }, PREVIEW_HIDE_DELAY);
  }, [cancelPreviewHide]);

  useEffect(() => () => cancelPreviewHide(), [cancelPreviewHide]);

  const positionTooltipForRow = useCallback((row: HTMLElement) => {
    const rect = row.getBoundingClientRect();
    const tooltipWidth = Math.min(320, window.innerWidth - 16);
    const left = clamp(rect.right + 8, 8, window.innerWidth - tooltipWidth - 8);
    const top = clamp(rect.top + rect.height / 2, 24, window.innerHeight - 24);
    setTooltipPos({ top, left });
  }, []);

  const showNodePreview = useCallback((index: number, row: HTMLElement) => {
    cancelPreviewHide();
    setHoveredIndex(index);
    positionTooltipForRow(row);
  }, [cancelPreviewHide, positionTooltipForRow]);

  const findNearestRowIndex = useCallback((clientY: number): number | null => {
    const rail = railRef.current;
    if (!rail || nodesRef.current.length === 0) return null;
    const buttons = rail.querySelectorAll<HTMLButtonElement>("[data-minimap-node-index]");
    if (buttons.length === 0) return null;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    buttons.forEach((button) => {
      const rect = button.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const distance = Math.abs(mid - clientY);
      const index = Number(button.dataset.minimapNodeIndex);
      if (!Number.isFinite(index)) return;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rail = railRef.current;
    if (!rail) return;
    scrubbingRef.current = true;
    setScrubIndex(hoveredIndex);
    rail.setPointerCapture(event.pointerId);

    const jump = (clientY: number, behavior: ScrollBehavior) => {
      const index = findNearestRowIndex(clientY);
      if (index == null) return;
      const node = nodesRef.current[index];
      if (!node) return;
      setScrubIndex(index);
      setHoveredIndex(index);
      const row = rail.querySelector<HTMLElement>(`[data-minimap-node-index="${index}"]`);
      if (row) positionTooltipForRow(row);
      scrollToNode(node, behavior);
    };

    jump(event.clientY, "smooth");

    const onMove = (moveEvent: PointerEvent) => {
      if (!scrubbingRef.current) return;
      jump(moveEvent.clientY, "auto");
    };
    const onUp = (upEvent: PointerEvent) => {
      scrubbingRef.current = false;
      setScrubIndex(null);
      try {
        rail.releasePointerCapture(upEvent.pointerId);
      } catch {
        // ignore
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [findNearestRowIndex, hoveredIndex, positionTooltipForRow, scrollToNode]);

  if (hidden || !visible || nodes.length === 0) return null;

  const previewNode = hoveredIndex == null ? null : nodes[hoveredIndex] ?? null;
  const assistantPreview = previewNode?.targetTurn.assistantPreviews[0]?.text ?? "";
  const userLabel = previewNode?.targetTurn.userPreview ?? "";

  const rail = (
    <nav
      ref={railRef}
      data-chat-minimap=""
      data-scrubbing={scrubIndex != null ? "" : undefined}
      className={styles.rail}
      aria-label="Conversation navigation"
      onPointerDown={handlePointerDown}
      onPointerLeave={() => {
        if (!scrubbingRef.current) schedulePreviewHide();
      }}
    >
      {nodes.map((node) => {
        const isCurrent = activeIndex === node.index;
        const isScrubTarget = scrubIndex === node.index;
        return (
          <button
            key={node.index}
            type="button"
            className={styles.row}
            data-minimap-node-index={node.index}
            data-scrub-target={isScrubTarget ? "" : undefined}
            aria-current={isCurrent ? "true" : undefined}
            aria-label={`Jump to message ${node.index + 1}`}
            style={{ minHeight: MIN_ROW_HEIGHT, maxHeight: MAX_ROW_HEIGHT }}
            onMouseEnter={(event) => showNodePreview(node.index, event.currentTarget)}
            onFocus={(event) => showNodePreview(node.index, event.currentTarget)}
            onMouseLeave={() => {
              if (!scrubbingRef.current) schedulePreviewHide();
            }}
            onClick={() => scrollToNode(node, "smooth")}
          >
            <span className={styles.markerTrack}>
              <span className={styles.marker} />
            </span>
          </button>
        );
      })}
    </nav>
  );

  const tooltip = previewNode && tooltipPos && portalReady
    ? createPortal(
      <div
        className={styles.tooltip}
        data-minimap-preview-box=""
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
          transform: "translateY(-50%)",
        }}
        onMouseEnter={cancelPreviewHide}
        onMouseLeave={schedulePreviewHide}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={styles.userLabel}
          onClick={() => scrollToNode(previewNode, "smooth")}
          title={userLabel || "(No content)"}
        >
          {userLabel || <span className={styles.emptyLabel}>(No content)</span>}
        </button>
        {assistantPreview ? (
          <div
            className={styles.assistantPreview}
            role="button"
            tabIndex={0}
            onClick={() => scrollToAssistant(previewNode, 0)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                scrollToAssistant(previewNode, 0);
              }
            }}
          >
            {assistantPreview}
          </div>
        ) : null}
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      {rail}
      {tooltip}
    </>
  );
}

// Hook to create a stable array of refs for messages
export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  refs.current = Array(count).fill(null).map((_, i) => refs.current[i] ?? null);
  return refs;
}
