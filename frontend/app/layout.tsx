import "./globals.css";
import type { Metadata } from "next";

import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEME_SCRIPT, ThemeProvider } from "@/components/theme/theme-provider";

export const metadata: Metadata = {
  title: "One Helpdesk — Multi-Department Helpdesk",
  description:
    "ManageEngine-inspired ITSM platform: incidents, service requests, SLAs, approvals and a self-service portal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Render-before-paint theme class to avoid a flash of the wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <ThemeProvider>
          <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
