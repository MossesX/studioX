---
name: AmberX Vid — overview
description: What AmberX Vid is, the route it lives at, and the surfaces it publishes. Use for any question about what this module is for or where to find it.
---
# AmberX Vid

The social video platform, on the accounts module as its one identity system: a wall and a merged feed, albums, buddies, blocks and group chats in accounts messaging, 1:1 calls and N-way group rooms, member broadcasting with both-direction recording, invitations that land straight in a room, the recorder and its library, and an AmberX Vid moderation wing inside the accounts admin suite. Calls, rooms and streams are relayed by the AmberX Vid media server.

## Where it is

- Route: `/amberxvid`
- Module id: `amberxvid` — contributions target it as `module:amberxvid`
- Glyph: `icon-play`

## What it publishes

- `amberxvid.credits-meter` — A feature that costs AI credits. The contribution is pure DATA — `id`, `title`, an optional `hint` and pack `glyph`, and `cost` in credits per unit (0 is legal and means declared-but-free). No thunk and no component: a meter is a price, not a surface. The charge itself goes through `chargeMeter()`, which resolves the price, refuses an unknown id rather than defaulting one, and answers 402 (cannot afford) rather than 403 (not allowed) so the two conversations stay apart.
- `amberxvid.profile-rail` — A pane in the Shelves column of a member's profile page, under the albums and media shelves. The contribution supplies `id`, `title`, an optional pack `glyph` and a `load` thunk importing a component that is handed a ProfileRailHost — `user` (whose profile), `screenname`, `me` and `mine`, and nothing else. Whose profile it is and whether it is the viewer's own are the two facts every shelf on that column already branches on; a pane wanting more should make the case for a wider host, not be handed the page.
- `amberxvid.wall-composer-action` — An action in the wall composer's button row, beside Photos and the visibility picker. The contribution is a COMMAND, not a panel: `id`, `label`, a pack `glyph` and `run(host)`, where host carries `owner` (whose wall this post lands on), `me`, the current `draft` and `notify`. A returned string is appended to the draft; returning nothing means the action did its work elsewhere. It cannot reach the composer's attachments or its submit — a contribution that could post on the member's behalf is a different and much larger permission than one that can offer them a sentence.
- `amberxvid.messenger-action` — An action offered on one message in a conversation, drawn as an icon button that appears on the bubble under the pointer. The contribution supplies `id`, `label`, a pack `glyph`, an optional `appliesTo(message)` predicate and `run(message, host)`; the message facts are id, thread, author, text, timestamp and whether it is the viewer's own, and the host offers `notify` and `compose` (put text in the draft). Plain functions and no component, so a bubble costs no lazy boundary.
- `amberxvid.stream-tool` — A control in the stream room's control bar, beside the recording toggles and Leave / End stream. The contribution supplies `id`, `title`, a pack `glyph`, an `audience` of `host` | `viewer` | `both` (default `both`) and a `load` thunk importing a component handed a StreamToolHost: the stream's id, host, title, the viewer's own name, whether they are the one broadcasting, the live follow state, `setFollow` and `notify`. `audience` is declared rather than left to the component because a control that renders and then decides it does not apply has already taken the space.
- `amberxvid.room-tile-badge` — An overlay badge on a participant tile in the group room's grid, drawn in the tile's name strip. The contribution is pure DATA — `id`, a pack `glyph`, an optional `tone` (accent | ok | warn | err | dim) and `appliesTo(tile)` returning the badge's label for THIS participant or null for 'not on this one'. The host draws it; the contribution never returns a component and never returns an element. Tile facts are the roster's: user, display name, role, whether it is you, speaking, mic muted, camera off.
- `amberxvid.settings-section` — A card at the foot of the module's settings stage, after the preference groups. The contribution supplies `id`, `title`, an optional `summary` and pack `glyph`, and a `load` thunk importing a component handed `{ notify }`. This is for a section that owns its OWN document — a balance, a device, a licence — not for adding rows to the module's preferences: those are declared on `settings.rows` above, where the framework dialog and the kv store can both see them.
- `amberxvid.admin-tool` — A card in the AmberX Vid moderation wing inside the accounts admin suite, under a Tools tab that appears only when something is contributed. The contribution supplies `id`, `title`, an optional `summary` and pack `glyph`, and a `load` thunk importing a component handed an AdminToolHost with `notify` and `reload` (re-read the wing's snapshot after an act). A tool acts through the module's own API and writes the accounts audit log like every other act in the wing — the host does not hand it the snapshot, because a tool that could act on a state it was given cannot be sure that state is still true.

## Surfaces

- Context areas: `amberxvid.member`, `amberxvid.message`, `amberxvid.post`, `amberxvid.photo`, `amberxvid.stream`, `amberxvid.room`, `amberxvid.history`, `amberxvid.recording`, `amberxvid.surface`
- Settings: 19 row(s) under `amberxvid-settings`
- Navigation: `amberxvid-nav`
