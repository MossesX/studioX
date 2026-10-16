/**
 * axv-p22/seed-front-door.mjs — the cast's IDENTITIES in the dev server's own
 * roster, and nothing else.
 *
 * WHY THIS EXISTS, because it is a deviation and deserves the paragraph.
 *
 * Mid-walk (2026-08-15, ~09:00 local) another session landed `proxy.ts`, the
 * studio's new front door: Next 16's renamed middleware, running IN THE DEV
 * SERVER PROCESS, which verifies `axs_session` and then RE-READS the account
 * from `findAccount` before any page renders. That read uses the dev server's
 * own `ACCOUNTS_DATA_DIR` — the real studio roster — so a walk whose cast lives
 * in a scratch root gets bounced to `/login` on every navigation, however valid
 * its cookie is. `brett` and `jenny` sailed through only because the real
 * roster happens to hold a `Brett` and a `jenny`; `carl`, `dana`, `evan`,
 * `finn` and the invited newcomers did not exist there and could not open a
 * single page.
 *
 * Three ways out were available and this is the least invasive:
 *
 *   - pointing the walk at the real data root would have written the whole
 *     cast's relations, messages, wall and media into the studio's live store
 *     (the `axv-p13-proof-server.mjs` precedent refuses exactly that);
 *   - a second `next dev` in the same directory shares `.next` with the
 *     session that owns :3200, and corrupting their cache to finish my phase
 *     is not a trade I get to make;
 *   - so: the ACCOUNTS ONLY, created through the real `addUser` door, with the
 *     same passwords the walk uses. Every relation, message, post, album,
 *     recording, credit and moderation row stays in the scratch roots.
 *
 * Additive and reversible. `--remove` takes them back out again.
 */
import { addUser, changePassword, listAccounts, removeUser, setScreenname, verifyLogin } from "@axs/modules/accounts/lib/accounts";

const REMOVE = process.argv.includes("--remove");
const CAST = ["brett", "jenny", "carl", "dana", "evan", "finn", "nova", "pixel"];
const PASSWORD = (u) => `P22-${u}-pass`;

/** An administrator who has finished their own entry flow — `gateAdmin`
 *  refuses one who has not, and the seeded `admin` here still has a temp
 *  password on it. */
async function actingAdmin() {
  for (const a of await listAccounts()) {
    if (a.role === "administrator" && a.disabled !== true && a.mustChangePassword !== true) return a.username;
  }
  throw new Error("no administrator in the dev roster has completed the entry flow");
}

const admin = await actingAdmin();
console.log(`[front-door] acting administrator: ${admin}`);

for (const user of CAST) {
  if (REMOVE) {
    const gone = await removeUser(admin, user);
    console.log(`[front-door] ${user}: ${gone.ok ? "removed" : gone.error}`);
    continue;
  }
  const already = await verifyLogin(user, PASSWORD(user));
  if (already.ok) {
    console.log(`[front-door] ${user}: already present`);
    continue;
  }
  const temp = `Temp-${user}-22`;
  const added = await addUser(admin, user, temp, "member");
  if (!added.ok && added.status !== 409) {
    console.log(`[front-door] ${user}: NOT added — ${added.error}`);
    continue;
  }
  const changed = await changePassword(user, temp, PASSWORD(user));
  if (!changed.ok) {
    console.log(`[front-door] ${user}: password not set — ${changed.error} (an existing account keeps its own)`);
    continue;
  }
  await setScreenname(user, user[0].toUpperCase() + user.slice(1));
  console.log(`[front-door] ${user}: added`);
}

console.log(`[front-door] roster: ${(await listAccounts()).map((a) => a.username).join(", ")}`);
