/**
 * @file Client-side boot, on its own so any route can pull it in.
 *
 * The registry is per-runtime: booting in a server component populates the
 * server's registry and leaves the browser's empty. Any route whose tree reads
 * the registry or the pack registry from the client needs this.
 */
"use client";

import { boot } from "./boot";

void boot();

export default function BootClient() {
  return null;
}
