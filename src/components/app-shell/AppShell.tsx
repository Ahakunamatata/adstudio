"use client";

import type { ReactNode } from "react";
import type { AppRoute, CanvasNode } from "@/lib/domain/schemas";
import { NodeDrawer } from "./NodeDrawer";
import { RailNav } from "./RailNav";
import { Toast } from "./Toast";
import { Topbar } from "./Topbar";

type AppShellProps = {
  route: AppRoute;
  drawerNode: CanvasNode | null;
  toastText: string;
  toastVisible: boolean;
  onRouteChange: (route: AppRoute) => void;
  onCloseDrawer: () => void;
  children: ReactNode;
};

export function AppShell({
  route,
  drawerNode,
  toastText,
  toastVisible,
  onRouteChange,
  onCloseDrawer,
  children
}: AppShellProps) {
  const workspaceClassName = route === "workbench" ? "workspace is-workbench" : "workspace";

  return (
    <>
      <div className="app-shell">
        <RailNav route={route} onRouteChange={onRouteChange} />
        <main className={workspaceClassName}>
          {route !== "workbench" ? <Topbar route={route} /> : null}
          {children}
        </main>
      </div>
      {route !== "workbench" ? <NodeDrawer node={drawerNode} onClose={onCloseDrawer} /> : null}
      <Toast text={toastText} visible={toastVisible} />
    </>
  );
}
