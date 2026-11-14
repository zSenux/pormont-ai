import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Uploads (Dokumente, Baustellenfotos, Belege) bis 15 MB je Datei laufen durch den Proxy
  experimental: { proxyClientMaxBodySize: "40mb", serverActions: { bodySizeLimit: "10mb" } },
  serverExternalPackages: ["imapflow", "mailparser", "nodemailer", "unpdf"],
};

export default nextConfig;
