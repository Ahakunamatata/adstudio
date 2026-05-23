import { NextResponse } from "next/server";
import { pollControlledGenerationTask } from "@/features/agent-runtime/generation-executor";
import { createSupabaseMediaStorageProviderFromEnv } from "@/features/agent-runtime/supabase-media-storage";
import { createServerAgentProjectStore } from "@/lib/agent-project-server-store";
import {
  createGenerationRouteResponse,
  createM54ViduProvider,
  getM54Gate
} from "../route-helpers";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isTerminalStatus(status: string | undefined) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as unknown;
  if (!isRecord(body)) {
    return NextResponse.json({ ok: false, error: "Invalid generation poll request." }, { status: 400 });
  }

  const projectId = stringOrUndefined(body.projectId);
  const taskId = stringOrUndefined(body.taskId);
  const providerTaskId = stringOrUndefined(body.providerTaskId);
  if (!projectId || (!taskId && !providerTaskId)) {
    return NextResponse.json({ ok: false, error: "Missing generation poll fields." }, { status: 400 });
  }

  const store = createServerAgentProjectStore();
  const bundle = await store.loadProject(projectId);
  if (!bundle) {
    return NextResponse.json({ ok: false, blocker: `Agent project not found: ${projectId}.`, realProviderCalls: 0, oldViduRouteCalls: 0 }, { status: 404 });
  }

  const task = bundle.generationTasks.find((record) => (taskId ? record.id === taskId : record.providerTaskId === providerTaskId));
  if (!task) {
    return NextResponse.json({ ok: false, blocker: `Generation task not found: ${taskId ?? providerTaskId}.`, realProviderCalls: 0, oldViduRouteCalls: 0 }, { status: 404 });
  }

  if (!isTerminalStatus(task.status) && !getM54Gate().ready) {
    const gate = getM54Gate();
    return NextResponse.json({
      ok: false,
      status: "blocked",
      blocker: "M5.4 Workbench real Vidu polling is disabled until explicit server env gates are set.",
      requiredEnv: gate.requiredEnv,
      requiredConfirmValue: gate.requiredConfirmValue,
      enabled: gate.enabled,
      confirmed: gate.confirmed,
      realProviderCalls: 0,
      oldViduRouteCalls: 0
    }, { status: 403 });
  }

  const transportCounter = { count: 0 };
  const provider = createM54ViduProvider(bundle, transportCounter);
  const result = await pollControlledGenerationTask(store, {
    projectId,
    taskId,
    providerTaskId,
    provider,
    mediaStorageProvider: createSupabaseMediaStorageProviderFromEnv(),
    allowLiveProvider: true
  });

  return NextResponse.json(
    createGenerationRouteResponse(result, transportCounter.count),
    { status: result.ok ? 200 : 502 }
  );
}
