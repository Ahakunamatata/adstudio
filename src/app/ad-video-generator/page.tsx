import { AppRoutePage, getAppRouteMetadata } from "@/app/_shared/app-route-page";

export const metadata = getAppRouteMetadata("video");

export default function AdVideoGeneratorPage() {
  return <AppRoutePage route="video" />;
}
