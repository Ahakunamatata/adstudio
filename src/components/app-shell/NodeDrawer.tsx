"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { CanvasNode } from "@/lib/domain/schemas";
import { dispatchCanvasAction } from "@/features/canvas/events";

type NodeDrawerProps = {
  node: CanvasNode | null;
  onClose: () => void;
};

export function NodeDrawer({ node, onClose }: NodeDrawerProps) {
  return <NodeDrawerContent key={node?.id ?? "empty"} node={node} onClose={onClose} />;
}

function NodeDrawerContent({ node, onClose }: NodeDrawerProps) {
  const [draftOutput, setDraftOutput] = useState(node?.output ?? "");
  const locked = Boolean(node?.locked || node?.status === "locked");

  return (
    <aside className={`node-drawer ${node ? "is-open" : ""}`} aria-hidden={!node}>
      <div className="drawer-head">
        <div>
          <span className="entry-tag" id="drawer-type">
            {node?.type ?? "Node"}
          </span>
          <h2 id="drawer-title">{node?.title ?? "节点详情"}</h2>
        </div>
        <button className="icon-btn" aria-label="Close" type="button" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className={`drawer-preview ${node ? `drawer-${node.previewClass || node.id}` : ""}`}>
        {node?.kind === "text" || node?.kind === "script" || node?.kind === "prompt" || node?.kind === "plan" ? (
          <p>{node.output}</p>
        ) : null}
      </div>
      <dl className="node-detail-list">
        <div>
          <dt>Status</dt>
          <dd>{node?.status ?? "draft"}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{node?.model ?? "GPT Image"}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{node?.time ?? "18s"}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>{node?.cost ?? "8 credits"}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>v{node?.version ?? 1}</dd>
        </div>
        <div>
          <dt>Locked</dt>
          <dd>{locked ? "Yes" : "No"}</dd>
        </div>
      </dl>
      {node?.staleReason ? (
        <div className="drawer-section drawer-warning">
          <h3>Input Updated</h3>
          <p>{node.staleReason}</p>
        </div>
      ) : null}
      <div className="drawer-section">
        <h3>Input</h3>
        <p>{node?.input ?? "来自产品包和脚本节点。"}</p>
      </div>
      <div className="drawer-section">
        <h3>Output</h3>
        <textarea
          value={draftOutput}
          onChange={(event) => setDraftOutput(event.target.value)}
          disabled={!node || locked}
          aria-label="Node output"
        />
      </div>
      <div className="drawer-section">
        <h3>Parent node references</h3>
        <div className="drawer-ref-list">
          {node?.parentNodeIds.length ? node.parentNodeIds.map((parentId) => <span key={parentId}>{parentId}</span>) : <span>No refs</span>}
        </div>
      </div>
      <div className="drawer-section">
        <h3>Versions</h3>
        <div className="drawer-version-list">
          {node?.versions.map((version) => (
            <button
              className={version.id === node.primaryVersionId ? "is-primary" : ""}
              type="button"
              key={version.id}
              onClick={() => dispatchCanvasAction({ type: "setPrimaryVersion", nodeId: node.id, versionId: version.id })}
            >
              {version.label}
            </button>
          )) ?? <span>No versions</span>}
        </div>
      </div>
      <div className="drawer-actions">
        <button
          className="ghost-btn"
          type="button"
          disabled={!node || locked}
          onClick={() => node && dispatchCanvasAction({ type: "updateNodeContent", nodeId: node.id, output: draftOutput })}
        >
          保存输出
        </button>
        <button
          className="ghost-btn"
          type="button"
          disabled={!node}
          onClick={() => node && dispatchCanvasAction({ type: "appendNodeVersion", nodeId: node.id, content: draftOutput })}
        >
          新版本
        </button>
        <button className="ghost-btn" type="button" disabled={!node} onClick={() => node && dispatchCanvasAction({ type: "lockNode", nodeId: node.id })}>
          {locked ? "解锁" : "锁定"}
        </button>
        <button
          className="primary-btn"
          type="button"
          disabled={!node || locked || node.status === "running"}
          onClick={() => node && dispatchCanvasAction({ type: "runNodeGeneration", nodeId: node.id })}
        >
          {node?.status === "running" ? "运行中" : "重跑节点"}
        </button>
      </div>
    </aside>
  );
}
