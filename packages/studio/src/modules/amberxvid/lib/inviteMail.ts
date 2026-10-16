/**
 * @file **Optional server-side mail for invitations** — `AMBERXVID_SMTP_URL`,
 * and nothing at all when it is unset (P7 of `axf-amberxvid-social`).
 *
 * ## Why this is ~150 lines of socket code instead of a dependency
 *
 * The step's own words: *"no SMTP dependency invented; if `AMBERXVID_SMTP_URL`
 * is set, send server-side, else the compose path is the product and says
 * so."* The compose path (`mailto:` / `sms:`, `./inviteContract`) is what
 * ships and what every deployment gets. This file exists only for the
 * deployment that already HAS a mail server and would rather the invitation
 * came from it.
 *
 * Adding `nodemailer` for that would be a new npm dependency — which needs
 * asking (`.claude/rules/amberx-bound-builds.md`) and which every deployment
 * would install to serve the few that configure a relay. So this speaks
 * exactly the subset of RFC 5321 an invitation needs, over `node:net` /
 * `node:tls`, and does not pretend to be a mail library:
 *
 * - **Not implemented, deliberately:** attachments, MIME multipart, non-ASCII
 *   headers beyond RFC 2047 base64 encoded-words, PIPELINING, DSN, retries,
 *   queueing, connection reuse. An invitation is one short plain-text message
 *   to one recipient, sent once, and told about immediately if it fails.
 * - **Failure is a value, never a throw.** A refused send must not take the
 *   invitation down with it — the link exists either way and the inviter falls
 *   back to composing. Every path returns `{ ok: false, error }`.
 *
 * ## The URL
 *
 * ```
 * smtp://user:pass@host:587      STARTTLS when the server offers it
 * smtps://user:pass@host:465     implicit TLS from the first byte
 * smtp://host:25                 no credentials — AUTH is skipped
 * ```
 *
 * `AMBERXVID_SMTP_FROM` sets the envelope sender and the `From:` header; it
 * defaults to the URL's username, and a configuration with neither is refused
 * up front rather than at the `MAIL FROM` — a relay's rejection of an empty
 * sender is a confusing way to learn that a setting is missing.
 *
 * Read per call, never latched at import, per the module's env rule.
 *
 * Server-only.
 */

import net from "node:net";
import tls from "node:tls";

export interface SmtpConfig {
  host: string;
  port: number;
  /** True for `smtps:` — TLS from the first byte, no STARTTLS handshake. */
  implicitTls: boolean;
  user: string | null;
  pass: string | null;
  from: string;
  /** How long the whole conversation may take. A mail server that has not
   *  finished in this long is one an invitation should stop waiting for. */
  timeoutMs: number;
}

export type MailResult = { ok: true } | { ok: false; error: string };

/**
 * Parse `AMBERXVID_SMTP_URL`, or null when it is unset or unusable.
 *
 * A MALFORMED url answers null exactly as an absent one does, and the
 * difference is reported by {@link smtpProblem} rather than by throwing:
 * a typo in a deployment variable must degrade to the compose path, which
 * still works, rather than 500 the invitation route.
 */
export function smtpConfig(): SmtpConfig | null {
  const raw = process.env.AMBERXVID_SMTP_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const implicitTls = url.protocol === "smtps:";
  if (!implicitTls && url.protocol !== "smtp:") return null;
  if (!url.hostname) return null;

  const user = url.username ? decodeURIComponent(url.username) : null;
  const pass = url.password ? decodeURIComponent(url.password) : null;
  const from = process.env.AMBERXVID_SMTP_FROM?.trim() || user;
  if (!from) return null;

  const timeoutRaw = Number(process.env.AMBERXVID_SMTP_TIMEOUT_MS ?? "");
  return {
    host: url.hostname,
    port: Number(url.port) || (implicitTls ? 465 : 587),
    implicitTls,
    user,
    pass,
    from,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 15_000,
  };
}

/** Is server-side sending available at all? The one question the UI asks. */
export const smtpConfigured = (): boolean => smtpConfig() !== null;

/**
 * The honest sentence for a configured-but-broken variable. Distinguishing
 * "unset" from "set to nonsense" matters: the first is a choice, the second is
 * a deployment bug that would otherwise look exactly like the choice.
 */
export function smtpProblem(): string | null {
  const raw = process.env.AMBERXVID_SMTP_URL?.trim();
  if (!raw) return null;
  if (smtpConfig()) return null;
  return (
    "AMBERXVID_SMTP_URL is set but unusable — expected smtp://user:pass@host:port or " +
    "smtps://…, with a sender available from the URL's username or AMBERXVID_SMTP_FROM. " +
    "Email invitations are being composed locally instead."
  );
}

/* ============================== the conversation ============================== */

/** One SMTP reply: the numeric code and the text, folded across continuations. */
interface Reply {
  code: number;
  text: string;
}

/**
 * A line-oriented SMTP conversation over one socket.
 *
 * Multi-line replies (`250-EHLO…` then `250 …`) are folded here rather than at
 * each call site, because the ONE place it matters — reading the EHLO
 * capability list to decide about STARTTLS — is also the place it is easiest
 * to get wrong.
 */
class SmtpSession {
  private buffer = "";
  private pending: ((reply: Reply | Error) => void) | null = null;
  private queue: (Reply | Error)[] = [];
  // A plain field, not a TypeScript parameter property: the test runner strips
  // types rather than compiling them (`test/alias-hook.mjs`), and a parameter
  // property is syntax it refuses outright.
  private socket: net.Socket | tls.TLSSocket;

  constructor(socket: net.Socket | tls.TLSSocket) {
    this.socket = socket;
    this.attach(socket);
  }

  private attach(socket: net.Socket | tls.TLSSocket): void {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.consume(chunk));
    socket.on("error", (err: Error) => this.push(err));
    socket.on("close", () => this.push(new Error("the mail server closed the connection")));
  }

  /** Swap in the TLS socket after STARTTLS — same session, new transport. */
  upgrade(socket: tls.TLSSocket): void {
    this.socket = socket;
    this.buffer = "";
    this.queue = [];
    this.attach(socket);
  }

  private push(value: Reply | Error): void {
    if (this.pending) {
      const resolve = this.pending;
      this.pending = null;
      resolve(value);
    } else {
      this.queue.push(value);
    }
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      // A complete reply ends with a line whose 4th character is a space.
      const match = /^(?:\d{3}-[^\r\n]*\r?\n)*(\d{3})[ ]([^\r\n]*)\r?\n/.exec(this.buffer);
      if (!match) return;
      const whole = match[0];
      this.buffer = this.buffer.slice(whole.length);
      this.push({ code: Number(match[1]), text: whole.trim() });
    }
  }

  /** Await the next reply, or reject on timeout / transport failure. */
  read(timeoutMs: number): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const settle = (value: Reply | Error): void => {
        clearTimeout(timer);
        if (value instanceof Error) reject(value);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error("the mail server did not answer in time"));
      }, timeoutMs);
      const queued = this.queue.shift();
      if (queued !== undefined) settle(queued);
      else this.pending = settle;
    });
  }

  write(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  end(): void {
    try {
      this.socket.destroy();
    } catch {
      /* already gone */
    }
  }
}

function connect(cfg: SmtpConfig): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    const socket = cfg.implicitTls
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }, () => {
          socket.off("error", onError);
          resolve(socket);
        })
      : net.connect({ host: cfg.host, port: cfg.port }, () => {
          socket.off("error", onError);
          resolve(socket);
        });
    socket.once("error", onError);
    socket.setTimeout(cfg.timeoutMs, () => socket.destroy(new Error("connection timed out")));
  });
}

function startTls(socket: net.Socket, cfg: SmtpConfig): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: cfg.host }, () => {
      secure.off("error", reject);
      resolve(secure);
    });
    secure.once("error", reject);
  });
}

/* ================================== headers ================================== */

/** RFC 2047 encoded-word — the one concession to non-ASCII, and only in the
 *  subject, where a screenname with an accent in it lands. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Strip CR/LF from anything that lands in a header — header injection is the
 *  one attack a mail composer must not be careless about, and the subject line
 *  here carries a screenname somebody chose. */
const oneLine = (value: string): string => value.replace(/[\r\n]+/g, " ").trim();

/** Dot-stuffing: a body line starting with "." would end the DATA block. */
const stuff = (body: string): string =>
  body
    .split(/\r?\n/)
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");

/* =================================== send ==================================== */

/**
 * Send one invitation email. Returns a value on every path — a mail server
 * that refuses, times out or does not exist must not fail the invitation that
 * was already written.
 */
export async function sendInviteMail(to: string, subject: string, body: string): Promise<MailResult> {
  const cfg = smtpConfig();
  if (!cfg) return { ok: false, error: smtpProblem() ?? "no mail server is configured" };
  const recipient = oneLine(to);
  if (!recipient || recipient.includes(" ")) return { ok: false, error: "that is not an email address" };

  let session: SmtpSession | null = null;
  try {
    const socket = await connect(cfg);
    session = new SmtpSession(socket);
    const expect = async (codes: number[], what: string): Promise<Reply> => {
      const reply = await session!.read(cfg.timeoutMs);
      if (!codes.includes(reply.code)) throw new Error(`${what}: ${reply.text}`);
      return reply;
    };

    await expect([220], "greeting refused");

    const ehloName = process.env.AMBERXVID_SMTP_EHLO?.trim() || "amberxvid.localhost";
    session.write(`EHLO ${ehloName}`);
    let caps = (await expect([250], "EHLO refused")).text;

    if (!cfg.implicitTls && /\bSTARTTLS\b/i.test(caps)) {
      session.write("STARTTLS");
      await expect([220], "STARTTLS refused");
      session.upgrade(await startTls(socket as net.Socket, cfg));
      // The capability list must be re-read after the upgrade: what a server
      // offers in the clear is not what it offers encrypted, and AUTH is
      // routinely withheld until then.
      session.write(`EHLO ${ehloName}`);
      caps = (await expect([250], "EHLO after STARTTLS refused")).text;
    }

    if (cfg.user && cfg.pass) {
      if (/AUTH[^\r\n]*\bPLAIN\b/i.test(caps)) {
        const token = Buffer.from(`\0${cfg.user}\0${cfg.pass}`, "utf8").toString("base64");
        session.write(`AUTH PLAIN ${token}`);
        await expect([235], "authentication failed");
      } else if (/AUTH[^\r\n]*\bLOGIN\b/i.test(caps)) {
        session.write("AUTH LOGIN");
        await expect([334], "authentication failed");
        session.write(Buffer.from(cfg.user, "utf8").toString("base64"));
        await expect([334], "authentication failed");
        session.write(Buffer.from(cfg.pass, "utf8").toString("base64"));
        await expect([235], "authentication failed");
      } else {
        throw new Error("the mail server offers no authentication method this client speaks");
      }
    }

    session.write(`MAIL FROM:<${oneLine(cfg.from)}>`);
    await expect([250], "sender refused");
    session.write(`RCPT TO:<${recipient}>`);
    await expect([250, 251], "recipient refused");
    session.write("DATA");
    await expect([354], "DATA refused");

    const headers = [
      `From: ${oneLine(cfg.from)}`,
      `To: ${recipient}`,
      `Subject: ${encodeHeader(oneLine(subject))}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
    ].join("\r\n");
    session.write(`${headers}${stuff(body)}\r\n.`);
    await expect([250], "the message was refused");

    session.write("QUIT");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "the mail server could not be reached" };
  } finally {
    session?.end();
  }
}
