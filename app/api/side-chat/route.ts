import { NextResponse } from "next/server";
import { openSideChat, type SideChatAction } from "@/lib/side-chat-manager";
import { normalizeSideChatToolMode, type SideChatToolMode } from "@/lib/side-chat-metadata";

type SideChatRequest = {
  action?: SideChatAction;
  mainSessionId?: string;
  sideSessionId?: string;
  toolMode?: SideChatToolMode;
  message?: string;
  forceNew?: boolean;
};

const ACTIONS: SideChatAction[] = [
  "open",
  "create",
  "refork",
  "clear",
  "set_mode",
  "touch",
  "send",
];

export async function POST(request: Request) {
  try {
    const body = await request.json() as SideChatRequest;
    if (!body.mainSessionId) {
      return NextResponse.json({ error: "mainSessionId is required" }, { status: 400 });
    }

    if (!body.action || !ACTIONS.includes(body.action)) {
      return NextResponse.json({ error: "Unsupported Side Chat action" }, { status: 400 });
    }

    const result = await openSideChat({
      action: body.action,
      mainSessionId: body.mainSessionId,
      ...(body.sideSessionId ? { sideSessionId: body.sideSessionId } : {}),
      ...(body.toolMode ? { toolMode: normalizeSideChatToolMode(body.toolMode) } : {}),
      ...(typeof body.message === "string" ? { message: body.message } : {}),
      ...(body.forceNew ? { forceNew: true } : {}),
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
