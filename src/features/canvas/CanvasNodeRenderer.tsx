"use client";

import { type MouseEvent as ReactMouseEvent, type RefObject, useRef } from "react";
import {
  Copy,
  FileText,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Play,
  Save,
  Sparkles,
  Underline,
  UploadCloud,
  Video,
  WandSparkles
} from "lucide-react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import type { CanvasNodeKind, NodeStatus } from "@/lib/domain/schemas";
import type { AdCanvasFlowNode } from "./types";

const statusLabels: Record<NodeStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  stale: "Stale",
  locked: "Locked",
  uploaded: "Uploaded",
  waiting_user: "Waiting user",
  pending: "Pending",
  checked: "Checked",
  completed: "Completed"
};

function getKindIcon(kind: CanvasNodeKind) {
  if (kind === "image") return <ImageIcon size={14} />;
  if (kind === "video") return <Video size={14} />;
  if (kind === "upload") return <UploadCloud size={14} />;
  if (kind === "script" || kind === "prompt" || kind === "plan") return <FileText size={14} />;
  return <Sparkles size={14} />;
}

function stopCanvasClick(event: ReactMouseEvent) {
  event.stopPropagation();
}

function isTextLikeNode(kind: CanvasNodeKind) {
  return kind === "text" || kind === "script" || kind === "prompt" || kind === "plan";
}

function getEditorValue(editorRef: RefObject<HTMLTextAreaElement | null>, fallback: string) {
  return editorRef.current?.value ?? fallback;
}

function saveTextNode(data: AdCanvasFlowNode["data"], editorRef: RefObject<HTMLTextAreaElement | null>) {
  const { canvasNode } = data;
  const value = getEditorValue(editorRef, canvasNode.output);
  data.onUpdateNodeSettings(canvasNode.id, canvasNode.title, value, canvasNode.model);
}

function formatSelectedText(
  command: "bold" | "italic" | "underline" | "h1" | "h2" | "h3" | "paragraph",
  data: AdCanvasFlowNode["data"],
  editorRef: RefObject<HTMLTextAreaElement | null>
) {
  const textarea = editorRef.current;
  if (!textarea) return;

  const value = textarea.value;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);
  const fallback = selected || "Text";
  const wrappers = {
    bold: [`**${fallback}**`, 2, 2],
    italic: [`_${fallback}_`, 1, 1],
    underline: [`<u>${fallback}</u>`, 3, 4],
    h1: [`# ${fallback}`, 2, 0],
    h2: [`## ${fallback}`, 3, 0],
    h3: [`### ${fallback}`, 4, 0],
    paragraph: [fallback.replace(/^#{1,3}\s*/, ""), 0, 0]
  } as const;
  const [replacement, selectionOffsetStart, selectionOffsetEnd] = wrappers[command];
  const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
  const nextStart = start + selectionOffsetStart;
  const nextEnd = start + replacement.length - selectionOffsetEnd;

  textarea.value = nextValue;
  textarea.focus();
  textarea.setSelectionRange(nextStart, nextEnd);
  data.onUpdateNodeSettings(data.canvasNode.id, data.canvasNode.title, nextValue, data.canvasNode.model);
}

function VersionStrip({ data }: { data: AdCanvasFlowNode["data"] }) {
  const { canvasNode } = data;

  if (canvasNode.versions.length < 2) return null;

  return (
    <div className="ad-node-versions">
      {canvasNode.versions.map((version) => (
        <button
          className={version.id === canvasNode.primaryVersionId ? "is-primary" : ""}
          key={version.id}
          type="button"
          onClick={(event) => {
            stopCanvasClick(event);
            data.onSetPrimaryVersion(canvasNode.id, version.id);
          }}
        >
          {version.label}
        </button>
      ))}
    </div>
  );
}

function TextPreview({
  data,
  selected,
  editorRef
}: {
  data: AdCanvasFlowNode["data"];
  selected: boolean;
  editorRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { canvasNode } = data;
  const isLocked = canvasNode.locked || canvasNode.status === "locked";

  if (selected && !isLocked) {
    return (
      <textarea
        ref={editorRef}
        className="ad-node-textarea nodrag"
        key={`${canvasNode.id}-${canvasNode.primaryVersionId}-${canvasNode.version}`}
        defaultValue={canvasNode.output}
        rows={5}
        onBlur={(event) => {
          const draft = event.currentTarget.value;
          if (draft !== canvasNode.output) {
            data.onUpdateNodeSettings(canvasNode.id, canvasNode.title, draft, canvasNode.model);
          }
        }}
        onClick={stopCanvasClick}
        onDoubleClick={stopCanvasClick}
        onMouseDown={stopCanvasClick}
      />
    );
  }

  return (
    <div className="ad-node-preview ad-node-preview--text ad-node-text-preview">
      <p>{canvasNode.output}</p>
    </div>
  );
}

function NodePreview({
  data,
  selected,
  editorRef
}: {
  data: AdCanvasFlowNode["data"];
  selected: boolean;
  editorRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { canvasNode } = data;
  const previewClass = `ad-node-preview ad-node-preview--${canvasNode.previewClass}`;

  if (canvasNode.kind === "image" || canvasNode.kind === "video" || canvasNode.kind === "upload") {
    return (
      <div className={previewClass}>
        {canvasNode.kind === "video" ? (
          <span className="ad-node-play">
            <Play size={18} fill="currentColor" />
          </span>
        ) : null}
      </div>
    );
  }

  return <TextPreview data={data} selected={selected} editorRef={editorRef} />;
}

function TextToolbar({
  visible,
  data,
  editorRef,
  isLocked
}: {
  visible: boolean;
  data: AdCanvasFlowNode["data"];
  editorRef: RefObject<HTMLTextAreaElement | null>;
  isLocked: boolean;
}) {
  function handleClick(event: ReactMouseEvent, action: () => void) {
    stopCanvasClick(event);
    if (!isLocked) action();
  }

  return (
    <NodeToolbar
      align="center"
      className="ad-node-floating-toolbar ad-node-text-toolbar nodrag nopan"
      isVisible={visible}
      offset={10}
      position={Position.Top}
    >
      <button type="button" aria-label="Bold" disabled={isLocked} onClick={(event) => handleClick(event, () => formatSelectedText("bold", data, editorRef))}>
        B
      </button>
      <button type="button" aria-label="Italic" disabled={isLocked} onClick={(event) => handleClick(event, () => formatSelectedText("italic", data, editorRef))}>
        <em>I</em>
      </button>
      <button type="button" aria-label="Underline" disabled={isLocked} onClick={(event) => handleClick(event, () => formatSelectedText("underline", data, editorRef))}>
        <Underline size={13} />
      </button>
      <button type="button" aria-label="Heading 1" disabled={isLocked} onClick={(event) => handleClick(event, () => formatSelectedText("h1", data, editorRef))}>
        H1
      </button>
      <button type="button" aria-label="Heading 2" disabled={isLocked} onClick={(event) => handleClick(event, () => formatSelectedText("h2", data, editorRef))}>
        H2
      </button>
      <button type="button" aria-label="Heading 3" disabled={isLocked} onClick={(event) => handleClick(event, () => formatSelectedText("h3", data, editorRef))}>
        H3
      </button>
      <button type="button" aria-label="Paragraph" disabled={isLocked} onClick={(event) => handleClick(event, () => formatSelectedText("paragraph", data, editorRef))}>
        ¶
      </button>
      <button
        type="button"
        aria-label="Copy"
        onClick={(event) => {
          stopCanvasClick(event);
          void navigator.clipboard?.writeText(getEditorValue(editorRef, data.canvasNode.output));
        }}
      >
        <Copy size={13} />
      </button>
      <button type="button" aria-label="Save" disabled={isLocked} onClick={(event) => handleClick(event, () => saveTextNode(data, editorRef))}>
        <Save size={13} />
      </button>
      <button
        type="button"
        aria-label="Generate"
        disabled={isLocked || data.canvasNode.status === "running"}
        onClick={(event) =>
          handleClick(event, () => {
            saveTextNode(data, editorRef);
            data.onRunNode(data.canvasNode.id);
          })
        }
      >
        <Play size={13} fill="currentColor" />
      </button>
    </NodeToolbar>
  );
}

function MediaToolbar({ kind, visible }: { kind: CanvasNodeKind; visible: boolean }) {
  if (kind !== "image" && kind !== "video" && kind !== "upload") return null;

  const imageActions = ["全景图", "增强", "编辑元素", "分镜大师", "宫格裁剪", "角度", "打光", "更多"];
  const videoActions = ["高清", "剪辑", "捕捉帧", "解析", "音频分离"];
  const uploadActions = ["替换", "预览", "下载", "加入 Agent"];
  const actions = kind === "image" ? imageActions : kind === "video" ? videoActions : uploadActions;

  return (
    <NodeToolbar
      align="center"
      className="ad-node-floating-toolbar ad-node-media-toolbar nodrag nopan"
      isVisible={visible}
      offset={12}
      position={Position.Top}
    >
      {actions.map((action, index) => (
        <button key={action} type="button" className={index === 0 ? "is-primary-action" : ""}>
          {index === 0 && kind !== "upload" ? <WandSparkles size={12} /> : null}
          {action}
        </button>
      ))}
      {kind !== "upload" ? (
        <>
          <button type="button" aria-label="Annotate">
            ✎
          </button>
          <button type="button" aria-label="Crop">
            ⌗
          </button>
          <button type="button" aria-label="Download">
            ⇩
          </button>
          <button type="button" className="is-agent-action">
            加入 Agent
          </button>
        </>
      ) : null}
    </NodeToolbar>
  );
}

function CanvasNodeRenderer({ data, selected }: NodeProps<AdCanvasFlowNode>) {
  const { canvasNode, parentTitles } = data;
  const isLocked = canvasNode.locked || canvasNode.status === "locked";
  const textEditorRef = useRef<HTMLTextAreaElement | null>(null);

  return (
    <>
      <TextToolbar
        visible={selected && isTextLikeNode(canvasNode.kind)}
        data={data}
        editorRef={textEditorRef}
        isLocked={isLocked}
      />
      <MediaToolbar visible={selected} kind={canvasNode.kind} />

      <article
        className={`ad-canvas-node ad-canvas-node--${canvasNode.kind} ${selected ? "is-selected" : ""}`}
        data-status={canvasNode.status}
        data-locked={isLocked ? "true" : "false"}
      >
        <Handle className="ad-canvas-handle" type="target" position={Position.Left} id="input" />
        <Handle className="ad-canvas-handle" type="source" position={Position.Right} id="output" />

      <header className="ad-node-head">
        <span className="ad-node-kind">
          {getKindIcon(canvasNode.kind)}
          {canvasNode.type}
        </span>
        <span className="ad-node-status">{statusLabels[canvasNode.status]}</span>
      </header>

      <button
        className="ad-node-title nodrag"
        type="button"
        onClick={(event) => {
          stopCanvasClick(event);
          data.onOpenNode(canvasNode.id);
        }}
      >
        {canvasNode.title}
      </button>

      <NodePreview data={data} selected={selected} editorRef={textEditorRef} />

      <div className="ad-node-meta">
        <span>{canvasNode.model}</span>
        <span>{canvasNode.time}</span>
        <span>{canvasNode.cost}</span>
      </div>

      <div className="ad-node-foot">
        <span>v{canvasNode.version}</span>
        <span>{parentTitles.length ? `Refs ${parentTitles.length}` : "No refs"}</span>
        {isLocked ? <Lock size={13} /> : <LockOpen size={13} />}
      </div>

        {canvasNode.staleReason ? <p className="ad-node-warning">{canvasNode.staleReason}</p> : null}
        <VersionStrip data={data} />
      </article>
    </>
  );
}

export const adCanvasNodeTypes = {
  adCanvasNode: CanvasNodeRenderer
};
