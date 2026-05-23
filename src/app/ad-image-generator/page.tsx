import { AppRoutePage, getAppRouteMetadata } from "@/app/_shared/app-route-page";

export const metadata = getAppRouteMetadata("image");

export default function AdImageGeneratorPage() {
  return <AppRoutePage route="image" />;
}
