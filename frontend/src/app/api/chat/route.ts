import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { NextResponse } from "next/server";
import { getSession, isSameOrigin } from "@/lib/auth";
import { noStore } from "@/lib/auth-http";
import { allowChatRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_TEXT_CHARS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STREAM_HEADERS = { ...noStore, "Content-Type": "text/event-stream; charset=utf-8" };

const clients = new Map<string, BedrockAgentCoreClient>();

/** Deployed AgentCore runtime for docket_chat. Credentials come from the AWS CLI login locally and the SSR role on Amplify. */
function runtimeArn(): string | null {
  const arn = process.env.DOCKET_CHAT_RUNTIME_ARN?.trim();
  return arn && arn.startsWith("arn:aws:bedrock-agentcore:") ? arn : null;
}

/** Local DOCKET FastAPI chat endpoint. Anything but localhost counts as unset, so the route cannot proxy elsewhere. */
function localChatUrl(): string | null {
  const raw = process.env.DOCKET_CHAT_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return isHttp && isLocal ? url.toString() : null;
  } catch {
    return null;
  }
}

function agentCoreClient(region: string): BedrockAgentCoreClient {
  let client = clients.get(region);
  if (!client) {
    client = new BedrockAgentCoreClient({ region });
    clients.set(region, client);
  }
  return client;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site requests are not accepted." }, { status: 403 });
  }
  if (!allowChatRequest(request)) {
    return NextResponse.json({ error: "Too many messages. Try again shortly." }, { status: 429, headers: noStore });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the message as JSON." }, { status: 400, headers: noStore });
  }
  const { text, session_id: requestedSession } = (body ?? {}) as { text?: unknown; session_id?: unknown };
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_CHARS) {
    return NextResponse.json({ error: "Messages must be 1 to 2000 characters." }, { status: 400, headers: noStore });
  }

  const sessionId = typeof requestedSession === "string" && UUID.test(requestedSession) ? requestedSession : crypto.randomUUID();
  // Identity comes only from the signed session cookie, never from the request body.
  const session = await getSession();
  const prompt = text.trim();

  const arn = runtimeArn();
  const localUrl = arn ? null : localChatUrl();
  try {
    if (arn) {
      const region = arn.split(":")[3];
      const result = await agentCoreClient(region).send(
        new InvokeAgentRuntimeCommand({
          agentRuntimeArn: arn,
          runtimeSessionId: sessionId,
          contentType: "application/json",
          accept: "text/event-stream",
          payload: new TextEncoder().encode(JSON.stringify({ prompt, session_id: sessionId, user_id: session?.memberId })),
        }),
      );
      if (!result.response) throw new Error("empty agent response");
      return new Response(result.response.transformToWebStream(), { headers: STREAM_HEADERS });
    }
    if (localUrl) {
      const upstream = await fetch(localUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: prompt, session_id: sessionId, user_id: session?.memberId }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!upstream.ok || !upstream.body) throw new Error(`chat backend returned ${upstream.status}`);
      return new Response(upstream.body, { headers: STREAM_HEADERS });
    }
  } catch (error) {
    console.error("[docket] chat: agent call failed", error);
    return NextResponse.json({ error: "The assistant is unavailable right now." }, { status: 502, headers: noStore });
  }
  return NextResponse.json({ error: "The assistant is not connected." }, { status: 503, headers: noStore });
}
