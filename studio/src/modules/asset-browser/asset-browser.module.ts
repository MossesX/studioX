/**
 * @file The Asset Browser — declaration composed with its component.
 *
 * The declaration lives in `asset-browser.decl.ts`, data-only, so the registry,
 * the peel and the suite resolver can read it without loading React. This file
 * is the ONLY place the declaration and the screen meet, and `defineModule`
 * validates the result.
 */
import { defineModule } from "@axf/core";

import AssetBrowserModule from "./AssetBrowserModule";
import { ASSET_BROWSER_DECL } from "./asset-browser.decl";

export const ASSET_BROWSER_MODULE = defineModule({
  ...ASSET_BROWSER_DECL,
  component: AssetBrowserModule
});
