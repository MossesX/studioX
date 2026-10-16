/**
 * @file `ForgeScreen` — the composition of the Forge's two halves.
 *
 * Two concurrent sessions built this module on 2026-08-13 (see the decl's
 * merge note): a roster INSPECTOR (`ForgeModule.tsx` — every persona and
 * skill across the studio / project / user scopes, shadowing visible, with
 * the compiled brief) and a DESIGNER (`ForgeDesigner.tsx` — assistant-agent
 * CRUD, Claude agent/skill writers, tool definitions, `.mcp.json` with
 * launch / stop / handshake-test). This wrapper is the ONE place they meet:
 * a tab strip with the inspector first, the designer surfaces after. Neither
 * half imports the other, so either session can keep evolving its file
 * without touching this seam.
 *
 * The root marks `data-axf-area="forge.surface"` — the decl declares that
 * area, and the conformance scan requires the marker in a module `.tsx`.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";

import RosterInspector from "./ForgeModule";
import { AssistantAgentsTab, ClaudeTab, McpTab, ToolsTab } from "./ForgeDesigner";

const TABS = [
  { id: "roster", label: "Roster" },
  { id: "agents", label: "Assistant agents" },
  { id: "claude", label: "Edit agents & skills" },
  { id: "tools", label: "Tools" },
  { id: "mcp", label: "MCP servers" }
] as const;

export default function ForgeScreen() {
  const [tab, setTab] = React.useState<(typeof TABS)[number]["id"]>("roster");
  return (
    <Box
      data-axf-area="forge.surface"
      sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ minHeight: 34, px: 1, flexShrink: 0 }}>
        {TABS.map((t) => (
          <Tab key={t.id} value={t.id} label={t.label} sx={{ minHeight: 34, py: 0, fontSize: 12 }} />
        ))}
      </Tabs>
      {tab === "roster" ? (
        // The inspector owns its own layout and scrolling; it fills the rest.
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <RosterInspector />
        </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", p: 1.2, gap: 1 }}>
          {tab === "agents" && <AssistantAgentsTab />}
          {tab === "claude" && <ClaudeTab />}
          {tab === "tools" && <ToolsTab />}
          {tab === "mcp" && <McpTab />}
        </Box>
      )}
    </Box>
  );
}
