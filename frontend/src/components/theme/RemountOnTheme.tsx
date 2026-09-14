"use client";

import { Fragment, type ReactNode } from "react";
import { useTheme } from "@/components/theme/useTheme";

/** Rebuilds its children when the theme changes, for widgets that read the theme only once (Google Maps). */
export function RemountOnTheme({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return <Fragment key={theme}>{children}</Fragment>;
}
