import type { Metadata } from "next";
import { AdStudioApp } from "@/components/app-shell/AdStudioApp";
import { routeSeo } from "@/lib/routes/routes";

export const metadata: Metadata = {
  title: routeSeo.home.title,
  description: routeSeo.home.description
};

export default function Page() {
  return <AdStudioApp key="home" initialRoute="home" />;
}
