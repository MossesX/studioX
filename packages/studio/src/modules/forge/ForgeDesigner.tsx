/**
 * @file The Forge's DESIGNER tabs — the write half of the module.
 *
 * Four surfaces over four authored things:
 *
 *   1. **Assistant agents** — the Module Assistant's roster. Create, edit and
 *      delete the `data/assistant/agents/*.md` files; built-in and add-on
 *      agents are listed and shadowable, never destroyed.
 *   2. **Claude agents & skills** — the CLI's `.claude/{agents,skills}` in the
 *      project and user scopes, edited as the REAL files (frontmatter and
 *      all), with the `.md.disabled` rename as the off switch. The `studio`
 *      scope is listed read-only: the house set is SOURCE under
 *      `packages/studio/forge/` and is edited as source.
 *   3. **Tools** — tool definitions as data (`{name, description,
 *      input_schema}`), the authored feed for the MCP bridge.
 *   4. **MCP servers** — the repo's `.mcp.json`, plus launch / stop /
 *      handshake-test on the processes themselves and their live logs.
 *
 * Split from the module's screen on 2026-08-13 when two sessions built the
 * Forge at once: the roster INSPECTOR (`ForgeModule.tsx`) is the read half,
 * these tabs are the write half, and `ForgeScreen.tsx` composes them. See the
 * decl's merge note.
 *
 * Everything destructive respects the module's one setting (`confirmDelete`).
 * All MUI; colours are `token()` strings handed to CSS.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { getModuleSettings, token } from "@axf/core";

import type { AssistantAgent } from "../../plugins/module-assistant/types";
import { PROVIDERS } from "../../plugins/module-assistant/types";

/* ── shared bits ──────────────────────────────────────────────────────────── */

function confirmDelete(what: string): boolean {
  if (getModuleSettings("forge").confirmDelete === false) return true;
  return window.confirm(`Delete ${what}? There is no undo.`);
}

function Note({ text, tone }: { text: string | null; tone?: "ok" | "err" }) {
  if (!text) return null;
  return (
    <Typography sx={{ fontSize: 11.5, color: token(tone ?? "dim"), fontFamily: token("mono") }}>
      {text}
    </Typography>
  );
}

const PANE_SX = {
  p: 1.2,
  display: "flex",
  flexDirection: "column" as const,
  gap: 1,
  minWidth: 0,
  minHeight: 0
};

const LIST_ROW_SX = (selected: boolean) => ({
  px: 1,
  py: 0.6,
  borderRadius: "6px",
  cursor: "pointer",
  border: `1px solid ${selected ? token("accent") : "transparent"}`,
  bgcolor: selected ? `color-mix(in srgb, ${token("accent")} 8%, transparent)` : "transparent",
  "&:hover": { bgcolor: `color-mix(in srgb, ${token("dim")} 8%, transparent)` }
});

/* ── tab 1: assistant agents ──────────────────────────────────────────────── */

export function AssistantAgentsTab() {
  const [agents, setAgents] = React.useState<AssistantAgent[] | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState({
    id: "",
    name: "",
    description: "",
    provider: "",
    model: "",
    system: ""
  });
  const [fresh, setFresh] = React.useState(true);
  const [note, setNote] = React.useState<string | null>(null);
  const [noteTone, setNoteTone] = React.useState<"ok" | "err">("ok");

  const reload = React.useCallback(async () => {
    const res = await fetch("/api/assistant/agents", { cache: "no-store" });
    if (res.ok) setAgents(((await res.json()) as { agents: AssistantAgent[] }).agents);
  }, []);
  React.useEffect(() => void reload(), [reload]);

  const pick = async (id: string) => {
    setSelected(id);
    setFresh(false);
    setNote(null);
    const res = await fetch(`/api/assistant/agents/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const { agent } = (await res.json()) as { agent: AssistantAgent };
    setDraft({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      provider: agent.provider ?? "",
      model: agent.model ?? "",
      system: agent.system ?? ""
    });
  };

  const startNew = () => {
    setSelected(null);
    setFresh(true);
    setNote(null);
    setDraft({ id: "", name: "", description: "", provider: "", model: "", system: "" });
  };

  const save = async () => {
    const method = fresh ? "POST" : "PUT";
    const url = fresh ? "/api/assistant/agents" : `/api/assistant/agents/${draft.id}`;
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: draft.id,
        name: draft.name,
        description: draft.description,
        provider: draft.provider || undefined,
        model: draft.model || undefined,
        system: draft.system
      })
    });
    const body = (await res.json()) as { error?: string };
    setNoteTone(res.ok ? "ok" : "err");
    setNote(res.ok ? `saved data/assistant/agents/${draft.id}.md` : body.error ?? `HTTP ${res.status}`);
    if (res.ok) {
      setFresh(false);
      setSelected(draft.id);
      void reload();
    }
  };

  const remove = async () => {
    if (!selected || !confirmDelete(`agent "${selected}"`)) return;
    const res = await fetch(`/api/assistant/agents/${selected}`, { method: "DELETE" });
    setNoteTone(res.ok ? "ok" : "err");
    setNote(res.ok ? "deleted" : `HTTP ${res.status}`);
    startNew();
    void reload();
  };

  const selectedAgent = agents?.find((a) => a.id === selected);
  const editable = fresh || selectedAgent?.source === "data" || selected === "amber";

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 1.2 }}>
      <Paper variant="outlined" sx={{ ...PANE_SX, width: 260, flexShrink: 0, overflow: "auto" }}>
        <Stack direction="row" sx={{ alignItems: "center" }}>
          <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: token("dim"), flex: 1 }}>
            INSTALLED AGENTS
          </Typography>
          <Button size="small" onClick={startNew}>
            New
          </Button>
        </Stack>
        {!agents && <CircularProgress size={16} />}
        {agents?.map((a) => (
          <Box key={a.id} onClick={() => void pick(a.id)} sx={LIST_ROW_SX(a.id === selected)}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{a.name}</Typography>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
              <Typography sx={{ fontSize: 10.5, fontFamily: token("mono"), color: token("dim") }}>
                {a.id}
              </Typography>
              <Chip label={a.source} size="small" sx={{ height: 14, fontSize: 8.5 }} />
            </Stack>
          </Box>
        ))}
      </Paper>

      <Paper variant="outlined" sx={{ ...PANE_SX, flex: 1, overflow: "auto" }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: token("dim") }}>
          {fresh ? "NEW AGENT" : `EDIT · ${draft.id}`}
        </Typography>
        {!editable && (
          <Typography sx={{ fontSize: 11.5, color: token("warn") }}>
            This agent comes from an installed asset — saving writes a shadowing copy under
            data/assistant/agents that takes precedence.
          </Typography>
        )}
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            label="Id (slug)"
            value={draft.id}
            disabled={!fresh}
            onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
            helperText="lower-case, digits, - _"
          />
          <TextField
            size="small"
            label="Name"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </Stack>
        <TextField
          size="small"
          label="Description"
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
        />
        <Stack direction="row" spacing={1}>
          <TextField
            select
            size="small"
            label="Provider pin"
            value={draft.provider}
            onChange={(e) => setDraft((d) => ({ ...d, provider: e.target.value }))}
            sx={{ minWidth: 180 }}
            helperText="Optional — else the configured one"
          >
            <MenuItem value="">(inherit)</MenuItem>
            {PROVIDERS.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Model pin"
            value={draft.model}
            onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
            helperText="Optional"
          />
        </Stack>
        <TextField
          multiline
          minRows={10}
          label="System prompt (the body IS the agent)"
          value={draft.system}
          onChange={(e) => setDraft((d) => ({ ...d, system: e.target.value }))}
          slotProps={{ input: { sx: { fontFamily: token("mono"), fontSize: 12 } } }}
        />
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Button size="small" variant="contained" onClick={() => void save()} disabled={!draft.id || !draft.name}>
            Save
          </Button>
          {!fresh && selectedAgent?.source === "data" && (
            <Button size="small" color="error" onClick={() => void remove()}>
              Delete
            </Button>
          )}
          <Note text={note} tone={noteTone} />
        </Stack>
      </Paper>
    </Box>
  );
}

/* ── tab 2: claude agents & skills (write half) ───────────────────────────── */

interface RosterEntry {
  scope: "project" | "user" | "studio";
  slug: string;
  name: string;
  description: string;
  disabled: boolean;
}

export function ClaudeTab() {
  const [personas, setPersonas] = React.useState<RosterEntry[]>([]);
  const [skills, setSkills] = React.useState<RosterEntry[]>([]);
  const [kind, setKind] = React.useState<"agent" | "skill">("agent");
  const [scope, setScope] = React.useState<"project" | "user">("project");
  const [viewScope, setViewScope] = React.useState<"project" | "user" | "studio">("project");
  const [slug, setSlug] = React.useState("");
  const [text, setText] = React.useState("");
  const [fresh, setFresh] = React.useState(true);
  const [readonly, setReadonly] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [noteTone, setNoteTone] = React.useState<"ok" | "err">("ok");

  const reload = React.useCallback(async () => {
    const res = await fetch("/api/forge/claude", { cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as { personas: RosterEntry[]; skills: RosterEntry[] };
    setPersonas(body.personas);
    setSkills(body.skills);
  }, []);
  React.useEffect(() => void reload(), [reload]);

  const pick = async (k: "agent" | "skill", entry: RosterEntry) => {
    setKind(k);
    setViewScope(entry.scope);
    if (entry.scope !== "studio") setScope(entry.scope);
    setReadonly(entry.scope === "studio");
    setSlug(entry.slug);
    setFresh(false);
    setNote(null);
    const res = await fetch(
      `/api/forge/claude?kind=${k}&scope=${entry.scope}&slug=${encodeURIComponent(entry.slug)}`,
      { cache: "no-store" }
    );
    if (res.ok) setText(((await res.json()) as { text: string }).text);
  };

  const startNew = (k: "agent" | "skill") => {
    setKind(k);
    setFresh(true);
    setReadonly(false);
    setSlug("");
    setNote(null);
    setText(
      k === "agent"
        ? "---\nname: \ndescription: >\n  What this agent is for.\n---\n\n# Who you are\n"
        : "---\nname: \ndescription: >\n  When to use this skill.\n---\n\n# Instructions\n"
    );
  };

  const save = async () => {
    const res = await fetch("/api/forge/claude", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, scope, slug, text })
    });
    const body = (await res.json()) as { error?: string };
    setNoteTone(res.ok ? "ok" : "err");
    setNote(res.ok ? `wrote the ${scope}-scope ${kind} "${slug}"` : body.error ?? `HTTP ${res.status}`);
    if (res.ok) {
      setFresh(false);
      void reload();
    }
  };

  const toggle = async (entry: RosterEntry, k: "agent" | "skill") => {
    const res = await fetch("/api/forge/claude", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: k, scope: entry.scope, slug: entry.slug, disabled: !entry.disabled })
    });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setNoteTone("err");
      setNote(body.error ?? `HTTP ${res.status}`);
    }
    void reload();
  };

  const remove = async () => {
    if (fresh || readonly || !confirmDelete(`the ${scope}-scope ${kind} "${slug}"`)) return;
    const res = await fetch(
      `/api/forge/claude?kind=${kind}&scope=${scope}&slug=${encodeURIComponent(slug)}`,
      { method: "DELETE" }
    );
    setNoteTone(res.ok ? "ok" : "err");
    setNote(res.ok ? "deleted" : `HTTP ${res.status}`);
    startNew(kind);
    void reload();
  };

  const rosterList = (k: "agent" | "skill", entries: RosterEntry[]) => (
    <>
      <Stack direction="row" sx={{ alignItems: "center", mt: k === "skill" ? 1 : 0 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: token("dim"), flex: 1 }}>
          {k === "agent" ? "AGENTS" : "SKILLS"}
        </Typography>
        <Button size="small" onClick={() => startNew(k)}>
          New
        </Button>
      </Stack>
      {entries.map((e) => (
        <Box
          key={`${e.scope}:${e.slug}`}
          onClick={() => void pick(k, e)}
          sx={LIST_ROW_SX(!fresh && kind === k && slug === e.slug && viewScope === e.scope)}
        >
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <Typography
              sx={{
                fontSize: 12.5,
                fontWeight: 600,
                flex: 1,
                textDecoration: e.disabled ? "line-through" : "none",
                color: e.disabled ? token("dim") : token("ink")
              }}
            >
              {e.name || e.slug}
            </Typography>
            <Chip label={e.scope} size="small" sx={{ height: 14, fontSize: 8.5 }} />
            {e.scope !== "studio" && (
              <Button
                size="small"
                sx={{ minWidth: 0, px: 0.6, fontSize: 10 }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  void toggle(e, k);
                }}
              >
                {e.disabled ? "enable" : "disable"}
              </Button>
            )}
          </Stack>
        </Box>
      ))}
    </>
  );

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 1.2 }}>
      <Paper variant="outlined" sx={{ ...PANE_SX, width: 290, flexShrink: 0, overflow: "auto" }}>
        {rosterList("agent", personas)}
        <Divider />
        {rosterList("skill", skills)}
      </Paper>
      <Paper variant="outlined" sx={{ ...PANE_SX, flex: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: token("dim") }}>
            {fresh
              ? `NEW ${kind.toUpperCase()}`
              : `${viewScope.toUpperCase()} · ${kind.toUpperCase()} · ${slug}${readonly ? " · read-only (shipped source)" : ""}`}
          </Typography>
          <Box sx={{ flex: 1 }} />
          {fresh && (
            <>
              <TextField
                select
                size="small"
                label="Scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as "project" | "user")}
                sx={{ width: 120 }}
              >
                <MenuItem value="project">project</MenuItem>
                <MenuItem value="user">user (~)</MenuItem>
              </TextField>
              <TextField
                size="small"
                label="Slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                sx={{ width: 160 }}
              />
            </>
          )}
        </Stack>
        <TextField
          multiline
          minRows={16}
          fullWidth
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={readonly}
          slotProps={{ input: { sx: { fontFamily: token("mono"), fontSize: 12, flex: 1, alignItems: "start" } } }}
          sx={{ flex: 1, minHeight: 0, overflow: "auto" }}
        />
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Button
            size="small"
            variant="contained"
            onClick={() => void save()}
            disabled={!slug || !text.trim() || readonly}
          >
            Save file
          </Button>
          {!fresh && !readonly && (
            <Button size="small" color="error" onClick={() => void remove()}>
              Delete
            </Button>
          )}
          <Note text={note} tone={noteTone} />
        </Stack>
      </Paper>
    </Box>
  );
}

/* ── tab 3: tool definitions ──────────────────────────────────────────────── */

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export function ToolsTab() {
  const [tools, setTools] = React.useState<ToolDef[] | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [schema, setSchema] = React.useState('{\n  "type": "object",\n  "properties": {}\n}');
  const [note, setNote] = React.useState<string | null>(null);
  const [noteTone, setNoteTone] = React.useState<"ok" | "err">("ok");

  const reload = React.useCallback(async () => {
    const res = await fetch("/api/forge/tools", { cache: "no-store" });
    if (res.ok) setTools(((await res.json()) as { tools: ToolDef[] }).tools);
  }, []);
  React.useEffect(() => void reload(), [reload]);

  const pick = (t: ToolDef) => {
    setSelected(t.name);
    setName(t.name);
    setDescription(t.description);
    setSchema(JSON.stringify(t.input_schema, null, 2));
    setNote(null);
  };

  const startNew = () => {
    setSelected(null);
    setName("");
    setDescription("");
    setSchema('{\n  "type": "object",\n  "properties": {}\n}');
    setNote(null);
  };

  const save = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(schema) as Record<string, unknown>;
    } catch (err) {
      setNoteTone("err");
      setNote(`input_schema is not valid JSON: ${String(err)}`);
      return;
    }
    const res = await fetch("/api/forge/tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description, input_schema: parsed })
    });
    const body = (await res.json()) as { error?: string };
    setNoteTone(res.ok ? "ok" : "err");
    setNote(res.ok ? `saved data/assistant/tools/${name}.json` : body.error ?? `HTTP ${res.status}`);
    if (res.ok) {
      setSelected(name);
      void reload();
    }
  };

  const remove = async () => {
    if (!selected || !confirmDelete(`tool "${selected}"`)) return;
    await fetch(`/api/forge/tools?name=${encodeURIComponent(selected)}`, { method: "DELETE" });
    startNew();
    void reload();
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 1.2 }}>
      <Paper variant="outlined" sx={{ ...PANE_SX, width: 260, flexShrink: 0, overflow: "auto" }}>
        <Stack direction="row" sx={{ alignItems: "center" }}>
          <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: token("dim"), flex: 1 }}>
            TOOL DEFINITIONS
          </Typography>
          <Button size="small" onClick={startNew}>
            New
          </Button>
        </Stack>
        {!tools && <CircularProgress size={16} />}
        {tools?.map((t) => (
          <Box key={t.name} onClick={() => pick(t)} sx={LIST_ROW_SX(t.name === selected)}>
            <Typography sx={{ fontSize: 12.5, fontFamily: token("mono"), fontWeight: 600 }}>{t.name}</Typography>
            <Typography sx={{ fontSize: 10.5, color: token("dim") }} noWrap>
              {t.description}
            </Typography>
          </Box>
        ))}
        <Typography sx={{ fontSize: 10.5, color: token("dim"), mt: "auto" }}>
          Tools are DATA — the ClaudeToolPayload shape minus run. They feed the MCP bridge when it
          lands (claude/points.ts records the deferral).
        </Typography>
      </Paper>
      <Paper variant="outlined" sx={{ ...PANE_SX, flex: 1, overflow: "auto" }}>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            label="Name (lower-kebab)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            size="small"
            fullWidth
            label="Description — the model reads this"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Stack>
        <TextField
          multiline
          minRows={12}
          label="input_schema (JSON Schema)"
          value={schema}
          onChange={(e) => setSchema(e.target.value)}
          slotProps={{ input: { sx: { fontFamily: token("mono"), fontSize: 12 } } }}
        />
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Button size="small" variant="contained" onClick={() => void save()} disabled={!name || !description}>
            Save
          </Button>
          {selected && (
            <Button size="small" color="error" onClick={() => void remove()}>
              Delete
            </Button>
          )}
          <Note text={note} tone={noteTone} />
        </Stack>
      </Paper>
    </Box>
  );
}

/* ── tab 4: MCP servers ───────────────────────────────────────────────────── */

interface McpDef {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  type?: string;
}
interface McpStatusRow {
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  exit: { code: number | null; at: number } | null;
  log: string[];
}

export function McpTab() {
  const [servers, setServers] = React.useState<Record<string, McpDef>>({});
  const [status, setStatus] = React.useState<Record<string, McpStatusRow>>({});
  const [selected, setSelected] = React.useState<string | null>(null);
  const [draftName, setDraftName] = React.useState("");
  const [draft, setDraft] = React.useState({ type: "stdio", command: "", args: "", url: "", env: "" });
  const [note, setNote] = React.useState<string | null>(null);
  const [noteTone, setNoteTone] = React.useState<"ok" | "err">("ok");
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    const res = await fetch("/api/forge/mcp", { cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as {
      config: { mcpServers: Record<string, McpDef> };
      status: Record<string, McpStatusRow>;
    };
    setServers(body.config.mcpServers);
    setStatus(body.status);
  }, []);
  React.useEffect(() => {
    void reload();
    // The process table changes underneath the screen — poll while mounted.
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [reload]);

  const pick = (nameKey: string) => {
    const def = servers[nameKey];
    if (!def) return;
    setSelected(nameKey);
    setDraftName(nameKey);
    setDraft({
      type: def.url ? (def.type ?? "http") : "stdio",
      command: def.command ?? "",
      args: (def.args ?? []).join("\n"),
      url: def.url ?? "",
      env: Object.entries(def.env ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join("\n")
    });
    setNote(null);
  };

  const startNew = () => {
    setSelected(null);
    setDraftName("");
    setDraft({ type: "stdio", command: "", args: "", url: "", env: "" });
    setNote(null);
  };

  const writeConfig = async (next: Record<string, McpDef>) => {
    const res = await fetch("/api/forge/mcp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mcpServers: next })
    });
    const body = (await res.json()) as { error?: string };
    setNoteTone(res.ok ? "ok" : "err");
    setNote(res.ok ? "wrote .mcp.json" : body.error ?? `HTTP ${res.status}`);
    if (res.ok) void reload();
    return res.ok;
  };

  const save = async () => {
    const def: McpDef = {};
    if (draft.type === "stdio") {
      def.command = draft.command;
      const args = draft.args.split("\n").map((s) => s.trim()).filter(Boolean);
      if (args.length) def.args = args;
    } else {
      def.url = draft.url;
      def.type = draft.type;
    }
    const env: Record<string, string> = {};
    for (const line of draft.env.split("\n")) {
      const idx = line.indexOf("=");
      if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    if (Object.keys(env).length) def.env = env;
    const next = { ...servers };
    if (selected && selected !== draftName) delete next[selected];
    next[draftName] = def;
    if (await writeConfig(next)) setSelected(draftName);
  };

  const remove = async () => {
    if (!selected || !confirmDelete(`MCP server "${selected}"`)) return;
    const next = { ...servers };
    delete next[selected];
    await writeConfig(next);
    startNew();
  };

  const act = async (action: "launch" | "stop" | "test", nameKey: string) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/forge/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, name: nameKey })
      });
      const body = (await res.json()) as { ok?: boolean; detail?: string; error?: string };
      setNoteTone(res.ok && body.ok !== false ? "ok" : "err");
      setNote(body.detail ?? body.error ?? (res.ok ? `${action} ok` : `HTTP ${res.status}`));
    } finally {
      setBusy(false);
      void reload();
    }
  };

  const sel = selected ? status[selected] : null;

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 1.2 }}>
      <Paper variant="outlined" sx={{ ...PANE_SX, width: 280, flexShrink: 0, overflow: "auto" }}>
        <Stack direction="row" sx={{ alignItems: "center" }}>
          <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: token("dim"), flex: 1 }}>
            .MCP.JSON SERVERS
          </Typography>
          <Button size="small" onClick={startNew}>
            New
          </Button>
        </Stack>
        {Object.entries(servers).map(([n, def]) => {
          const st = status[n];
          return (
            <Box key={n} onClick={() => pick(n)} sx={LIST_ROW_SX(n === selected)}>
              <Stack direction="row" spacing={0.6} sx={{ alignItems: "center" }}>
                <Typography sx={{ fontSize: 12.5, fontFamily: token("mono"), fontWeight: 600, flex: 1 }}>
                  {n}
                </Typography>
                <Chip
                  label={st?.running ? `pid ${st.pid}` : def.url ? "url" : st?.exit ? `exit ${st.exit.code}` : "stopped"}
                  size="small"
                  sx={{
                    height: 15,
                    fontSize: 8.5,
                    color: st?.running ? token("ok") : token("dim"),
                    border: `1px solid ${st?.running ? token("ok") : token("edge")}`,
                    bgcolor: "transparent"
                  }}
                />
              </Stack>
              <Typography sx={{ fontSize: 10, fontFamily: token("mono"), color: token("dim") }} noWrap>
                {def.command ? `${def.command} ${(def.args ?? []).join(" ")}` : def.url}
              </Typography>
            </Box>
          );
        })}
      </Paper>

      <Paper variant="outlined" sx={{ ...PANE_SX, flex: 1, overflow: "auto" }}>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            label="Name"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
          />
          <TextField
            select
            size="small"
            label="Transport"
            value={draft.type}
            onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
            sx={{ width: 130 }}
          >
            <MenuItem value="stdio">stdio</MenuItem>
            <MenuItem value="http">http</MenuItem>
            <MenuItem value="sse">sse</MenuItem>
          </TextField>
        </Stack>
        {draft.type === "stdio" ? (
          <>
            <TextField
              size="small"
              label="Command"
              value={draft.command}
              onChange={(e) => setDraft((d) => ({ ...d, command: e.target.value }))}
              placeholder="npx"
            />
            <TextField
              multiline
              minRows={3}
              label="Args — one per line"
              value={draft.args}
              onChange={(e) => setDraft((d) => ({ ...d, args: e.target.value }))}
              slotProps={{ input: { sx: { fontFamily: token("mono"), fontSize: 12 } } }}
            />
          </>
        ) : (
          <TextField
            size="small"
            label="URL"
            value={draft.url}
            onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
            placeholder="https://…/mcp"
          />
        )}
        <TextField
          multiline
          minRows={2}
          label="Env — KEY=value per line"
          value={draft.env}
          onChange={(e) => setDraft((d) => ({ ...d, env: e.target.value }))}
          slotProps={{ input: { sx: { fontFamily: token("mono"), fontSize: 12 } } }}
        />
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Button size="small" variant="contained" onClick={() => void save()} disabled={!draftName}>
            Save to .mcp.json
          </Button>
          {selected && (
            <>
              <Button
                size="small"
                disabled={busy || status[selected]?.running || !servers[selected]?.command}
                onClick={() => void act("launch", selected)}
              >
                Launch
              </Button>
              <Button
                size="small"
                disabled={busy || !status[selected]?.running}
                onClick={() => void act("stop", selected)}
              >
                Stop
              </Button>
              <Button size="small" disabled={busy} onClick={() => void act("test", selected)}>
                {busy ? "Testing…" : "Test handshake"}
              </Button>
              <Button size="small" color="error" onClick={() => void remove()}>
                Delete
              </Button>
            </>
          )}
        </Stack>
        <Note text={note} tone={noteTone} />
        {sel && sel.log.length > 0 && (
          <Box
            sx={{
              mt: 0.5,
              p: 1,
              borderRadius: "6px",
              border: `1px solid ${token("edge")}`,
              bgcolor: token("page"),
              fontFamily: token("mono"),
              fontSize: 10.5,
              whiteSpace: "pre-wrap",
              maxHeight: 220,
              overflow: "auto",
              color: token("dim")
            }}
          >
            {sel.log.join("\n")}
          </Box>
        )}
      </Paper>
    </Box>
  );
}
