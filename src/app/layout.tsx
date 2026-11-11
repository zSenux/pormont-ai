import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerSetup } from "@/components/pwa";

export const metadata: Metadata = {
  title: { default: "Jarvis · ProMont", template: "%s · Jarvis ProMont" },
  description: "KI-Assistent der ProMont GmbH mit Lexware-Anbindung",
  applicationName: "Jarvis ProMont",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.png", apple: "/apple-icon.png" },
  appleWebApp: { capable: true, title: "Jarvis", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#092f50",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" />
      </head>
      <body className="min-h-dvh">
        {children}
        <ServiceWorkerSetup />
      </body>
    </html>
  );
}
