import { AppRoutePage, getAppRouteMetadata } from "@/app/_shared/app-route-page";

export const metadata = getAppRouteMetadata("templates");

export default function AdTemplateLibraryPage() {
  return <AppRoutePage route="templates" />;
}
