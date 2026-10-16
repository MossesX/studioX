/**
 * @file `/theme-designer` — the authoring surface for the theme engine.
 *
 * A route, not a registered asset, for the same reason `/brand` is one: it is a
 * tool for judging and editing the app's own appearance, and registering it
 * would imply it is part of what a peeled app ships. The split core states
 * (`theme/index.ts`) is that the ENGINE peels and the DESIGNER does not.
 *
 * A surface with no route is not a tool, so this file is part of the designer
 * rather than a follow-up to it.
 *
 * Chrome — style root, MUI provider, banner, nav, dashboard wrapper — is all
 * `StudioShell`'s, mounted once in `app/layout.tsx`. This page renders content
 * only, which is why it mounts no provider and is themed anyway.
 */
import ThemeDesigner from "../../src/plugins/theme-designer/ThemeDesigner";

export const dynamic = "force-dynamic";

export default function ThemeDesignerPage() {
  return <ThemeDesigner />;
}
