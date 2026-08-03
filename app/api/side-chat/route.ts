import { NextResponse } from "next/server";
import { openSideChat, setSideChatToolMode, type SideChatAction } from "@/lib/side-chat-manager";
import type { SideChatToolMode } from "@/lib/side-chat-metadata";

type SideChatRequest = {
  action?: SideChatAction | "set_mode";
  mainSessionId?: string;
  toolMode?: SideChatToolMode;
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as SideChatRequest;
    if (!body.mainSessionId) {
      return NextResponse.json({ error: "mainSessionId is required" }, { status: 400 });
    }

    if (body.action === "set_mode") {
      if (body.toolMode !== "readonly" && body.toolMode !== "edit") {
        return NextResponse.json({ error: "toolMode must be readonly or edit" }, { status: 400 });
      }
      return NextResponse.json(await setSideChatToolMode(body.mainSessionId, body.toolMode));
    }

    if (body.action !== "open" && body.action !== "refork" && body.action !== "clear") {
      return NextResponse.json({ error: "Unsupported Side Chat action" }, { status: 400 });
    }
    return NextResponse.json(await openSideChat(body.mainSessionId, body.action));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
