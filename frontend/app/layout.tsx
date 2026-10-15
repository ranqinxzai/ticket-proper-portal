import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEME_SCRIPT, ThemeProvider } from "@/components/theme/theme-provider";
import { DENSITY_SCRIPT, DensityProvider } from "@/components/theme/density-provider";

const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OneDesk — Multi-Department Helpdesk",
  description:
    "ManageEngine-inspired ITSM platform: incidents, service requests, SLAs, approvals and a self-service portal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontSans.variable} suppressHydrationWarning>
      <head>
        {/* Render-before-paint theme class to avoid a flash of the wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* Same for display density (data-density on <html>; compact by default). */}
        <script dangerouslySetInnerHTML={{ __html: DENSITY_SCRIPT }} />
      </head>
      <body className="antialiased">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <ThemeProvider>
          <DensityProvider>
            <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
            <Toaster />
          </DensityProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
