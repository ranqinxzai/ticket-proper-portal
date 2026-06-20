"use client";

import { Toaster as SonnerToaster } from "sonner";

import { useTheme } from "@/components/theme/theme-provider";

export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <SonnerToaster
      theme={resolvedTheme}
      richColors
      closeButton
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "rounded-md border shadow-md",
        },
      }}
    />
  );
}
