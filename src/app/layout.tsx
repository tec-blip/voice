import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "SalesVoice — Entrena ventas con IA",
    template: "%s | SalesVoice",
  },
  description:
    "Practica roleplay de ventas con un prospecto IA que habla en tiempo real. Mejora tu cierre, manejo de objeciones y llamadas en frio.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://salesvoice.app"
  ),
  openGraph: {
    title: "SalesVoice — Entrena ventas con IA",
    description:
      "Roleplay de ventas con voz IA en tiempo real. Feedback detallado en 6 categorias.",
    siteName: "SalesVoice",
    locale: "es_MX",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SalesVoice — Entrena ventas con IA",
    description:
      "Practica ventas con un prospecto IA que habla en tiempo real.",
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} dark antialiased`}
    >
      <body className="min-h-screen bg-zinc-950 text-white">{children}</body>
    </html>
  );
}
