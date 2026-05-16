"use client";

import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowUp,
  FileText,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Video,
  WandSparkles
} from "lucide-react";
import type { CanvasNode, CanvasNodeKind, CanvasNodeSettings } from "@/lib/domain/schemas";
import type { AdCanvasNodeData } from "./types";

type CanvasNodeEditorPopoverProps = {
  node: CanvasNode;
  parentRefs: AdCanvasNodeData["parentRefs"];
  availableRefs: CanvasNode[];
  style?: CSSProperties;
  onClose: () => void;
  onConnectParentRef: (sourceNodeId: string, targetNodeId: string) => void;
  onDisconnectParentRef: (sourceNodeId: string, targetNodeId: string) => void;
  onLockNode: (nodeId: string) => void;
  onRunNode: (nodeId: string) => void;
  onSetPrimaryVersion: (nodeId: string, versionId: string) => void;
  onUpdateNodeSettings: (
    nodeId: string,
    title: string,
    output: string,
    model: string,
    settings?: CanvasNodeSettings
  ) => void;
};

const imageRatioOptions = ["9:16", "1:1", "16:9", "4:5"];
const videoRatioOptions = ["9:16", "16:9", "1:1"];
const imageResolutionOptions = ["1k", "2k", "4k"];
const videoResolutionOptions = ["720p", "1080p"];
const durationOptions = ["4s", "6s", "8s", "10s"];
const batchOptions = ["1", "2", "4"];
const cameraOptions = ["摄影机控制", "固定镜头", "推近", "手持"];

function stopCanvasEvent(event: ReactMouseEvent) {
  event.stopPropagation();
}

function isTextLikeNode(kind: CanvasNodeKind) {
  return kind === "text" || kind === "script" || kind === "prompt" || kind === "plan";
}

function getModelOptions(kind: CanvasNodeKind) {
  if (kind === "image") return ["全能图片V2-低价渠道版", "GPT Image", "Flux 1.1 Pro", "Nano Banana 2"];
  if (kind === "video") return ["happyhorse-1.0", "Seedance 2.0", "Kling 2.1", "Runway Gen-4"];
  if (kind === "upload") return ["Manual Upload", "Asset Library", "Product Pack"];
  return ["Ad Strategy Agent", "Gemini Multimodal", "GPT-4.1 Mini"];
}

function getDefaultSettings(node: CanvasNode): CanvasNodeSettings {
  const common = {
    prompt: node.settings?.prompt ?? node.input
  };

  if (node.kind === "video") {
    return {
      ...common,
      ratio: "9:16",
      resolution: "720p",
      duration: "6s",
      mode: "全能参考",
      batch: "1",
      ...node.settings
    };
  }

  if (node.kind === "image") {
    return {
      ...common,
      ratio: "9:16",
      resolution: "1k",
      camera: "摄影机控制",
      mode: "全景图",
      batch: "1",
      ...node.settings
    };
  }

  return {
    ...common,
    mode: "素材库",
    batch: "1",
    ...node.settings
  };
}

function getGenerationCost(node: CanvasNode) {
  if (node.kind === "video") return node.cost === "0 credits" || node.cost === "待估算" ? "24 credits" : node.cost;
  if (node.kind === "image") return node.cost === "0 credits" ? "8 credits" : node.cost;
  if (node.kind === "upload") return "0 credits";
  return node.cost;
}

function getReferenceKindLabel(kind: CanvasNodeKind, index: number) {
  if (kind === "image" || kind === "upload") return `图片${index + 1}`;
  if (kind === "video") return `视频${index + 1}`;
  return `文本${index + 1}`;
}

function getReferenceIcon(kind: CanvasNodeKind) {
  if (kind === "video") return <Video size={14} />;
  if (kind === "image" || kind === "upload") return <ImageIcon size={14} />;
  return <FileText size={14} />;
}

function ReferencePicker({
  availableRefs,
  onPick
}: {
  availableRefs: CanvasNode[];
  onPick: (nodeId: string) => void;
}) {
  return (
    <div className="ad-panel-ref-picker">
      {availableRefs.length ? (
        availableRefs.map((ref) => (
          <button key={ref.id} type="button" onClick={() => onPick(ref.id)}>
            <span className={`ad-panel-ref-thumb ad-node-preview--${ref.previewClass}`}>{getReferenceIcon(ref.kind)}</span>
            <strong>{ref.title}</strong>
            <small>{ref.type}</small>
          </button>
        ))
      ) : (
        <span>没有可添加的上游节点</span>
      )}
    </div>
  );
}

function InputReferenceStrip({
  node,
  parentRefs,
  availableRefs,
  onAddRef,
  onRemoveRef
}: {
  node: CanvasNode;
  parentRefs: AdCanvasNodeData["parentRefs"];
  availableRefs: CanvasNode[];
  onAddRef: (nodeId: string) => void;
  onRemoveRef: (nodeId: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="ad-panel-ref-zone">
      <div className="ad-panel-ref-row">
        <button
          className="ad-panel-add-ref"
          type="button"
          onClick={() => setPickerOpen((value) => !value)}
          disabled={node.locked || node.status === "locked"}
        >
          <span>+</span>
          添加
        </button>
        {parentRefs.map((ref, index) => (
          <div className={`ad-panel-ref-chip ${node.status === "stale" ? "is-stale" : ""}`} key={ref.id}>
            <span className={`ad-panel-ref-thumb ad-node-preview--${ref.previewClass}`}>{getReferenceIcon(ref.kind)}</span>
            <strong>{getReferenceKindLabel(ref.kind, index)}</strong>
            <small>{node.status === "stale" ? "输入已更新" : ref.title}</small>
            <button type="button" aria-label="Remove reference" onClick={() => onRemoveRef(ref.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
      {pickerOpen ? (
        <ReferencePicker
          availableRefs={availableRefs}
          onPick={(nodeId) => {
            onAddRef(nodeId);
            setPickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function InlineReferenceText({ parentRefs }: { parentRefs: AdCanvasNodeData["parentRefs"] }) {
  if (!parentRefs.length) return null;

  return (
    <div className="ad-panel-inline-refs">
      {parentRefs.slice(0, 4).map((ref, index) => (
        <span key={ref.id}>@{getReferenceKindLabel(ref.kind, index)}</span>
      ))}
    </div>
  );
}

function PanelTabs({
  kind,
  mode,
  onModeChange,
  disabled
}: {
  kind: CanvasNodeKind;
  mode: string;
  onModeChange: (value: string) => void;
  disabled: boolean;
}) {
  if (kind !== "video") return null;

  return (
    <div className="ad-panel-tabs">
      {["全能参考", "首尾帧", "图片参考"].map((tab) => (
        <button
          key={tab}
          type="button"
          className={mode === tab ? "is-active" : ""}
          disabled={disabled}
          onClick={() => onModeChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

function ControlSelect({
  label,
  value,
  options,
  disabled,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="ad-panel-select">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function MediaControls({
  node,
  model,
  settings,
  isLocked,
  isRunning,
  onModelChange,
  onSettingChange,
  onSave,
  onGenerate,
  onLock,
  onUploadClick
}: {
  node: CanvasNode;
  model: string;
  settings: CanvasNodeSettings;
  isLocked: boolean;
  isRunning: boolean;
  onModelChange: (value: string) => void;
  onSettingChange: (key: keyof CanvasNodeSettings, value: string) => void;
  onSave: () => void;
  onGenerate: () => void;
  onLock: () => void;
  onUploadClick: () => void;
}) {
  const modelOptions = Array.from(new Set([model, ...getModelOptions(node.kind)]));

  return (
    <footer className="ad-panel-controls">
      <label className="ad-panel-select ad-panel-model-select">
        <WandSparkles size={13} />
        <select value={model} disabled={isLocked} onChange={(event) => onModelChange(event.target.value)}>
          {modelOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
      {node.kind === "video" ? (
        <>
          <ControlSelect
            label="清晰度"
            value={settings.resolution ?? "720p"}
            options={videoResolutionOptions}
            disabled={isLocked}
            onChange={(value) => onSettingChange("resolution", value)}
          />
          <ControlSelect
            label="时长"
            value={settings.duration ?? "6s"}
            options={durationOptions}
            disabled={isLocked}
            onChange={(value) => onSettingChange("duration", value)}
          />
          <ControlSelect
            label="比例"
            value={settings.ratio ?? "9:16"}
            options={videoRatioOptions}
            disabled={isLocked}
            onChange={(value) => onSettingChange("ratio", value)}
          />
        </>
      ) : null}
      {node.kind === "image" ? (
        <>
          <ControlSelect
            label="比例"
            value={settings.ratio ?? "9:16"}
            options={imageRatioOptions}
            disabled={isLocked}
            onChange={(value) => onSettingChange("ratio", value)}
          />
          <ControlSelect
            label="尺寸"
            value={settings.resolution ?? "1k"}
            options={imageResolutionOptions}
            disabled={isLocked}
            onChange={(value) => onSettingChange("resolution", value)}
          />
          <ControlSelect
            label="镜头"
            value={settings.camera ?? "摄影机控制"}
            options={cameraOptions}
            disabled={isLocked}
            onChange={(value) => onSettingChange("camera", value)}
          />
        </>
      ) : null}
      {node.kind === "upload" ? (
        <button type="button" onClick={onUploadClick} disabled={isLocked}>
          选择文件
        </button>
      ) : null}
      <ControlSelect
        label="数量"
        value={settings.batch ?? "1"}
        options={batchOptions}
        disabled={isLocked}
        onChange={(value) => onSettingChange("batch", value)}
      />
      <button type="button" onClick={onSave} disabled={isLocked}>
        保存
      </button>
      <button type="button" onClick={onLock}>
        {isLocked ? <Lock size={13} /> : <LockOpen size={13} />}
      </button>
      <span className="ad-panel-cost">{getGenerationCost(node)}</span>
      <button className="ad-panel-generate" type="button" onClick={onGenerate} disabled={isLocked || isRunning}>
        {isRunning ? "生成中" : <ArrowUp size={15} />}
      </button>
    </footer>
  );
}

export function CanvasNodeEditorPopover(props: CanvasNodeEditorPopoverProps) {
  const {
    node,
    parentRefs,
    availableRefs,
    style,
    onConnectParentRef,
    onDisconnectParentRef,
    onLockNode,
    onRunNode,
    onUpdateNodeSettings
  } = props;
  const [title, setTitle] = useState(node.title);
  const [model, setModel] = useState(node.model);
  const [settings, setSettings] = useState<CanvasNodeSettings>(() => getDefaultSettings(node));
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isLocked = node.locked || node.status === "locked";
  const isRunning = node.status === "running";

  if (isTextLikeNode(node.kind)) return null;

  function updateSetting(key: keyof CanvasNodeSettings, value: string) {
    setSettings((current) => ({
      ...current,
      [key]: value
    }));
  }

  function saveSettings(nextSettings = settings) {
    onUpdateNodeSettings(node.id, title.trim() || node.title, node.output, model, nextSettings);
  }

  function generate() {
    saveSettings();
    onRunNode(node.id);
  }

  function handleUpload(fileName: string) {
    const nextSettings = {
      ...settings,
      uploadedFileName: fileName,
      prompt: settings.prompt || `上传素材：${fileName}`
    };
    setSettings(nextSettings);
    onUpdateNodeSettings(node.id, title.trim() || node.title, `上传素材：${fileName}`, model, nextSettings);
  }

  return (
    <aside
      className={`ad-node-generation-panel ad-node-generation-panel--${node.kind} nodrag nopan`}
      onClick={stopCanvasEvent}
      onDoubleClick={stopCanvasEvent}
      onMouseDown={stopCanvasEvent}
      style={style}
    >
      <PanelTabs
        kind={node.kind}
        mode={settings.mode ?? "全能参考"}
        disabled={isLocked}
        onModeChange={(value) => updateSetting("mode", value)}
      />
      <label className="ad-panel-title-field">
        <span>节点名称</span>
        <input value={title} disabled={isLocked} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <InputReferenceStrip
        node={node}
        parentRefs={parentRefs}
        availableRefs={availableRefs}
        onAddRef={(nodeId) => onConnectParentRef(nodeId, node.id)}
        onRemoveRef={(nodeId) => onDisconnectParentRef(nodeId, node.id)}
      />
      <label className="ad-panel-prompt">
        <span>{node.kind === "upload" ? "素材说明" : "描述你想要生成的内容，使用 @ 引用上游素材"}</span>
        <InlineReferenceText parentRefs={parentRefs} />
        <textarea
          value={settings.prompt ?? ""}
          rows={node.kind === "video" ? 5 : 3}
          disabled={isLocked}
          placeholder="描述你想要生成的内容，使用@可快速引用上传的文件，按/呼出指令"
          onChange={(event) => updateSetting("prompt", event.target.value)}
        />
      </label>
      {node.kind === "upload" ? (
        <input
          ref={fileInputRef}
          className="ad-panel-file-input"
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleUpload(file.name);
            event.currentTarget.value = "";
          }}
        />
      ) : null}
      <MediaControls
        node={node}
        model={model}
        settings={settings}
        isLocked={isLocked}
        isRunning={isRunning}
        onModelChange={setModel}
        onSettingChange={updateSetting}
        onSave={() => saveSettings()}
        onGenerate={generate}
        onLock={() => onLockNode(node.id)}
        onUploadClick={() => fileInputRef.current?.click()}
      />
    </aside>
  );
}
