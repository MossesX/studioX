/**
 * @file The assistant's settings TAB — rendered inside the floating window.
 *
 * Everything the owner asked the plugin to be configurable on lives here:
 * the PROVIDER (Claude / OpenAI / Grok / Ollama), the MODEL (free text with
 * live suggestions — Ollama's list comes from the local daemon), the AGENT
 * (from the installed roster: built-in + data files + add-on assets), and
 * per-provider connection settings (API keys, base URLs).
 *
 * Keys are write-only: the config route masks them on the way out, so the
 * field shows `set — …abcd` as a placeholder and sends only what you type.
 * Leaving a key field empty means "keep the stored one"; the explicit clear
 * button sends the empty string, which the route reads as "delete it".
 *
 * ── Claude's second connection ────────────────────────────────────────────────
 *
 * Anthropic is the one provider with a CHOICE of account, so it is the one with
 * a **Connection** control: an API key, or the Claude subscription already
 * signed in to the local `claude` CLI. The two bill different accounts, so the
 * control is a stored setting and never a guess — and the two are mutually
 * exclusive in the UI, because a key field sitting under a subscription is an
 * invitation to configure the one that is not being used.
 *
 * The subscription's status is not asserted, it is TESTED: the button runs one
 * real turn through the CLI (`/api/assistant/claude-auth`). `claude --version`
 * succeeds while signed out, so anything cheaper could show a green line to
 * someone with no connection at all.
 */
"use client";

import * as React from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token, useResolvedStyle } from "@axf/core";

import { assistant, LOGO_TONES } from "./store";
import type { AssistantState, LogoTone } from "./store";
import {
  ANTHROPIC_AUTH_MODES,
  DEFAULT_AGENT_DIRS,
  DEFAULT_ANTHROPIC_AUTH,
  DEFAULT_MODELS,
  MODEL_SUGGESTIONS,
  PROVIDERS
} from "./types";
import type { AnthropicAuthMode, ProviderId } from "./types";

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: 11, color: token("dim"), lineHeight: 1.4 }}>{children}</Typography>
  );
}

export default function AssistantSettings({ state }: { state: AssistantState }) {
  const config = state.config;
  const agents = state.agents ?? [];
  const [provider, setProvider] = React.useState<ProviderId>(config?.provider ?? "anthropic");
  const [model, setModel] = React.useState(config?.model ?? DEFAULT_MODELS.anthropic);
  const [agentId, setAgentId] = React.useState(config?.agentId ?? "amber");
  const [agentDirs, setAgentDirs] = React.useState<string[]>([
    ...(config?.agentDirs ?? DEFAULT_AGENT_DIRS)
  ]);
  const [newDir, setNewDir] = React.useState("");
  const [keys, setKeys] = React.useState<Partial<Record<ProviderId, string>>>({});
  const [baseUrls, setBaseUrls] = React.useState<Partial<Record<ProviderId, string>>>({});
  const [authMode, setAuthMode] = React.useState<AnthropicAuthMode>(
    config?.providers.anthropic?.authMode ?? DEFAULT_ANTHROPIC_AUTH
  );
  const [models, setModels] = React.useState<readonly string[]>(MODEL_SUGGESTIONS[provider]);
  /** True when the model list is an allowlist rather than a suggestion — the
   *  subscription path, where the id reaches a command line. */
  const [modelsFixed, setModelsFixed] = React.useState(false);
  const [probe, setProbe] = React.useState<{ ok: boolean; detail: string } | null>(null);
  const [probing, setProbing] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Re-seed the form when the loaded config lands (it arrives async).
  React.useEffect(() => {
    if (!config) return;
    setProvider(config.provider);
    setModel(config.model);
    setAgentId(config.agentId);
    setAgentDirs([...(config.agentDirs ?? DEFAULT_AGENT_DIRS)]);
    setAuthMode(config.providers.anthropic?.authMode ?? DEFAULT_ANTHROPIC_AUTH);
  }, [config]);

  // Live model list per provider — Ollama answers with what is pulled, and
  // Anthropic-on-subscription with the ids the CLI will actually accept, so
  // the list is refetched when the connection changes and not only the
  // provider.
  React.useEffect(() => {
    let alive = true;
    setModels(MODEL_SUGGESTIONS[provider]);
    setModelsFixed(false);
    fetch(`/api/assistant/models?provider=${provider}&auth=${authMode}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { models?: string[]; allowlisted?: boolean } | null) => {
        if (!alive || !body?.models?.length) return;
        setModels(body.models);
        setModelsFixed(Boolean(body.allowlisted));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [provider, authMode]);

  const pickProvider = (next: ProviderId) => {
    setProvider(next);
    // Model follows the provider unless the user typed one for it already.
    setModel(DEFAULT_MODELS[next]);
  };

  /** Flipping the connection changes which account pays, so it also changes
   *  what the model field means. Move the model onto the new connection's
   *  default rather than leaving an id the other side will refuse. */
  const pickAuth = (next: AnthropicAuthMode) => {
    setAuthMode(next);
    setProbe(null);
    if (provider === "anthropic") setModel(DEFAULT_MODELS.anthropic);
  };

  const testConnection = async () => {
    setProbing(true);
    setProbe(null);
    try {
      const res = await fetch("/api/assistant/claude-auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model })
      });
      setProbe((await res.json()) as { ok: boolean; detail: string });
    } catch (err) {
      setProbe({ ok: false, detail: String(err) });
    }
    setProbing(false);
  };

  const save = async () => {
    setSaving(true);
    setNote(null);
    const providers: Partial<
      Record<ProviderId, { apiKey?: string; baseUrl?: string; authMode?: AnthropicAuthMode }>
    > = {};
    for (const { id } of PROVIDERS) {
      const patch: { apiKey?: string; baseUrl?: string; authMode?: AnthropicAuthMode } = {};
      if (keys[id] !== undefined) patch.apiKey = keys[id];
      if (baseUrls[id] !== undefined) patch.baseUrl = baseUrls[id];
      // Always sent, never conditional: this one is not a secret and the tab
      // holds the authoritative selection, so an unsent field would let the
      // radio and the stored mode drift apart.
      if (id === "anthropic") patch.authMode = authMode;
      if (Object.keys(patch).length) providers[id] = patch;
    }
    const result = await assistant.saveConfig({ provider, model, agentId, agentDirs, providers });
    setSaving(false);
    setNote(result.ok ? "saved" : `save failed: ${result.error}`);
    if (result.ok) {
      setKeys({});
      setBaseUrls({});
      // The directory list decides what "installed" means, so the roster the
      // Agent picker shows is stale the moment it changes.
      void assistant.loadAgents(true);
    }
  };

  const addDir = () => {
    const dir = newDir.trim();
    if (dir && !agentDirs.includes(dir)) setAgentDirs((d) => [...d, dir]);
    setNewDir("");
  };

  const masked = config?.providers ?? {};
  const onSubscription = authMode === "subscription";

  // The watermark rows below. Derived from the LIVE pack, not a hardcoded
  // list, so a pack that ships more animated drawings grows the select with
  // no edit here.
  const resolvedStyle = useResolvedStyle();
  const animatedGlyphs = React.useMemo(
    () => Array.from(resolvedStyle.glyphs.values()).filter((g) => g.animated),
    [resolvedStyle]
  );
  const logo = state.logo;

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 1.2, py: 1 }}>
      <Stack spacing={1.4}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: token("dim") }}>
          CHAT
        </Typography>

        <TextField
          select
          size="small"
          label="Provider"
          value={provider}
          onChange={(e) => pickProvider(e.target.value as ProviderId)}
        >
          {PROVIDERS.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.label}
            </MenuItem>
          ))}
        </TextField>

        <Autocomplete
          // Stays free text even when the list is an allowlist. The refusal
          // that matters is the server's — it names the accepted ids — and a
          // non-freeSolo Autocomplete would additionally have to hold `value`
          // inside `options`, which a config stored before the list changed
          // cannot promise.
          freeSolo
          size="small"
          options={[...models]}
          value={model}
          onInputChange={(_e, v) => setModel(v)}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Model"
              helperText={
                modelsFixed
                  ? "Allowlisted — on the Claude subscription the id reaches the claude CLI's command line."
                  : "Free text — any model id the provider serves."
              }
            />
          )}
        />

        <TextField
          select
          size="small"
          label="Agent"
          value={agents.some((a) => a.id === agentId) ? agentId : "amber"}
          onChange={(e) => setAgentId(e.target.value)}
          helperText="Installed agents: the built-in, GizmoX's .claude/agents, data/assistant/agents, and add-on assets. The Forge module creates more."
        >
          {(agents.length ? agents : [{ id: "amber", name: "Amber", description: "", source: "built-in" as const }]).map(
            (a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.name}
                <Typography component="span" sx={{ ml: 0.8, fontSize: 10, color: token("dim") }}>
                  {a.source}
                </Typography>
              </MenuItem>
            )
          )}
        </TextField>

        <Box sx={{ display: "grid", gap: 0.6 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600 }}>Agent directories</Typography>
          {agentDirs.map((dir) => (
            <Stack key={dir} direction="row" spacing={0.6} sx={{ alignItems: "center" }}>
              <Typography
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 11,
                  fontFamily: "monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
                title={dir}
              >
                {dir}
              </Typography>
              <Button
                size="small"
                color="inherit"
                onClick={() => setAgentDirs((d) => d.filter((x) => x !== dir))}
                title="Stop scanning this directory on save"
              >
                remove
              </Button>
            </Stack>
          ))}
          {agentDirs.length === 0 && <Hint>No directories — only built-in, module, data and add-on agents.</Hint>}
          <Stack direction="row" spacing={0.6} sx={{ alignItems: "center" }}>
            <TextField
              size="small"
              fullWidth
              label="Add directory"
              value={newDir}
              onChange={(e) => setNewDir(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDir();
                }
              }}
              placeholder="~/.claude/agents · .claude/agents · C:\an\absolute\path"
            />
            <Button size="small" variant="outlined" onClick={addDir} disabled={!newDir.trim()}>
              Add
            </Button>
          </Stack>
          <Hint>
            Folders of agent <code>.md</code> files, scanned live. <code>~</code> is your home
            directory, a relative path is from the repo root, and later entries win a name
            collision. Takes effect on save.
          </Hint>
        </Box>

        <Divider />
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: token("dim") }}>
          WATERMARK
        </Typography>
        <Hint>
          The animated brand logo behind the transcript. Applied instantly and stored in this
          browser — it is the window&apos;s look, not the account&apos;s, so there is no save step.
        </Hint>

        {/* Refused settings, written down so the next session does not
            re-propose them (the minimal-sui rule):
            - show/hide toggle — the watermark is ALWAYS present by design;
              opacity 0.02 is the honest "barely there".
            - position / size — it is a centred watermark, not a pane;
              geometry knobs would be configuration for its own sake.
            - animate-while-idle — motion MEANS a reply is streaming; an
              always-on animation deletes the signal this feature exists
              to give. */}

        <TextField
          select
          size="small"
          label="Logo"
          value={animatedGlyphs.some((g) => g.id === logo.asset) ? logo.asset : ""}
          onChange={(e) => assistant.setLogo({ asset: e.target.value })}
          helperText="Which of the pack's ANIMATED drawings sits behind the chat — it plays only while a reply streams, so its motion is the streaming indicator."
        >
          {animatedGlyphs.map((g) => (
            <MenuItem key={g.id} value={g.id}>
              {g.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          size="small"
          type="number"
          label="Animation speed ×"
          value={logo.speed}
          onChange={(e) => assistant.setLogo({ speed: Number(e.target.value) })}
          slotProps={{ htmlInput: { min: 0.25, max: 4, step: 0.25 } }}
          helperText="Multiplies the drawing's own SMIL durations (0.25–4) — the streaming pulse can be calmer or livelier without touching the pack."
        />

        <TextField
          select
          size="small"
          label="Tone"
          value={logo.tone}
          onChange={(e) => assistant.setLogo({ tone: e.target.value as LogoTone })}
          helperText="A theme ROLE, never a colour: the logo paints in this role's variable, so it re-tints with every theme roll and ships no hex."
        >
          {LOGO_TONES.map((t) => (
            <MenuItem key={t} value={t}>
              {t}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          size="small"
          type="number"
          label="Opacity"
          value={logo.opacity}
          onChange={(e) => assistant.setLogo({ opacity: Number(e.target.value) })}
          slotProps={{ htmlInput: { min: 0.02, max: 0.5, step: 0.02 } }}
          helperText="Watermark strength (0.02–0.5) — high enough to see the stream indicator, low enough that the words stay legible over it on any theme."
        />

        <Divider />
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: token("dim") }}>
          PROVIDERS
        </Typography>

        {PROVIDERS.map(({ id, label, needsKey }) => (
          <Box key={id} sx={{ display: "grid", gap: 0.8 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
              {label}
              {id === provider && (
                <Typography component="span" sx={{ ml: 0.8, fontSize: 10, color: token("accent") }}>
                  in use
                </Typography>
              )}
            </Typography>

            {/* Anthropic is the only provider you can reach two ways, so it is
                the only one with a connection control. */}
            {id === "anthropic" && (
              <>
                <TextField
                  select
                  size="small"
                  label="Connection"
                  value={authMode}
                  onChange={(e) => pickAuth(e.target.value as AnthropicAuthMode)}
                  helperText={ANTHROPIC_AUTH_MODES.find((m) => m.id === authMode)?.hint}
                >
                  {ANTHROPIC_AUTH_MODES.map((m) => (
                    <MenuItem key={m.id} value={m.id}>
                      {m.label}
                    </MenuItem>
                  ))}
                </TextField>
                {onSubscription && (
                  <Box sx={{ display: "grid", gap: 0.6 }}>
                    <Stack direction="row" spacing={0.8} sx={{ alignItems: "center" }}>
                      <Button size="small" variant="outlined" onClick={() => void testConnection()} disabled={probing}>
                        {probing ? "Testing…" : "Test connection"}
                      </Button>
                      {probe && (
                        <Typography sx={{ fontSize: 11, color: token(probe.ok ? "ok" : "err") }}>
                          {probe.detail}
                        </Typography>
                      )}
                    </Stack>
                    <Hint>
                      Uses the <code>claude</code> CLI already signed in on this machine — your Claude
                      plan pays and no key is stored. Not signed in? Run <code>claude</code> in a
                      terminal once and log in. The test sends one tiny real turn, because{" "}
                      <code>claude --version</code> succeeds while signed out.
                    </Hint>
                  </Box>
                )}
              </>
            )}

            {needsKey && !(id === "anthropic" && onSubscription) && (
              <Stack direction="row" spacing={0.6} sx={{ alignItems: "center" }}>
                <TextField
                  size="small"
                  type="password"
                  fullWidth
                  label="API key"
                  value={keys[id] ?? ""}
                  onChange={(e) => setKeys((k) => ({ ...k, [id]: e.target.value }))}
                  placeholder={masked[id]?.keySet ? `set — ${masked[id]?.keyHint}` : "not set"}
                  slotProps={{ htmlInput: { "aria-label": `${label} API key`, autoComplete: "off" } }}
                />
                {masked[id]?.keySet && (
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => setKeys((k) => ({ ...k, [id]: "" }))}
                    title="Clear the stored key on save"
                  >
                    clear
                  </Button>
                )}
              </Stack>
            )}
            {(id === "ollama" || id === "openai" || id === "xai") && (
              <TextField
                size="small"
                fullWidth
                label={id === "ollama" ? "Daemon URL" : "Base URL (optional)"}
                value={baseUrls[id] ?? masked[id]?.baseUrl ?? ""}
                onChange={(e) => setBaseUrls((b) => ({ ...b, [id]: e.target.value }))}
                placeholder={id === "ollama" ? "http://localhost:11434" : ""}
              />
            )}
          </Box>
        ))}

        <Hint>
          Keys are stored server-side (data/axf/kv) and never sent back to the browser — the
          placeholder shows only that one is set. An empty key field keeps the stored key.
        </Hint>

        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Button size="small" variant="contained" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          <Button size="small" color="inherit" onClick={() => assistant.setView("chat")}>
            Back to chat
          </Button>
          {note && (
            <Typography sx={{ fontSize: 11, color: note === "saved" ? token("ok") : token("err") }}>
              {note}
            </Typography>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}
