/**
 * @file Firecrawl — declaration composed with its component. The declaration
 * lives in `firecrawl.decl.ts`, data-only; this file is the ONLY place the
 * two meet, and `defineModule` validates the result (taskman's pattern).
 */
import { defineModule } from "@axf/core";

import FirecrawlModule from "./FirecrawlModule";
import { FIRECRAWL_DECL } from "./firecrawl.decl";

export const FIRECRAWL_MODULE = defineModule({
  ...FIRECRAWL_DECL,
  component: FirecrawlModule
});
