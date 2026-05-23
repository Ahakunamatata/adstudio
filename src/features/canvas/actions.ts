import type {
  BusinessNodeType,
  CanvasEdge,
  CanvasNode,
  CanvasNodeKind,
  CanvasNodeSettings,
  CanvasNodeVersion,
  NodeStatus
} from "@/lib/domain/schemas";
import type { CanvasActionResult, CanvasCreateNodeInput, CanvasGenerationResult, CanvasRuntimeAction } from "./types";

const nodeKindLabel: Record<CanvasNodeKind, string> = {
  text: "Text",
  image: "Image",
  video: "Video",
  upload: "Upload",
  script: "Script",
  prompt: "Prompt",
  plan: "Plan"
};

const nodeKindModel: Record<CanvasNodeKind, string> = {
  text: "Ad Strategy Agent",
  image: "GPT Image",
  video: "Seedance 2.0",
  upload: "Manual Upload",
  script: "Script Agent",
  prompt: "Prompt Guard",
  plan: "Ad Strategy Agent"
};

const nodeKindBusinessType: Record<CanvasNodeKind, BusinessNodeType> = {
  text: "creative_concept",
  image: "product_asset",
  video: "shot_video",
  upload: "product_asset",
  script: "ad_script",
  prompt: "shot_prompt",
  plan: "clone_strategy"
};

const nodeKindCost: Record<CanvasNodeKind, number> = {
  text: 2,
  image: 8,
  video: 24,
  upload: 0,
  script: 3,
  prompt: 1,
  plan: 3
};

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeNodeTitle(title: string) {
  return title.trim().replace(/\s+/g, " ");
}

function getTitleKey(title: string) {
  return normalizeNodeTitle(title).toLocaleLowerCase();
}

function isTitleTaken(nodes: CanvasNode[], title: string, exceptNodeId?: string) {
  const titleKey = getTitleKey(title);
  if (!titleKey) return false;
  return nodes.some((node) => node.id !== exceptNodeId && getTitleKey(node.title) === titleKey);
}

function getUniqueNodeTitle(nodes: CanvasNode[], title: string, exceptNodeId?: string) {
  const baseTitle = normalizeNodeTitle(title) || "Untitled node";
  if (!isTitleTaken(nodes, baseTitle, exceptNodeId)) return baseTitle;

  let index = 2;
  let nextTitle = `${baseTitle} ${index}`;
  while (isTitleTaken(nodes, nextTitle, exceptNodeId)) {
    index += 1;
    nextTitle = `${baseTitle} ${index}`;
  }

  return nextTitle;
}

export function findCanvasNode(nodes: CanvasNode[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId) ?? null;
}

export function getPrimaryVersion(node: CanvasNode) {
  return node.versions.find((version) => version.id === node.primaryVersionId) ?? node.versions[0] ?? null;
}

export function getNodeVersionNumber(node: CanvasNode) {
  return getPrimaryVersion(node)?.version ?? node.version;
}

function createEdgeId(source: string, target: string) {
  return `edge-${source}-${target}`;
}

function hasPath(edges: CanvasEdge[], from: string, to: string) {
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

function getDefaultNodeSettings(kind: CanvasNodeKind): CanvasNodeSettings {
  if (kind === "video") {
    return {
      ratio: "9:16",
      resolution: "720p",
      duration: "6s",
      mode: "全能参考",
      batch: "1"
    };
  }

  if (kind === "image") {
    return {
      ratio: "9:16",
      resolution: "1k",
      camera: "摄影机控制",
      mode: "全景图",
      batch: "1"
    };
  }

  if (kind === "upload") {
    return {
      mode: "素材库",
      batch: "1"
    };
  }

  return {};
}

function createVersion(node: CanvasNode, content: string, result?: CanvasGenerationResult, versionOverride?: number): CanvasNodeVersion {
  const version = versionOverride ?? node.versions.length + 1;
  const credits = nodeKindCost[node.kind] + Math.max(0, version - 1);
  const seconds = node.kind === "video" ? 42 + version * 5 : node.kind === "image" ? 14 + version * 3 : 6 + version * 2;

  return {
    id: `${node.id}-v${version}`,
    version,
    label: `v${version}`,
    content,
    createdAt: new Date().toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }),
    model: result?.model ?? node.model,
    time: result?.time ?? `${seconds}s`,
    cost: result?.cost ?? `${credits} credits`,
    previewClass: node.previewClass,
    assetUrl: result?.assetUrl,
    downloadUrl: result?.downloadUrl,
    providerTaskId: result?.providerTaskId,
    params: result?.params,
    slots: result?.slots
  };
}

function isPlaceholderInitialVersion(node: CanvasNode) {
  const version = node.versions[0];
  return Boolean(
    node.versions.length === 1 &&
    version &&
    version.version === 1 &&
    version.id === node.primaryVersionId &&
    !version.providerTaskId &&
    !version.assetUrl &&
    !version.downloadUrl &&
    version.content === node.output
  );
}

function withoutErrorMessage(settings: CanvasNodeSettings | undefined): CanvasNodeSettings | undefined {
  if (!settings) return undefined;
  const nextSettings = { ...settings };
  delete nextSettings.errorMessage;
  return nextSettings;
}

function nodeHasGeneratedOutput(node: CanvasNode) {
  return node.status !== "draft" && (["succeeded", "locked", "stale", "waiting_user", "uploaded", "checked", "completed"].includes(node.status) || node.versions.length > 0);
}

function getDefaultPreviewClass(kind: CanvasNodeKind) {
  if (kind === "text") return "text";
  if (kind === "image" || kind === "video") return "empty-media";
  return kind;
}

function withSyncedParentRefs(nodes: CanvasNode[], edges: CanvasEdge[]) {
  return nodes.map((node) => ({
    ...node,
    parentNodeIds: uniqueValues(edges.filter((edge) => edge.target === node.id).map((edge) => edge.source))
  }));
}

function markNodeStale(node: CanvasNode, reason: string): CanvasNode {
  if (!nodeHasGeneratedOutput(node) || node.status === "running" || node.status === "queued") {
    return { ...node, staleReason: reason };
  }

  return {
    ...node,
    status: "stale",
    staleReason: reason
  };
}

export function markDownstreamStale(nodes: CanvasNode[], edges: CanvasEdge[], sourceNodeId: string, reason: string) {
  const descendants = new Set<string>();
  const queue = [sourceNodeId];

  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;

    edges
      .filter((edge) => edge.source === current)
      .forEach((edge) => {
        if (!descendants.has(edge.target)) {
          descendants.add(edge.target);
          queue.push(edge.target);
        }
      });
  }

  return nodes.map((node) => (descendants.has(node.id) ? markNodeStale(node, reason) : node));
}

function createCanvasNode(nodes: CanvasNode[], edges: CanvasEdge[], input: CanvasCreateNodeInput): CanvasActionResult {
  if (input.id && nodes.some((node) => node.id === input.id)) {
    return {
      nodes,
      edges,
      changedNodeId: input.id,
      selectedNodeId: input.id
    };
  }

  const sameKindCount = nodes.filter((node) => node.kind === input.kind).length + 1;
  const sourceNode = input.sourceNodeId ? findCanvasNode(nodes, input.sourceNodeId) : null;
  const position = input.position ?? {
    x: (sourceNode?.position.x ?? 120) + 340,
    y: sourceNode?.position.y ?? 120 + sameKindCount * 24
  };
  const id = input.id ?? `${input.kind}-${Date.now().toString(36)}-${sameKindCount}`;
  const businessType = input.businessType ?? nodeKindBusinessType[input.kind];
  const title = getUniqueNodeTitle(nodes, input.title ?? `${nodeKindLabel[input.kind]} 节点 ${sameKindCount}`);
  const node: CanvasNode = {
    id,
    kind: input.kind,
    businessType,
    group: input.kind === "video" ? "video" : input.kind === "image" || input.kind === "upload" ? "assets" : "script",
    type: nodeKindLabel[input.kind],
    title,
    status: input.status ?? (input.kind === "upload" ? "uploaded" : "draft"),
    model: input.model ?? nodeKindModel[input.kind],
    time: "未运行",
    cost: "0 credits",
    input: input.input ?? (sourceNode ? `引用上游节点：${sourceNode.title}` : "手动创建节点，等待补充输入。"),
    output: input.output ?? (input.kind === "upload" ? "等待上传或拖入素材，可作为下游输入引用。" : "等待编辑或生成。"),
    version: 1,
    locked: input.locked ?? false,
    position,
    parentNodeIds: sourceNode ? [sourceNode.id] : [],
    versions: [],
    primaryVersionId: "",
    previewClass: input.previewClass ?? getDefaultPreviewClass(input.kind),
    settings: { ...getDefaultNodeSettings(input.kind), ...input.settings }
  };
  const firstVersion = createVersion(node, node.output);
  const nextNode = {
    ...node,
    versions: [firstVersion],
    primaryVersionId: firstVersion.id
  };
  const nextEdges = sourceNode
    ? [...edges, { id: createEdgeId(sourceNode.id, nextNode.id), source: sourceNode.id, target: nextNode.id, label: "input" }]
    : edges;

  return {
    nodes: withSyncedParentRefs([...nodes, nextNode], nextEdges),
    edges: nextEdges,
    changedNodeId: nextNode.id,
    selectedNodeId: nextNode.id
  };
}

function deleteNodes(nodes: CanvasNode[], edges: CanvasEdge[], nodeIds: string[]): CanvasActionResult {
  const requestedNodeIds = new Set(nodeIds.filter(Boolean));
  if (!requestedNodeIds.size) return { nodes, edges };

  const deletedNodeIds = new Set(
    nodes
      .filter((node) => requestedNodeIds.has(node.id) && !node.locked && node.status !== "locked")
      .map((node) => node.id)
  );
  if (!deletedNodeIds.size) return { nodes, edges };

  const affectedTargetIds = new Set(
    edges
      .filter((edge) => deletedNodeIds.has(edge.source) && !deletedNodeIds.has(edge.target))
      .map((edge) => edge.target)
  );
  const nextEdges = edges.filter((edge) => !deletedNodeIds.has(edge.source) && !deletedNodeIds.has(edge.target));
  let nextNodes = withSyncedParentRefs(
    nodes.filter((node) => !deletedNodeIds.has(node.id)),
    nextEdges
  ).map((node) => (affectedTargetIds.has(node.id) ? markNodeStale(node, "上游节点已删除") : node));

  affectedTargetIds.forEach((nodeId) => {
    nextNodes = markDownstreamStale(nextNodes, nextEdges, nodeId, "上游节点已删除");
  });

  return {
    nodes: nextNodes,
    edges: nextEdges,
    changedNodeId: Array.from(affectedTargetIds).find((nodeId) => !deletedNodeIds.has(nodeId))
  };
}

function renameNode(nodes: CanvasNode[], edges: CanvasEdge[], nodeId: string, title: string): CanvasActionResult {
  const nextTitle = normalizeNodeTitle(title);
  if (!nextTitle || isTitleTaken(nodes, nextTitle, nodeId)) {
    return { nodes, edges, changedNodeId: nodeId };
  }

  return {
    nodes: nodes.map((node) => (node.id === nodeId ? { ...node, title: nextTitle } : node)),
    edges,
    changedNodeId: nodeId
  };
}

function updateNodeContent(nodes: CanvasNode[], edges: CanvasEdge[], nodeId: string, output: string): CanvasActionResult {
  const nextNodes = nodes.map((node) =>
    node.id === nodeId
      ? {
          ...node,
          output,
          status: (node.locked ? "locked" : "succeeded") as NodeStatus,
          staleReason: undefined
        }
      : node
  );

  return {
    nodes: markDownstreamStale(nextNodes, edges, nodeId, `${findCanvasNode(nodes, nodeId)?.title ?? "上游节点"} 内容已更新`),
    edges,
    changedNodeId: nodeId
  };
}

function updateNodeSettings(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  nodeId: string,
  title: string,
  output: string,
  model: string,
  settings?: CanvasNodeSettings
): CanvasActionResult {
  const currentNode = findCanvasNode(nodes, nodeId);
  const nextTitle = currentNode
    ? !normalizeNodeTitle(title) || isTitleTaken(nodes, title, nodeId)
      ? currentNode.title
      : normalizeNodeTitle(title)
    : normalizeNodeTitle(title);
  const nextNodes = nodes.map((node) =>
    node.id === nodeId
      ? {
          ...node,
          title: nextTitle,
          output,
          model,
          settings: settings ? { ...node.settings, ...settings } : node.settings,
          status: (node.locked ? "locked" : node.status === "uploaded" ? "uploaded" : "succeeded") as NodeStatus,
          staleReason: undefined
        }
      : node
  );

  return {
    nodes: markDownstreamStale(nextNodes, edges, nodeId, `${title} 内容或参数已更新`),
    edges,
    changedNodeId: nodeId
  };
}

function connectNodes(nodes: CanvasNode[], edges: CanvasEdge[], source: string, target: string): CanvasActionResult {
  if (
    !source ||
    !target ||
    source === target ||
    edges.some((edge) => edge.source === source && edge.target === target) ||
    hasPath(edges, target, source)
  ) {
    return { nodes, edges };
  }

  const sourceNode = findCanvasNode(nodes, source);
  const targetNode = findCanvasNode(nodes, target);
  if (!sourceNode || !targetNode) {
    return { nodes, edges };
  }

  const nextEdges = [...edges, { id: createEdgeId(source, target), source, target, label: "input" }];
  const synced = withSyncedParentRefs(nodes, nextEdges);
  const nextNodes = synced.map((node) => (node.id === target ? markNodeStale(node, `新增输入：${sourceNode.title}`) : node));

  return {
    nodes: markDownstreamStale(nextNodes, nextEdges, target, `${targetNode.title} 输入已更新`),
    edges: nextEdges,
    changedNodeId: target
  };
}

function disconnectNodes(nodes: CanvasNode[], edges: CanvasEdge[], edgeId: string): CanvasActionResult {
  const edge = edges.find((item) => item.id === edgeId);
  if (!edge) {
    return { nodes, edges };
  }

  const nextEdges = edges.filter((item) => item.id !== edgeId);
  const nextNodes = withSyncedParentRefs(nodes, nextEdges).map((node) =>
    node.id === edge.target ? markNodeStale(node, "输入连接已断开") : node
  );

  return {
    nodes: markDownstreamStale(nextNodes, nextEdges, edge.target, "上游连接已调整"),
    edges: nextEdges,
    changedNodeId: edge.target
  };
}

function runNodeGeneration(nodes: CanvasNode[], edges: CanvasEdge[], nodeId: string): CanvasActionResult {
  return {
    nodes: nodes.map((node) =>
      node.id === nodeId && !node.locked
        ? {
            ...node,
            status: "running",
            staleReason: undefined
          }
        : node
    ),
    edges,
    changedNodeId: nodeId
  };
}

function appendNodeVersion(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  nodeId: string,
  content?: string,
  result?: CanvasGenerationResult
): CanvasActionResult {
  if (!result && !content?.trim()) {
    return failNodeGeneration(nodes, edges, nodeId, "缺少真实生成结果，已阻止写入占位版本。");
  }

  let changedTitle = "上游节点";
  const nextNodes = nodes.map((node) => {
    if (node.id !== nodeId) return node;

    changedTitle = node.title;
    const shouldReplacePlaceholder = isPlaceholderInitialVersion(node);
    const nextVersion = createVersion(node, result?.content ?? content ?? "", result, shouldReplacePlaceholder ? 1 : undefined);
    const nextSettings: CanvasNodeSettings = {
      ...(withoutErrorMessage(node.settings) ?? {}),
      ...(result?.assetUrl ? { assetUrl: result.assetUrl } : {}),
      ...(result?.downloadUrl ? { downloadUrl: result.downloadUrl } : {}),
      ...(result?.providerTaskId ? { providerTaskId: result.providerTaskId } : {})
    };

    return {
      ...node,
      status: "succeeded" as NodeStatus,
      output: nextVersion.content,
      version: nextVersion.version,
      time: nextVersion.time,
      cost: nextVersion.cost,
      model: nextVersion.model,
      settings: nextSettings,
      versions: shouldReplacePlaceholder ? [nextVersion] : [...node.versions, nextVersion],
      primaryVersionId: nextVersion.id,
      staleReason: undefined
    };
  });

  return {
    nodes: markDownstreamStale(nextNodes, edges, nodeId, `${changedTitle} 生成了新主版本`),
    edges,
    changedNodeId: nodeId
  };
}

function failNodeGeneration(nodes: CanvasNode[], edges: CanvasEdge[], nodeId: string, errorMessage: string): CanvasActionResult {
  return {
    nodes: nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            status: "failed" as NodeStatus,
            staleReason: errorMessage,
            settings: {
              ...node.settings,
              errorMessage
            }
          }
        : node
    ),
    edges,
    changedNodeId: nodeId
  };
}

function setPrimaryVersion(nodes: CanvasNode[], edges: CanvasEdge[], nodeId: string, versionId: string): CanvasActionResult {
  let changedTitle = "上游节点";
  const nextNodes = nodes.map((node) => {
    if (node.id !== nodeId) return node;

    const version = node.versions.find((item) => item.id === versionId);
    if (!version) return node;

    changedTitle = node.title;
    return {
      ...node,
      status: (node.locked ? "locked" : "succeeded") as NodeStatus,
      output: version.content,
      version: version.version,
      time: version.time,
      cost: version.cost,
      model: version.model,
      primaryVersionId: version.id,
      settings: {
        ...(withoutErrorMessage(node.settings) ?? {}),
        ...(version.assetUrl ? { assetUrl: version.assetUrl } : {}),
        ...(version.downloadUrl ? { downloadUrl: version.downloadUrl } : {}),
        ...(version.providerTaskId ? { providerTaskId: version.providerTaskId } : {})
      },
      staleReason: undefined
    };
  });

  return {
    nodes: markDownstreamStale(nextNodes, edges, nodeId, `${changedTitle} 切换了主版本`),
    edges,
    changedNodeId: nodeId
  };
}

function lockNode(nodes: CanvasNode[], edges: CanvasEdge[], nodeId: string, locked?: boolean): CanvasActionResult {
  return {
    nodes: nodes.map((node) => {
      if (node.id !== nodeId) return node;
      const nextLocked = locked ?? !node.locked;
      return {
        ...node,
        locked: nextLocked,
        status: nextLocked ? "locked" : node.status === "locked" ? "succeeded" : node.status
      };
    }),
    edges,
    changedNodeId: nodeId
  };
}

function markSingleNodeStale(nodes: CanvasNode[], edges: CanvasEdge[], nodeId: string, reason = "输入已更新"): CanvasActionResult {
  return {
    nodes: nodes.map((node) => (node.id === nodeId ? markNodeStale(node, reason) : node)),
    edges,
    changedNodeId: nodeId
  };
}

export function applyCanvasAction(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  action: CanvasRuntimeAction
): CanvasActionResult {
  if (action.type === "deleteNodes") return deleteNodes(nodes, edges, action.nodeIds);
  if (action.type === "renameNode") return renameNode(nodes, edges, action.nodeId, action.title);
  if (action.type === "createNode") return createCanvasNode(nodes, edges, action.input);
  if (action.type === "updateNodeContent") return updateNodeContent(nodes, edges, action.nodeId, action.output);
  if (action.type === "updateNodeSettings") {
    return updateNodeSettings(nodes, edges, action.nodeId, action.title, action.output, action.model, action.settings);
  }
  if (action.type === "connectNodes") return connectNodes(nodes, edges, action.source, action.target);
  if (action.type === "disconnectNodes") return disconnectNodes(nodes, edges, action.edgeId);
  if (action.type === "runNodeGeneration") return runNodeGeneration(nodes, edges, action.nodeId);
  if (action.type === "appendNodeVersion") return appendNodeVersion(nodes, edges, action.nodeId, action.content, action.result);
  if (action.type === "failNodeGeneration") return failNodeGeneration(nodes, edges, action.nodeId, action.errorMessage);
  if (action.type === "setPrimaryVersion") return setPrimaryVersion(nodes, edges, action.nodeId, action.versionId);
  if (action.type === "lockNode") return lockNode(nodes, edges, action.nodeId, action.locked);
  if (action.type === "markNodeStale") return markSingleNodeStale(nodes, edges, action.nodeId, action.reason);
  if (action.type === "openNodeDetail") return { nodes, edges, selectedNodeId: action.nodeId, changedNodeId: action.nodeId };

  return { nodes, edges };
}
