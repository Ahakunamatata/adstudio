import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ad Studio",
  description: "AI Ad Production Studio for Performance Creatives",
  icons: {
    icon: [
      { url: "/favicon.ico?v=20260517-dedicated", type: "image/x-icon" },
      { url: "/brand/ad-studio-favicon.png?v=20260517-dedicated", type: "image/png", sizes: "512x512" }
    ],
    shortcut: [{ url: "/favicon.ico?v=20260517-dedicated", type: "image/x-icon" }]
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
