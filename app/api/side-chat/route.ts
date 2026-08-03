import { NextResponse } from "next/server";
import { openSideChat, type SideChatAction } from "@/lib/side-chat-manager";

type SideChatRequest = {
  action?: SideChatAction;
  mainSessionId?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as SideChatRequest;
    if (!body.mainSessionId) {
      return NextResponse.json({ error: "mainSessionId is required" }, { status: 400 });
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
