import type { CanvasRuntimeAction } from "@/features/canvas/types";
import type { CanvasSnapshot } from "./agent-snapshot";

export type CanvasActionValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

function isNonEmpty(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function createEdgeId(source: string, target: string) {
  return `edge-${source}-${target}`;
}

function getTitleKey(title: string) {
  return title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function hasPath(edges: Array<{ source: string; target: string }>, from: string, to: string) {
  const queue = [from];
  const visited = new Set<string>();

  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    if (current === to) return true;

    visited.add(current);
    edges.filter((edge) => edge.source === current).forEach((edge) => queue.push(edge.target));
  }

  return false;
}

function validateCanvasAction(action: CanvasRuntimeAction, index: number): CanvasActionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prefix = `Action ${index + 1} (${action.type})`;

  if (action.type === "createNode") {
    if (!action.input.kind) errors.push(`${prefix}: createNode 缺少节点 kind。`);
    if (action.input.id && !isNonEmpty(action.input.id)) errors.push(`${prefix}: createNode.id 不能为空。`);
    if (!action.input.title) warnings.push(`${prefix}: createNode 未提供 title，会使用默认标题。`);
  }

  if (action.type === "deleteNodes") {
    if (!action.nodeIds.length) errors.push(`${prefix}: deleteNodes 缺少 nodeIds。`);
  }

  if (action.type === "renameNode") {
    if (!isNonEmpty(action.nodeId)) errors.push(`${prefix}: renameNode 缺少 nodeId。`);
    if (!isNonEmpty(action.title)) errors.push(`${prefix}: renameNode 缺少 title。`);
  }

  if (action.type === "updateNodeContent" && !isNonEmpty(action.nodeId)) {
    errors.push(`${prefix}: updateNodeContent 缺少 nodeId。`);
  }

  if (action.type === "updateNodeSettings") {
    if (!isNonEmpty(action.nodeId)) errors.push(`${prefix}: updateNodeSettings 缺少 nodeId。`);
    if (!isNonEmpty(action.title)) errors.push(`${prefix}: updateNodeSettings 缺少 title。`);
    if (!isNonEmpty(action.model)) warnings.push(`${prefix}: updateNodeSettings 未提供 model。`);
  }

  if (action.type === "connectNodes") {
    if (!isNonEmpty(action.source)) errors.push(`${prefix}: connectNodes 缺少 source。`);
    if (!isNonEmpty(action.target)) errors.push(`${prefix}: connectNodes 缺少 target。`);
    if (action.source === action.target) errors.push(`${prefix}: connectNodes 不能连接到自身。`);
  }

  if (action.type === "disconnectNodes" && !isNonEmpty(action.edgeId)) {
    errors.push(`${prefix}: disconnectNodes 缺少 edgeId。`);
  }

  if (action.type === "runNodeGeneration" && !isNonEmpty(action.nodeId)) {
    errors.push(`${prefix}: runNodeGeneration 缺少 nodeId。`);
  } else if (action.type === "runNodeGeneration") {
    errors.push(`${prefix}: 第一版 Agent 不直接触发生成任务，请先创建/更新节点和 prompt，再由真实生成面板提交。`);
  }

  if (action.type === "appendNodeVersion" && !isNonEmpty(action.nodeId)) {
    errors.push(`${prefix}: appendNodeVersion 缺少 nodeId。`);
  } else if (action.type === "appendNodeVersion" && !action.content?.trim() && !action.result) {
    errors.push(`${prefix}: appendNodeVersion 缺少真实 content 或 provider result，已阻止写入占位结果。`);
  }

  if (action.type === "failNodeGeneration") {
    if (!isNonEmpty(action.nodeId)) errors.push(`${prefix}: failNodeGeneration 缺少 nodeId。`);
    if (!isNonEmpty(action.errorMessage)) errors.push(`${prefix}: failNodeGeneration 缺少 errorMessage。`);
  }

  if (action.type === "setPrimaryVersion") {
    if (!isNonEmpty(action.nodeId)) errors.push(`${prefix}: setPrimaryVersion 缺少 nodeId。`);
    if (!isNonEmpty(action.versionId)) errors.push(`${prefix}: setPrimaryVersion 缺少 versionId。`);
  }

  if ((action.type === "lockNode" || action.type === "markNodeStale" || action.type === "openNodeDetail") && !isNonEmpty(action.nodeId)) {
    errors.push(`${prefix}: ${action.type} 缺少 nodeId。`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function validateAgainstCanvas(actions: CanvasRuntimeAction[], canvas: CanvasSnapshot): CanvasActionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const knownNodeIds = new Set(canvas.nodes.map((node) => node.id));
  const lockedNodeIds = new Set(canvas.lockedNodeIds);
  const knownEdgeIds = new Set(canvas.edges.map((edge) => edge.id));
  const nodeTitleById = new Map(canvas.nodes.map((node) => [node.id, node.title]));
  const knownTitleKeys = new Map<string, string>();
  const edges = canvas.edges.map((edge) => ({ source: edge.source, target: edge.target }));

  canvas.nodes.forEach((node) => {
    const titleKey = getTitleKey(node.title);
    if (!titleKey) return;
    const existingNodeId = knownTitleKeys.get(titleKey);
    if (existingNodeId && existingNodeId !== node.id) {
      errors.push(`Canvas: 节点名称 "${node.title}" 不唯一，Agent 无法把它作为稳定标识。`);
      return;
    }
    knownTitleKeys.set(titleKey, node.id);
  });

  function requireNode(nodeId: string, prefix: string) {
    if (!knownNodeIds.has(nodeId)) errors.push(`${prefix}: 目标节点 ${nodeId} 不存在。`);
  }

  function blockLockedNode(nodeId: string, prefix: string) {
    if (lockedNodeIds.has(nodeId)) errors.push(`${prefix}: 目标节点 ${nodeId} 已锁定，不能由 Agent 修改。`);
  }

  actions.forEach((action, index) => {
    const prefix = `Action ${index + 1} (${action.type})`;

    if (action.type === "createNode") {
      const nodeId = action.input.id;
      const titleKey = getTitleKey(action.input.title ?? "");
      if (titleKey && knownTitleKeys.has(titleKey)) {
        errors.push(`${prefix}: 节点名称 "${action.input.title}" 已存在，不能重复创建。`);
      }
      if (action.input.sourceNodeId) requireNode(action.input.sourceNodeId, prefix);
      if (!nodeId) {
        warnings.push(`${prefix}: createNode 未提供稳定 id，后续动作不能在同一批次引用该节点。`);
        return;
      }
      if (knownNodeIds.has(nodeId)) {
        errors.push(`${prefix}: 节点 ${nodeId} 已存在，不能重复创建。`);
        return;
      }
      knownNodeIds.add(nodeId);
      if (titleKey) {
        knownTitleKeys.set(titleKey, nodeId);
        nodeTitleById.set(nodeId, action.input.title ?? nodeId);
      }
      if (action.input.locked) lockedNodeIds.add(nodeId);
      return;
    }

    if (action.type === "deleteNodes") {
      action.nodeIds.forEach((nodeId) => {
        requireNode(nodeId, prefix);
        blockLockedNode(nodeId, prefix);
        knownNodeIds.delete(nodeId);
        const title = nodeTitleById.get(nodeId);
        if (title) knownTitleKeys.delete(getTitleKey(title));
      });
      return;
    }

    if (action.type === "renameNode") {
      requireNode(action.nodeId, prefix);
      blockLockedNode(action.nodeId, prefix);
      const titleKey = getTitleKey(action.title);
      const existingNodeId = knownTitleKeys.get(titleKey);
      if (!titleKey) errors.push(`${prefix}: renameNode 标题不能为空。`);
      if (existingNodeId && existingNodeId !== action.nodeId) {
        errors.push(`${prefix}: 节点名称 "${action.title}" 已存在，不能重命名。`);
      }
      const previousTitle = nodeTitleById.get(action.nodeId);
      if (previousTitle) knownTitleKeys.delete(getTitleKey(previousTitle));
      if (titleKey) {
        knownTitleKeys.set(titleKey, action.nodeId);
        nodeTitleById.set(action.nodeId, action.title);
      }
      return;
    }

    if (action.type === "connectNodes") {
      requireNode(action.source, prefix);
      requireNode(action.target, prefix);
      if (knownEdgeIds.has(createEdgeId(action.source, action.target))) {
        errors.push(`${prefix}: ${action.source} -> ${action.target} 已存在连接。`);
      }
      if (hasPath(edges, action.target, action.source)) {
        errors.push(`${prefix}: ${action.source} -> ${action.target} 会形成循环。`);
      }
      const edgeId = createEdgeId(action.source, action.target);
      knownEdgeIds.add(edgeId);
      edges.push({ source: action.source, target: action.target });
      return;
    }

    if (action.type === "disconnectNodes") {
      if (!knownEdgeIds.has(action.edgeId)) errors.push(`${prefix}: 目标边 ${action.edgeId} 不存在。`);
      return;
    }

    if (action.type === "updateNodeContent") {
      requireNode(action.nodeId, prefix);
      blockLockedNode(action.nodeId, prefix);
      return;
    }

    if (action.type === "updateNodeSettings") {
      requireNode(action.nodeId, prefix);
      blockLockedNode(action.nodeId, prefix);
      const titleKey = getTitleKey(action.title);
      const existingNodeId = knownTitleKeys.get(titleKey);
      if (titleKey && existingNodeId && existingNodeId !== action.nodeId) {
        errors.push(`${prefix}: 节点名称 "${action.title}" 已存在，不能更新为重复名称。`);
      }
      const previousTitle = nodeTitleById.get(action.nodeId);
      if (previousTitle) knownTitleKeys.delete(getTitleKey(previousTitle));
      if (titleKey) {
        knownTitleKeys.set(titleKey, action.nodeId);
        nodeTitleById.set(action.nodeId, action.title);
      }
      return;
    }

    if (action.type === "appendNodeVersion") {
      requireNode(action.nodeId, prefix);
      blockLockedNode(action.nodeId, prefix);
      const targetNode = canvas.nodes.find((node) => node.id === action.nodeId);
      const isMediaNode = targetNode?.kind === "image" || targetNode?.kind === "video";
      const hasProviderResult = Boolean(action.result?.assetUrl || action.result?.downloadUrl || action.result?.providerTaskId);
      if (isMediaNode && !hasProviderResult) {
        errors.push(`${prefix}: 媒体节点必须带真实 provider 结果，不能写入纯文本占位版本。`);
      }
      return;
    }

    if (action.type === "runNodeGeneration" || action.type === "failNodeGeneration" || action.type === "setPrimaryVersion" || action.type === "markNodeStale") {
      requireNode(action.nodeId, prefix);
      blockLockedNode(action.nodeId, prefix);
      return;
    }

    if (action.type === "lockNode") {
      requireNode(action.nodeId, prefix);
      if (action.locked) lockedNodeIds.add(action.nodeId);
      else lockedNodeIds.delete(action.nodeId);
      return;
    }

    if (action.type === "openNodeDetail") {
      requireNode(action.nodeId, prefix);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export function validateCanvasActionBatch(actions: CanvasRuntimeAction[], canvas?: CanvasSnapshot): CanvasActionValidationResult {
  const results = actions.map(validateCanvasAction);
  if (canvas) results.push(validateAgainstCanvas(actions, canvas));
  const errors = results.flatMap((result) => result.errors);
  const warnings = results.flatMap((result) => result.warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
