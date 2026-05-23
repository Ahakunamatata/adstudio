import { AppRoutePage, getAppRouteMetadata } from "@/app/_shared/app-route-page";

export const metadata = getAppRouteMetadata("workbench");

export default function AdWorkbenchPage() {
  return <AppRoutePage route="workbench" />;
}
