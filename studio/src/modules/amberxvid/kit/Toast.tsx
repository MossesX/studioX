/**
 * @file App-global toast, ported from GizmoX's `components/core/Toast.tsx`
 * into the amberxvid kit (PORT NOTE: in GizmoX the shell mounted the provider
 * app-wide; here the module mounts it at its own root). Styling comes from the
 * MUI theme, so nothing here reads GX directly.
 *
 * Usage:
 *   const toast = useToast();       // always callable; no-op if unmounted
 *   toast("Saved", "3 files");
 *
 * `useOptionalToast()` returns `null` when no provider is mounted, so a
 * component can fall back to its own local Snackbar instead of silently
 * dropping the message.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";

/** Signature shared with the modules' snackbars. */
export type ToastFn = (msg: string, sub?: string) => void;

/** `null` means "no provider mounted" — distinguishable from a no-op. */
const ToastCtx = React.createContext<ToastFn | null>(null);

const NOOP: ToastFn = () => {};

/** Always callable. Returns a no-op when no provider is mounted. */
export const useToast = (): ToastFn => React.useContext(ToastCtx) ?? NOOP;

/** `null` when no provider is mounted — for callers that own a fallback. */
export const useOptionalToast = (): ToastFn | null => React.useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = React.useState<string | null>(null);
  const [sub, setSub] = React.useState("");

  const toast = React.useCallback<ToastFn>((m, s = "") => {
    setMsg(m);
    setSub(s);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <Snackbar
        open={msg !== null}
        autoHideDuration={2600}
        onClose={() => setMsg(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        message={
          <Box>
            <Typography sx={{ fontSize: 13 }}>{msg}</Typography>
            {sub && (
              <Typography sx={{ fontSize: 11, color: "text.disabled" }}>{sub}</Typography>
            )}
          </Box>
        }
        slotProps={{
          content: {
            sx: {
              bgcolor: "background.paper",
              color: "text.primary",
              border: "1px solid",
              borderColor: "divider",
              borderLeft: "3px solid",
              borderLeftColor: "primary.main",
              borderRadius: "9px"
            }
          }
        }}
      />
    </ToastCtx.Provider>
  );
}
