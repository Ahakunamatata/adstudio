import { AppRoutePage, getAppRouteMetadata } from "@/app/_shared/app-route-page";

export const metadata = getAppRouteMetadata("assets");

export default function AdAssetLibraryPage() {
  return <AppRoutePage route="assets" />;
}
