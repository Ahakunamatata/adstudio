import { NextResponse } from "next/server";
import { executeControlledGenerationTask } from "@/features/agent-runtime/generation-executor";
import { createSupabaseMediaStorageProviderFromEnv } from "@/features/agent-runtime/supabase-media-storage";
import { createServerAgentProjectStore } from "@/lib/agent-project-server-store";
import {
  createGenerationRouteResponse,
  createM54ViduProvider,
  getM54Gate,
  parseControlledGenerationRequest
} from "../route-helpers";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function forbiddenGateResponse() {
  const gate = getM54Gate();
  return NextResponse.json({
    ok: false,
    status: "blocked",
    blocker: "M5.4 Workbench real Vidu generation is disabled until explicit server env gates are set.",
    requiredEnv: gate.requiredEnv,
    requiredConfirmValue: gate.requiredConfirmValue,
    enabled: gate.enabled,
    confirmed: gate.confirmed,
    realProviderCalls: 0,
    oldViduRouteCalls: 0
  }, { status: 403 });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as unknown;
  if (!isRecord(body)) {
    return NextResponse.json({ ok: false, error: "Invalid generation execute request." }, { status: 400 });
  }

  const projectId = stringOrUndefined(body.projectId);
  const approvalRequestId = stringOrUndefined(body.approvalRequestId);
  const actionHash = stringOrUndefined(body.actionHash);
  const idempotencyKey = stringOrUndefined(body.idempotencyKey);
  const generation = parseControlledGenerationRequest(body.generation);

  if (!projectId || !approvalRequestId || !actionHash || !idempotencyKey || !generation) {
    return NextResponse.json({ ok: false, error: "Missing generation approval execution fields." }, { status: 400 });
  }

  if (!getM54Gate().ready) return forbiddenGateResponse();

  const now = new Date().toISOString();
  const store = createServerAgentProjectStore();
  const bundle = await store.loadProject(projectId);
  if (!bundle) {
    return NextResponse.json({ ok: false, blocker: `Agent project not found: ${projectId}.`, realProviderCalls: 0, oldViduRouteCalls: 0 }, { status: 404 });
  }

  const approval = bundle.approvalRequests.find((record) => record.id === approvalRequestId);
  if (!approval) {
    return NextResponse.json({ ok: false, blocker: `Approval request not found: ${approvalRequestId}.`, realProviderCalls: 0, oldViduRouteCalls: 0 }, { status: 404 });
  }
  if (approval.kind !== "generation") {
    return NextResponse.json({ ok: false, blocker: "Only generation approvals can execute real Vidu generation.", realProviderCalls: 0, oldViduRouteCalls: 0 }, { status: 409 });
  }
  if (approval.actionHash !== actionHash || approval.idempotencyKey !== idempotencyKey) {
    return NextResponse.json({ ok: false, blocker: "确认内容已过期：approval hash 与执行请求不一致。", realProviderCalls: 0, oldViduRouteCalls: 0 }, { status: 409 });
  }
  if (approval.status === "rejected") {
    return NextResponse.json({ ok: false, blocker: "该生成方案已被拒绝，不能执行。", realProviderCalls: 0, oldViduRouteCalls: 0 }, { status: 409 });
  }

  const approved = approval.status === "pending"
    ? await store.updateApprovalStatus({
        projectId,
        approvalRequestId,
        status: "approved",
        respondedBy: stringOrUndefined(body.actorId) ?? "user",
        respondedAt: now,
        actualCredits: 0
      })
    : approval;
  const latestBundle = await store.loadProject(projectId) ?? bundle;
  const transportCounter = { count: 0 };
  const provider = createM54ViduProvider(latestBundle, transportCounter, approved.estimatedCredits ?? 0);

  const result = await executeControlledGenerationTask(store, {
    projectId,
    approvalRequestId,
    actionHash,
    idempotencyKey,
    generation,
    provider,
    mediaStorageProvider: createSupabaseMediaStorageProviderFromEnv(),
    allowLiveProvider: true,
    actorId: stringOrUndefined(body.actorId) ?? "user",
    now
  });

  return NextResponse.json(
    createGenerationRouteResponse(result, transportCounter.count),
    { status: result.ok ? 200 : 502 }
  );
}
