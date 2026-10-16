/**
 * @file `/firecrawl` — the Firecrawl route.
 *
 * The route does NOT boot and does NOT import the screen: `BootedHost` boots
 * the client graph and resolves the module from the registry by id (same
 * contract as `/` and `/taskman`).
 */
import BootedHost from "../../src/BootedHost";

export default function FirecrawlPage() {
  return <BootedHost moduleId="firecrawl" />;
}
