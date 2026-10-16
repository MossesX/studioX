/**
 * @file The AGENT BUILDER dialog — the studio's own answer to "what do you want
 * to call this module's agent?"
 *
 * A build (`npm run agent <id>`, or the peel, which runs the same step) derives
 * an agent from the module's declaration and then needs the one thing it cannot
 * derive. It has no window, so it parks the draft in
 * `/api/assistant/agent-inbox` and waits; this component watches that inbox and
 * opens the form. The build takes what the owner accepts and writes the bundle.
 *
 * ## Why it lives beside the assistant window and not in the Forge
 *
 * The Forge edits agents the owner AUTHORS. This is a build step interrupting
 * to ask a question, which can happen while the owner is on any route, so it
 * has to be mounted wherever the assistant is — that is, everywhere. The plugin
 * renders it alongside the window for exactly that reason, and it draws nothing
 * at all until a build is waiting.
 *
 * ## Polling, and why it is not a socket
 *
 * A build asks about once a week and waits minutes when it does. A four-second
 * poll that stops dead when the tab is hidden costs nothing measurable and adds
 * no transport; a socket for this would be infrastructure in the way of a
 * question. The poll also stops entirely while the dialog is open — there is
 * nothing to look for until this one is answered.
 *
 * Everything is pre-filled and everything is editable, which is the whole
 * point: the name, the description, the persona body, each skill (text and
 * whether it is kept at all), the CLI tools the agent may use, and the module
 * tool definitions it carries.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { CLI_TOOL_CHOICES } from "./types";
import type { AgentBuildRequest, AgentSkillDoc, ModuleAgentDraft } from "./types";

const INBOX = "/api/assistant/agent-inbox";
const POLL_MS = 4000;

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: 11, color: token("dim"), lineHeight: 1.5 }}>{children}</Typography>
  );
}

export default function ModuleAgentBuilder() {
  const [request, setRequest] = React.useState<AgentBuildRequest | null>(null);
  const [draft, setDraft] = React.useState<ModuleAgentDraft | null>(null);
  const [tab, setTab] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  /** Set when the answer could not be delivered. The dialog STAYS OPEN and says
   *  so: a build that stopped waiting (its `--wait` expired, or the terminal
   *  was closed) has already written the derived agent, so closing silently
   *  would leave the owner believing the name they typed is the name on disk. */
  const [undelivered, setUndelivered] = React.useState<string | null>(null);
  /** Set when this host has no agent-inbox route at all — see the poll. */
  const [disabled, setDisabled] = React.useState(false);
  const [skillIndex, setSkillIndex] = React.useState(0);
  /** Slugs the owner unticked. Kept beside the drafts rather than inside them
   *  so unticking and re-ticking cannot lose the body. */
  const [dropped, setDropped] = React.useState<ReadonlySet<string>>(new Set());
  const [droppedTools, setDroppedTools] = React.useState<ReadonlySet<string>>(new Set());

  React.useEffect(() => {
    // Nothing to look for while a dialog is open, and nothing worth looking for
    // in a hidden tab — the build is waiting for a PERSON.
    if (request || disabled) return;
    let alive = true;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(INBOX, { cache: "no-store" });
        if (res.status === 404) {
          // No inbox route in this host — a PEELED app, which carries this
          // plugin but not the build-time rendezvous (nothing there runs
          // `npm run agent`). Stop asking rather than 404 every four seconds
          // for the life of the app.
          setDisabled(true);
          return;
        }
        if (!res.ok || !alive) return;
        const body = (await res.json()) as { requests?: AgentBuildRequest[] };
        const next = body.requests?.[0];
        if (next && alive) {
          setRequest(next);
          setDraft(next.draft);
          setDropped(new Set());
          setDroppedTools(new Set());
          setUndelivered(null);
          setSkillIndex(0);
          setTab(0);
        }
      } catch {
        // No studio-side state to repair: the next tick asks again.
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [request, disabled]);

  const close = () => {
    setRequest(null);
    setDraft(null);
  };

  const send = async (action: "resolve" | "cancel") => {
    if (!request || !draft) return;
    setBusy(true);
    try {
      const res = await fetch(INBOX, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "cancel"
            ? { id: request.id, action }
            : {
                id: request.id,
                action,
                draft: {
                  ...draft,
                  skills: draft.skills.filter((s) => !dropped.has(s.slug)),
                  tools: draft.tools.filter((t) => !droppedTools.has(t.name))
                }
              }
        )
      });
      if (!res.ok) {
        setUndelivered(
          res.status === 404
            ? `The build of "${draft.module}" stopped waiting, so it wrote the derived agent instead. ` +
              `Re-run \`npm run agent ${draft.module}\` to name it.`
            : `The studio could not record that (${res.status}). Nothing was written by this dialog.`
        );
        return;
      }
      close();
    } catch {
      setUndelivered("The studio did not answer. Nothing was written by this dialog.");
    } finally {
      setBusy(false);
    }
  };

  if (!request || !draft) return null;

  const patch = (fields: Partial<ModuleAgentDraft>) => setDraft({ ...draft, ...fields });
  const patchSkill = (index: number, fields: Partial<AgentSkillDoc>) =>
    patch({ skills: draft.skills.map((s, i) => (i === index ? { ...s, ...fields } : s)) });
  const toggle = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  const cliTools = new Set(draft.cliTools);
  const skill = draft.skills[skillIndex];

  return (
    <Dialog open fullWidth maxWidth="md" onClose={() => void send("cancel")}>
      <DialogTitle sx={{ pb: 0.5 }}>
        Name the agent for <b>{draft.module}</b>
      </DialogTitle>
      <Box sx={{ px: 3, pb: 1 }}>
        <Hint>
          Every module ships with one agent, and this is {draft.module}&apos;s. Everything below was
          written from the module&apos;s own declaration — change any of it. The roster id stays{" "}
          <code>{draft.id}</code> whatever you name it, so a pin never breaks. Asked by{" "}
          <code>{request.source}</code>.
        </Hint>
      </Box>
      <Tabs value={tab} onChange={(_, v: number) => setTab(v)} sx={{ px: 2, minHeight: 36 }}>
        <Tab label="Agent" sx={{ minHeight: 36 }} />
        <Tab label={`Skills (${draft.skills.length - dropped.size})`} sx={{ minHeight: 36 }} />
        <Tab label={`Tools (${draft.tools.length - droppedTools.size})`} sx={{ minHeight: 36 }} />
      </Tabs>

      <DialogContent dividers sx={{ minHeight: 460 }}>
        {tab === 0 && (
          <Stack spacing={2}>
            <Box>
              <TextField
                label="Name"
                size="small"
                fullWidth
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
              {draft.nameOptions?.length ? (
                <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>
                  {draft.nameOptions.map((option) => (
                    <Chip
                      key={option}
                      size="small"
                      label={option}
                      variant={option === draft.name ? "filled" : "outlined"}
                      onClick={() => patch({ name: option })}
                    />
                  ))}
                </Stack>
              ) : null}
            </Box>
            <TextField
              label="Description"
              size="small"
              fullWidth
              multiline
              minRows={2}
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
            <TextField
              label="Model"
              size="small"
              fullWidth
              placeholder="blank — use whatever the assistant is configured for"
              value={draft.model ?? ""}
              onChange={(e) => patch({ model: e.target.value || undefined })}
            />
            <Box>
              <Hint>Persona — this body IS the system prompt.</Hint>
              <TextField
                fullWidth
                multiline
                minRows={12}
                maxRows={20}
                value={draft.persona}
                onChange={(e) => patch({ persona: e.target.value })}
                sx={{ mt: 0.5, "& textarea": { fontFamily: token("mono"), fontSize: 12 } }}
              />
            </Box>
          </Stack>
        )}

        {tab === 1 && (
          <Stack direction="row" spacing={2} sx={{ height: 420 }}>
            <Box sx={{ width: 220, overflowY: "auto", borderRight: `1px solid ${token("line")}`, pr: 1 }}>
              {draft.skills.map((s, i) => (
                <Box key={s.slug} sx={{ display: "flex", alignItems: "center" }}>
                  <Checkbox
                    size="small"
                    checked={!dropped.has(s.slug)}
                    onChange={() => setDropped(toggle(dropped, s.slug))}
                  />
                  <Box
                    onClick={() => setSkillIndex(i)}
                    sx={{
                      cursor: "pointer",
                      fontSize: 12,
                      py: 0.5,
                      color: i === skillIndex ? token("accent") : token("ink"),
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}
                  >
                    {s.slug}
                  </Box>
                </Box>
              ))}
              {draft.skills.length === 0 ? <Hint>This module derived no skills.</Hint> : null}
            </Box>
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
              {skill ? (
                <>
                  <TextField
                    label="Skill name"
                    size="small"
                    value={skill.name}
                    onChange={(e) => patchSkill(skillIndex, { name: e.target.value })}
                  />
                  <TextField
                    label="When to use it"
                    size="small"
                    multiline
                    minRows={2}
                    value={skill.description}
                    onChange={(e) => patchSkill(skillIndex, { description: e.target.value })}
                  />
                  <TextField
                    fullWidth
                    multiline
                    minRows={10}
                    maxRows={14}
                    value={skill.body}
                    onChange={(e) => patchSkill(skillIndex, { body: e.target.value })}
                    sx={{ "& textarea": { fontFamily: token("mono"), fontSize: 12 } }}
                  />
                </>
              ) : (
                <Hint>Pick a skill on the left.</Hint>
              )}
            </Box>
          </Stack>
        )}

        {tab === 2 && (
          <Stack spacing={2}>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                CLI tools — what the agent may DO while answering
              </Typography>
              <Hint>
                Honoured on the Claude subscription path, where they become the CLI&apos;s{" "}
                <code>--allowed-tools</code>. Write-capable ones are marked; a chat window that can
                edit files is a decision, so none are ticked for you.
              </Hint>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", mt: 1 }}>
                {CLI_TOOL_CHOICES.map((choice) => (
                  <FormControlLabel
                    key={choice.name}
                    control={
                      <Checkbox
                        size="small"
                        checked={cliTools.has(choice.name)}
                        onChange={() =>
                          patch({ cliTools: [...toggle(cliTools, choice.name)] })
                        }
                      />
                    }
                    label={
                      <Box sx={{ fontSize: 12 }}>
                        {choice.name}{" "}
                        <Box component="span" sx={{ color: token("dim") }}>
                          — {choice.hint}
                          {choice.writes ? " ⚠ writes" : ""}
                        </Box>
                      </Box>
                    }
                  />
                ))}
              </Box>
              <TextField
                label="Also allow"
                size="small"
                fullWidth
                placeholder="comma separated — e.g. Bash(git *)"
                sx={{ mt: 1 }}
                value={draft.cliTools
                  .filter((t) => !CLI_TOOL_CHOICES.some((c) => c.name === t))
                  .join(", ")}
                onChange={(e) =>
                  patch({
                    cliTools: [
                      ...draft.cliTools.filter((t) => CLI_TOOL_CHOICES.some((c) => c.name === t)),
                      ...e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    ]
                  })
                }
              />
            </Box>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                Module tools — the definitions this agent carries
              </Typography>
              <Hint>
                Derived from the module (its real commands and setting keys are the enums) plus the
                house set every agent gets. Data, not behaviour: they are the authored feed for the
                tool bridge, so nothing runs one yet.
              </Hint>
              <Box sx={{ maxHeight: 220, overflowY: "auto", mt: 1 }}>
                {draft.tools.map((tool) => (
                  <Box key={tool.name} sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
                    <Checkbox
                      size="small"
                      checked={!droppedTools.has(tool.name)}
                      onChange={() => setDroppedTools(toggle(droppedTools, tool.name))}
                    />
                    <Box sx={{ fontSize: 12, py: 0.75 }}>
                      <code>{tool.name}</code>{" "}
                      <Box component="span" sx={{ color: token("dim") }}>
                        — {tool.description}
                      </Box>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        {undelivered ? (
          <>
            <Typography sx={{ fontSize: 12, color: token("err"), flex: 1, pl: 1 }}>
              {undelivered}
            </Typography>
            <Button size="small" onClick={close}>
              Dismiss
            </Button>
          </>
        ) : (
          <>
            <Button size="small" disabled={busy} onClick={() => void send("cancel")}>
              Cancel the build
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={busy || !draft.name.trim()}
              onClick={() => void send("resolve")}
            >
              Build this agent
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
