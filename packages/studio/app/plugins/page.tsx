/**
 * @file `/plugins` — the Plugin Manager.
 *
 * A route, not a registered asset, for the reason `/docs`, `/brand` and
 * `/settings` are routes: it manages THIS install rather than shipping with a
 * peeled app, and a module would spend a suite slot on a page that fails
 * §4.6's first clause. The surface itself is a PLUGIN
 * (`src/plugins/plugin-manager/`), announced on `studio.plugin` like every
 * other — the manager lists itself, which is the dog food.
 *
 * Chrome is `StudioShell`'s, mounted once in `app/layout.tsx`; this page
 * renders content only.
 */
import PluginManagerPage from "../../src/plugins/plugin-manager/PluginManagerPage";

export const dynamic = "force-dynamic";

export default function PluginsPage() {
  return <PluginManagerPage />;
}
