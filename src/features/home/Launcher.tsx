"use client";

import { ArrowUp, Bot, ChevronDown, Image as ImageIcon, Settings2, SlidersHorizontal, Sparkles, Video } from "lucide-react";
import { useState } from "react";
import type { GenerationKind, GenerationParam, GenerationParamValue } from "@/features/generation/types";
import type { AgentMode, AppRoute } from "@/lib/domain/schemas";
import {
  estimateGenerationCredits,
  generationDefaults,
  getActiveGenerationParams,
  getActiveGenerationSlots,
  getDefaultGenerationModel,
  getDefaultGenerationParamValues,
  launcherCopy
} from "@/lib/mock-data";

type LauncherMode = "agent" | "video" | "image";

type LauncherProps = {
  onRouteChange: (route: AppRoute) => void;
  onStartAgent: (mode: AgentMode, prompt: string) => void;
  onStartGeneration?: (kind: GenerationKind, prompt: string) => void;
  promptId?: string;
  showTabs?: boolean;
};

function getParamDisplayValue(param: GenerationParam, value: GenerationParamValue | undefined) {
  const option = param.options?.find((item) => String(item.value) === String(value));
  return option?.label ?? String(value ?? param.defaultValue ?? "Auto");
}

export function Launcher({ onRouteChange, onStartAgent, onStartGeneration, promptId = "launcher-prompt", showTabs = true }: LauncherProps) {
  const [mode, setMode] = useState<LauncherMode>("agent");
  const [agentMode, setAgentMode] = useState<AgentMode>("clone");
  const [prompt, setPrompt] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const isAgent = mode === "agent";
  const generationKind = isAgent ? null : mode;
  const copy = isAgent ? launcherCopy.agent[agentMode] : launcherCopy[mode];

  function runAction() {
    if (mode === "agent") {
      onStartAgent(agentMode, prompt.trim());
      return;
    }
    if (onStartGeneration) {
      onStartGeneration(mode, prompt.trim());
      return;
    }
    onRouteChange(mode);
  }

  function renderAgentInput() {
    return (
      <div className="launcher-input-shell">
        <div className="launcher-main-area">
          <div className="launcher-assets">
            <button className="asset-slot product-slot" type="button">
              <span className="slot-icon">FL</span>
              <strong>产品包</strong>
              <small>Family Locator</small>
            </button>
            <button className="asset-slot competitor-slot" type="button" hidden={agentMode === "create"}>
              <span className="slot-icon add-icon">+</span>
              <strong>竞品素材</strong>
              <small>图片 / 视频</small>
            </button>
            <button className="asset-slot optional-slot" type="button">
              <span className="slot-icon ref-icon" />
              <strong>{agentMode === "create" ? "创意参考" : "参考素材"}</strong>
              <small>可选</small>
            </button>
          </div>

          <div className="launcher-prompt-area">
            <textarea
              id={promptId}
              className="launcher-prompt"
              aria-label="Task prompt"
              placeholder={copy.placeholder}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </div>
        </div>

        <div className="launcher-controls">
          <div className="launcher-chips">
            <div className="type-picker">
              <button className="control-chip type-trigger" type="button" onClick={() => setMenuOpen((open) => !open)}>
                <Bot className="chip-icon" size={18} />
                <span>{agentMode === "clone" ? "复刻广告" : "创作广告"}</span>
                <ChevronDown className="chevron" size={14} />
              </button>
              <div className="type-menu" hidden={!menuOpen}>
                <button
                  className={agentMode === "clone" ? "is-selected" : ""}
                  type="button"
                  onClick={() => {
                    setAgentMode("clone");
                    setMenuOpen(false);
                  }}
                >
                  <strong>复刻广告</strong>
                  <small>拆解竞品，再迁移到你的产品</small>
                </button>
                <button
                  className={agentMode === "create" ? "is-selected" : ""}
                  type="button"
                  onClick={() => {
                    setAgentMode("create");
                    setMenuOpen(false);
                  }}
                >
                  <strong>创作广告</strong>
                  <small>从产品包推导新广告方向</small>
                </button>
              </div>
            </div>
            <button className="control-chip" type="button">
              泰国 / 泰语
            </button>
            <button className="control-chip" type="button">
              TikTok
            </button>
            <button className="control-chip" type="button">
              9:16
            </button>
            <button className="control-chip" type="button">
              15s
            </button>
            <button className="control-chip settings-chip" type="button" aria-label="高级选项">
              <Settings2 size={16} />
            </button>
          </div>
          <div className="launcher-right-actions">
            <span className="launcher-credit">✦ 0</span>
            <button className="launcher-send" type="button" aria-label={copy.cta} title={copy.cta} onClick={runAction}>
              <ArrowUp size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderGenerationInput(kind: GenerationKind) {
    const catalog = generationDefaults[kind];
    const selectedModel = getDefaultGenerationModel(kind);
    const selectedMode = catalog.modes.find((item) => item.key === selectedModel.defaultModeKey) ?? catalog.modes[0];
    const paramValues = getDefaultGenerationParamValues(selectedModel);
    const activeSlots = getActiveGenerationSlots(kind, selectedModel.id, selectedMode.key);
    const activeParams = getActiveGenerationParams(kind, selectedModel.id, selectedMode.key);
    const basicParams = activeParams.filter((param) => param.visibility === "basic");
    const internalParams = activeParams.filter((param) => param.visibility === "internal");
    const credits = estimateGenerationCredits(kind, selectedModel.id, paramValues);

    return (
      <div className="home-generation-composer" data-generator={kind}>
        <div className="composer-dialog generation-composer-dialog">
          <div className="composer-main-area">
            <div className="composer-slots-row" aria-label={`${kind} reference inputs`}>
              {activeSlots.map((slot) => {
                const SlotIcon = slot.kind === "video" ? Video : ImageIcon;

                return (
                  <div className="slot-stack-wrap" key={slot.key}>
                    <button className="slot-stack" type="button" aria-label={`添加${slot.label}`} title={slot.description}>
                      {slot.min > 0 ? <span className="slot-required-mark" aria-hidden="true">*</span> : null}
                      <span className="stack-card add-card">
                        <SlotIcon size={22} />
                        <span className="slot-upload-plus">+</span>
                      </span>
                      <span className="slot-label" data-kind={slot.kind}>{slot.shortLabel}</span>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="composer-prompt-area">
              <textarea
                id={`${promptId}-${kind}`}
                className="composer-prompt"
                aria-label={kind === "video" ? "Ad Video prompt" : "Ad Image prompt"}
                placeholder={catalog.placeholder}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </div>
          </div>

          <div className="generation-composer-context">
            <span>{selectedModel.description}</span>
            {internalParams.length ? <span>{internalParams.length} internal param reserved</span> : null}
          </div>

          <div className="composer-bottom-bar">
            <button className="pill-btn" type="button" onClick={() => onRouteChange(kind)}>
              {kind === "video" ? <Video size={16} /> : <ImageIcon size={16} />}
              <span>{catalog.taskLabel}</span>
              <span className="chevron">▾</span>
            </button>
            <button className="pill-btn" type="button" onClick={() => onRouteChange(kind)}>
              <span className="dot" />
              <span>{selectedModel.displayName}</span>
              <span className="chevron">▾</span>
            </button>
            {kind === "video" ? (
              <button className="pill-btn" type="button" onClick={() => onRouteChange(kind)}>
                <span>{selectedMode.label}</span>
                <span className="chevron">▾</span>
              </button>
            ) : null}
            {basicParams.map((param) => (
              <button className="pill-btn config-pill-btn" type="button" key={param.id} onClick={() => onRouteChange(kind)}>
                <span className="config-summary-label">{param.label}</span>
                <span className="config-summary-sep">·</span>
                <span>{getParamDisplayValue(param, paramValues[param.id])}</span>
                <span className="chevron">▾</span>
              </button>
            ))}
            <button className="pill-btn advanced-icon-btn" type="button" aria-label="高级选项" onClick={() => onRouteChange(kind)}>
              <SlidersHorizontal size={16} />
            </button>
            <div className="spacer" />
            <div className="composer-right-actions">
              <span className="token-count">
                <Sparkles size={13} />
                <span>{prompt.trim() ? credits : 0}</span>
              </span>
              <button className="send-btn" type="button" aria-label={copy.cta} title={copy.cta} onClick={runAction}>
                <ArrowUp size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-hub">
      {showTabs ? (
        <div className="launcher-tabs" aria-label="Create mode">
          <button className={`launcher-tab ${mode === "agent" ? "is-active" : ""}`} type="button" onClick={() => setMode("agent")}>
            <span className="mode-icon icon-agent" aria-hidden="true" />
            <strong>Agent</strong>
          </button>
          <button className={`launcher-tab ${mode === "video" ? "is-active" : ""}`} type="button" onClick={() => setMode("video")}>
            <span className="mode-icon icon-video" aria-hidden="true" />
            <strong>Video</strong>
          </button>
          <button className={`launcher-tab ${mode === "image" ? "is-active" : ""}`} type="button" onClick={() => setMode("image")}>
            <span className="mode-icon icon-image" aria-hidden="true" />
            <strong>Image</strong>
          </button>
        </div>
      ) : null}

      <div className={`launcher-card ${generationKind ? "is-generation-mode" : ""}`}>
        <div className="launcher-title-row">
          <div>
            <h2>{copy.title}</h2>
          </div>
          <span className="cost-pill">{copy.pill}</span>
        </div>

        {generationKind ? renderGenerationInput(generationKind) : renderAgentInput()}
      </div>
    </div>
  );
}
