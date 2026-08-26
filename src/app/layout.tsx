import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import type { CSSProperties } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { resolveUiInstallationBranding } from "@/ui/installation-branding";
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

export function generateMetadata(): Metadata {
  const branding = resolveUiInstallationBranding();
  return {
    applicationName: branding.productName,
    title: {
      default: branding.productName,
      template: `%s · ${branding.productName}`,
    },
    description: `Espacio de trabajo privado de ${branding.companyName}.`,
    icons: [{ rel: "icon", url: branding.faviconPath }],
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const branding = resolveUiInstallationBranding();
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
