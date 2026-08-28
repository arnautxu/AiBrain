import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import type { CSSProperties } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { loadInstallationConfig } from "@/config/installation";
import { publicInstallationBranding } from "@/config/installation-branding";
import { THEME_BOOTSTRAP_SCRIPT } from "@/ui/theme";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export async function generateMetadata(): Promise<Metadata> {
  const installation = await loadInstallationConfig();
  return {
    metadataBase: new URL(installation.publicUrl),
    applicationName: installation.branding.productName,
    title: {
      default: `${installation.branding.productName} · ${installation.companyName}`,
      template: `%s · ${installation.branding.productName}`,
    },
    description: `Espacio de trabajo privado de ${installation.companyName}.`,
    icons: {
      icon: installation.branding.faviconPath,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = publicInstallationBranding(await loadInstallationConfig());
  const installationStyle = { "--installation-accent": branding.accentColor } as CSSProperties;

  return (
    <html
      lang="es"
      data-installation={branding.installationId}
      data-theme="light"
      suppressHydrationWarning
      style={installationStyle}
    >
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ThemeProvider>{children}</ThemeProvider>
        <Script id="aibrain-theme" strategy="beforeInteractive">
          {THEME_BOOTSTRAP_SCRIPT}
        </Script>
      </body>
    </html>
  );
}
