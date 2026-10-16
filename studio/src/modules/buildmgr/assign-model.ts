/**
 * @file The Assign-model popup's STATE — the seam between a context-menu
 * command and the React tree.
 *
 * A `CommandHandler` takes no arguments and runs outside React (see
 * `taskman.commands.ts` for the idiom this copies), so the command cannot open
 * a dialog by calling a hook. It parks the right-clicked step's coordinates
 * here instead, and `AssignModelPopup` — mounted once by `BuildmgrModule` —
 * subscribes and renders the popup whenever a target is set.
 *
 * Module-scope singleton with `useSyncExternalStore`'s three-function shape,
 * like every other client store in this tree. `getServerState()` is always
 * "closed": a popup is interaction state, and the server render never has an
 * interaction to show.
 */

export interface AssignModelTarget {
  /** Bare `.bmpx` filename — what `/api/bmpx/plan` addresses. */
  file: string;
  /** The phase's own `n`, not its array index — indices move when the
   *  fable-redo switch inserts its generated phase; `n` does not. */
  phaseN: number;
  stepIndex: number;
  /** The step's STORED model slug (`""` = builder default). */
  model: string;
  /** A done step is refused by the API; the popup says so instead of trying. */
  done: boolean;
}

type Listener = () => void;

class AssignModelUi {
  private target: AssignModelTarget | null = null;
  private listeners = new Set<Listener>();

  getState = (): AssignModelTarget | null => this.target;
  getServerState = (): AssignModelTarget | null => null;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  open(target: AssignModelTarget): void {
    this.target = target;
    this.emit();
  }

  close(): void {
    if (!this.target) return;
    this.target = null;
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

export const assignModelUi = new AssignModelUi();
