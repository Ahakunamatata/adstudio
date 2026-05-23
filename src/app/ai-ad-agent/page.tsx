import { AppRoutePage, getAppRouteMetadata } from "@/app/_shared/app-route-page";

export const metadata = getAppRouteMetadata("agent");

export default function AiAdAgentPage() {
  return <AppRoutePage route="agent" />;
}
