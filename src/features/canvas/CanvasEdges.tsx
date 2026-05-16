"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Position,
  getBezierPath,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeProps
} from "@xyflow/react";
import type { AdCanvasFlowNode, EdgeFlowVariant } from "./types";

export const AD_CANVAS_EDGE_TYPE = "adCanvasBezier";

type FlowSegment = {
  d: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
};

function createPathGeometry(path: string) {
  if (typeof document === "undefined") return null;

  const element = document.createElementNS("http://www.w3.org/2000/svg", "path");
  element.setAttribute("d", path);

  return {
    element,
    totalLength: element.getTotalLength()
  };
}

function formatPoint(value: number) {
  return Number(value.toFixed(3));
}

function buildFlowSegment(element: SVGPathElement, totalLength: number, start: number, end: number): FlowSegment | null {
  const safeStart = Math.max(0, Math.min(totalLength, start));
  const safeEnd = Math.max(0, Math.min(totalLength, end));

  if (safeEnd - safeStart < 6) return null;

  const distance = safeEnd - safeStart;
  const steps = Math.max(12, Math.ceil(distance / 4.8));
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const position = safeStart + (distance * index) / steps;
    const point = element.getPointAtLength(position);

    return {
      x: formatPoint(point.x),
      y: formatPoint(point.y)
    };
  });

  if (points.length < 2) return null;

  return {
    d: points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x},${point.y}`).join(" "),
    from: points[0],
    to: points[points.length - 1] ?? points[0]
  };
}

function useEdgeFlowPhase(active: boolean, variant: EdgeFlowVariant) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let frameId = 0;
    const startedAt = performance.now();
    const speed = variant === "pulse" ? 0.104 : variant === "hovered" ? 0.084 : variant === "draft" ? 0.076 : 0.066;

    const tick = (now: number) => {
      setPhase((now - startedAt) * speed);
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [active, variant]);

  return phase;
}

function getFlowColors(variant: EdgeFlowVariant) {
  if (variant === "stale" || variant === "draft") {
    return {
      outer: "rgba(201, 255, 80, 0.38)",
      inner: "rgba(217, 255, 132, 0.78)",
      solid: "rgba(201, 255, 80, 0.98)"
    };
  }

  if (variant === "pulse" || variant === "hovered") {
    return {
      outer: "rgba(201, 255, 80, 0.42)",
      inner: "rgba(217, 255, 132, 0.82)",
      solid: "rgba(201, 255, 80, 0.98)"
    };
  }

  return {
    outer: "rgba(201, 255, 80, 0.34)",
    inner: "rgba(217, 255, 132, 0.68)",
    solid: "rgba(201, 255, 80, 0.92)"
  };
}

function EdgeFlowSegments({
  edgeId,
  path,
  variant,
  bounds
}: {
  edgeId: string;
  path: string;
  variant: EdgeFlowVariant;
  bounds: { x: number; y: number; width: number; height: number };
}) {
  const active = variant !== "idle";
  const phase = useEdgeFlowPhase(active, variant);
  const geometry = useMemo(() => createPathGeometry(path), [path]);

  const segments = useMemo(() => {
    if (!active || !geometry || geometry.totalLength < 40) return [];

    const segmentCount = 3;
    const segmentLength = Math.min(60, Math.max(34, geometry.totalLength * 0.12));
    const edgeMargin = Math.min(34, Math.max(18, geometry.totalLength * 0.08));
    const usableLength = Math.max(segmentLength + 1, geometry.totalLength - edgeMargin * 2);
    const spacing = usableLength / segmentCount;
    const cycleOffset = phase % spacing;

    return Array.from({ length: segmentCount }, (_, index) => {
      const center = edgeMargin + ((cycleOffset + index * spacing) % usableLength);
      return buildFlowSegment(geometry.element, geometry.totalLength, center - segmentLength / 2, center + segmentLength / 2);
    }).filter((segment): segment is FlowSegment => segment !== null);
  }, [active, geometry, phase]);

  if (!segments.length) return null;

  const colors = getFlowColors(variant);
  const filterId = `ad-edge-flow-filter-${edgeId}`;

  return (
    <g className={`ad-canvas-edge__flow ad-canvas-edge__flow--${variant}`}>
      <defs>
        <filter
          id={filterId}
          filterUnits="userSpaceOnUse"
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blurOuter" />
          <feFlood floodColor={colors.outer} result="floodOuter" />
          <feComposite in="blurOuter" in2="floodOuter" operator="in" result="glowOuter" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blurInner" />
          <feFlood floodColor={colors.inner} result="floodInner" />
          <feComposite in="blurInner" in2="floodInner" operator="in" result="glowInner" />
          <feMerge>
            <feMergeNode in="glowOuter" />
            <feMergeNode in="glowInner" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {segments.map((segment, index) => {
        const gradientId = `ad-edge-flow-grad-${edgeId}-${index}`;

        return (
          <g key={gradientId}>
            <defs>
              <linearGradient
                id={gradientId}
                x1={segment.from.x}
                y1={segment.from.y}
                x2={segment.to.x}
                y2={segment.to.y}
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="rgba(201, 255, 80, 0)" />
                <stop offset="100%" stopColor={colors.solid} />
              </linearGradient>
            </defs>
            <path
              d={segment.d}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth={variant === "hovered" || variant === "pulse" ? 4.2 : 4}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${filterId})`}
            />
          </g>
        );
      })}
    </g>
  );
}

export function DraftConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition
}: ConnectionLineComponentProps<AdCanvasFlowNode>) {
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    targetX: toX,
    targetY: toY,
    sourcePosition: fromPosition ?? Position.Right,
    targetPosition: toPosition ?? (fromPosition === Position.Left ? Position.Right : Position.Left)
  });

  return (
    <g className="ad-canvas-connectionline">
      <path className="ad-canvas-connectionline__hit" d={path} fill="none" />
      <path className="ad-canvas-connectionline__glow" d={path} fill="none" />
      <path className="ad-canvas-connectionline__core" d={path} fill="none" />
    </g>
  );
}

function AdCanvasBezierEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data
}: EdgeProps<Edge<{ flowVariant?: EdgeFlowVariant }>>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  });
  const flowVariant = data?.flowVariant ?? "idle";
  const flowBounds = {
    x: Math.min(sourceX, targetX) - 28,
    y: Math.min(sourceY, targetY) - 28,
    width: Math.abs(sourceX - targetX) + 56,
    height: Math.abs(sourceY - targetY) + 56
  };

  return (
    <>
      <path
        className="ad-canvas-edge__hit react-flow__edge-interaction"
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        pointerEvents="stroke"
      />
      <path className="ad-canvas-edge__path react-flow__edge-path" d={path} fill="none" style={style} />
      <EdgeFlowSegments edgeId={id} path={path} variant={flowVariant} bounds={flowBounds} />
    </>
  );
}

export const adCanvasEdgeTypes = {
  [AD_CANVAS_EDGE_TYPE]: AdCanvasBezierEdge
};
