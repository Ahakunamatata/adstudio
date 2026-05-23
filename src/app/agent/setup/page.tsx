import type { Metadata } from "next";
import { AdStudioApp } from "@/components/app-shell/AdStudioApp";
import { routeSeo } from "@/lib/routes/routes";

export const metadata: Metadata = {
  title: routeSeo["agent-setup"].title,
  description: routeSeo["agent-setup"].description,
  robots: {
    index: false,
    follow: false
  }
};

export default function AgentSetupPage() {
  return <AdStudioApp key="agent-setup" initialRoute="agent-setup" />;
}
