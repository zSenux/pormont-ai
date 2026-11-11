import type { MetadataRoute } from "next";

// „Zum Home-Bildschirm“ (iPhone/Safari) bzw. „Installieren“ (Android, Chrome, Edge)
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Jarvis – ProMont",
    short_name: "Jarvis",
    description: "KI-Assistent der ProMont GmbH",
    lang: "de",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#092f50",
    theme_color: "#092f50",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Jarvis fragen", url: "/jarvis" },
      { name: "Sprechen", url: "/jarvis?sprechen=1" },
      { name: "Belege", url: "/belege" },
      { name: "Aufgaben", url: "/aufgaben" },
    ],
  };
}
