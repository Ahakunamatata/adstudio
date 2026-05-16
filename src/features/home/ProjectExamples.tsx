"use client";

import { projectExamples } from "@/lib/mock-data";

export function ProjectExamples() {
  return (
    <div className="agent-proof">
      <div className="section-head">
        <div>
          <h3>Agent 项目示例</h3>
        </div>
      </div>
      <div className="example-row">
        {projectExamples.map((example) => (
          <article className="example-card" key={example.title}>
            <div className={`example-preview ${example.className}`}>
              <span>{example.label}</span>
              <div className="mini-node n1" />
              <div className="mini-node n2" />
              <div className="mini-node n3" />
            </div>
            <h4>{example.title}</h4>
            <p>{example.subtitle}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
