import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { loadInstallationConfig } from "@/config/installation";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const installation = await loadInstallationConfig();
  return {
    metadataBase: new URL(installation.publicUrl),
    title: {
      default: `${installation.branding.productName} · ${installation.companyName}`,
      template: `%s · ${installation.branding.productName}`,
    },
    description: `Company Brain privado de ${installation.companyName}.`,
    icons: {
      icon: installation.branding.faviconPath,
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ca">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
