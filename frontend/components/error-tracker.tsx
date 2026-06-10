"use client";

import { useEffect } from "react";

export default function ErrorTracker() {
  useEffect(() => {
    try {
      // Initialize error tracking if available
      if (typeof window !== "undefined") {
        window.addEventListener("error", (event) => {
          console.error("Uncaught error:", event.error);
        });

        window.addEventListener("unhandledrejection", (event) => {
          console.error("Unhandled rejection:", event.reason);
        });
      }
    } catch (err) {
      console.error("Error tracker initialization failed:", err);
    }
  }, []);

  return null;
}
