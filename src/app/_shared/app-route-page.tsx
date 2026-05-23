import type { Metadata } from "next";
import { AdStudioApp } from "@/components/app-shell/AdStudioApp";
import type { AppRoute } from "@/lib/domain/schemas";
import { routeSeo } from "@/lib/routes/routes";

export function getAppRouteMetadata(route: AppRoute): Metadata {
  const metadata = routeSeo[route];
  return {
    title: metadata.title,
    description: metadata.description,
    robots: metadata.indexable ? undefined : { index: false, follow: false }
  };
}

export function AppRoutePage({ route }: { route: AppRoute }) {
  return <AdStudioApp key={route} initialRoute={route} />;
}
