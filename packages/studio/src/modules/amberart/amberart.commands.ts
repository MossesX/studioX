/**
 * @file The behaviour behind AmberArt's context-menu rows.
 *
 * The menu is DATA on `amberart.decl.ts`; the two meet only through a command
 * NAME. The engine parks the resolved click in `activeContext()`, and
 * `MenuContext.data` carries every `data-axf-*` attribute harvested up the area
 * chain — so the screen marks `data-axf-layer="<id>"` on a layer row and these
 * handlers read `ctx.data.layer`.
 *
 * Plain functions over the `amberArt` singleton, which is exactly why the
 * document is a store: a command has no hooks and cannot reach component state,
 * and "Undo" on a menu that cannot undo is the worst kind of dead row.
 *
 * Registration is idempotent and must run BEFORE `registerModuleMenus` — the
 * map's gate refuses an item naming an unregistered command or predicate, which
 * is what makes a typo a loud boot failure rather than a silent gap.
 */
import { activeContext, commands, predicates } from "@axf/core";

import { amberArt } from "./store";

/** The click's harvested data — `{}` when fired from a palette. */
function ctxData(): Record<string, string> {
  return activeContext()?.data ?? {};
}

/**
 * The layer a row-click landed on, falling back to the ACTIVE layer.
 *
 * The fallback is what lets the same commands work from the canvas area and
 * from a palette, where there is no layer row under the pointer.
 */
function targetLayer(): string {
  return ctxData().layer ?? amberArt.getState().activeLayer;
}

let registered = false;

export function registerAmberArtCommands(): void {
  if (registered) return;
  registered = true;

  if (!predicates.has("amberart.removable-layer")) {
    predicates.register({
      id: "amberart.removable-layer",
      title: "More than one layer exists",
      test: () =>
        amberArt.getState().layers.length > 1
          ? true
          : "a document must keep at least one layer — add another first"
    });
  }

  if (!predicates.has("amberart.mergeable-layer")) {
    predicates.register({
      id: "amberart.mergeable-layer",
      title: "A layer exists below this one",
      test: () => {
        const { layers } = amberArt.getState();
        return layers.findIndex((l) => l.id === targetLayer()) > 0
          ? true
          : "the bottom layer has nothing below it to merge into";
      }
    });
  }

  if (!predicates.has("amberart.has-selection")) {
    predicates.register({
      id: "amberart.has-selection",
      title: "Something is selected",
      test: () =>
        amberArt.getState().hasSelection
          ? true
          : "nothing is selected — drag a marquee, a lasso, or click with the wand first"
    });
  }

  if (!commands.has("amberart.undo")) {
    commands.register({ id: "amberart.undo", title: "Undo the last stroke", run: () => amberArt.undo() });
  }

  if (!commands.has("amberart.redo")) {
    commands.register({ id: "amberart.redo", title: "Redo the undone stroke", run: () => amberArt.redo() });
  }

  if (!commands.has("amberart.export")) {
    commands.register({
      id: "amberart.export",
      title: "Export the canvas as a PNG",
      run: () => amberArt.exportPng()
    });
  }

  if (!commands.has("amberart.filters.open")) {
    commands.register({
      id: "amberart.filters.open",
      title: "Open the filters and adjustments panel",
      /* The command opens the panel and stops there. Running a filter from a
         menu row would mean choosing its parameters for the person, and every
         filter worth having has some — the panel is where they are chosen and
         previewed before anything is written. */
      run: () => amberArt.openFilters()
    });
  }

  if (!commands.has("amberart.select.all")) {
    commands.register({
      id: "amberart.select.all",
      title: "Select the whole canvas",
      run: () => amberArt.selectAll()
    });
  }

  if (!commands.has("amberart.select.none")) {
    commands.register({
      id: "amberart.select.none",
      title: "Drop the selection",
      run: () => amberArt.clearSelection()
    });
  }

  if (!commands.has("amberart.select.invert")) {
    commands.register({
      id: "amberart.select.invert",
      title: "Select everything that is not selected",
      run: () => amberArt.invertSelection()
    });
  }

  if (!commands.has("amberart.layer.add")) {
    commands.register({
      id: "amberart.layer.add",
      title: "Add a layer above the current one",
      run: () => void amberArt.addLayer()
    });
  }

  if (!commands.has("amberart.layer.remove")) {
    commands.register({
      id: "amberart.layer.remove",
      title: "Delete a layer and its pixels",
      run: () => amberArt.removeLayer(targetLayer())
    });
  }

  if (!commands.has("amberart.layer.duplicate")) {
    commands.register({
      id: "amberart.layer.duplicate",
      title: "Duplicate a layer and its pixels",
      run: () => amberArt.duplicateLayer(targetLayer())
    });
  }

  if (!commands.has("amberart.layer.merge")) {
    commands.register({
      id: "amberart.layer.merge",
      title: "Merge a layer down into the one below",
      run: () => amberArt.mergeDown(targetLayer())
    });
  }

  if (!commands.has("amberart.layer.flatten")) {
    commands.register({
      id: "amberart.layer.flatten",
      title: "Flatten every visible layer into the bottom one",
      run: () => amberArt.flatten()
    });
  }

  if (!commands.has("amberart.layer.clear")) {
    commands.register({
      id: "amberart.layer.clear",
      title: "Clear a layer's pixels, undoably",
      run: () => amberArt.clearLayer(targetLayer())
    });
  }

  if (!commands.has("amberart.layer.texturize")) {
    commands.register({
      id: "amberart.layer.texturize",
      title: "Lay the current texture over a layer's own pixels",
      run: () => amberArt.texturizeLayer(targetLayer())
    });
  }

  if (!commands.has("amberart.layer.toggle")) {
    commands.register({
      id: "amberart.layer.toggle",
      title: "Show or hide a layer",
      run: () => {
        const id = targetLayer();
        const layer = amberArt.getState().layers.find((l) => l.id === id);
        if (layer) amberArt.patchLayer(id, { visible: !layer.visible });
      }
    });
  }

  if (!commands.has("amberart.layer.raise")) {
    commands.register({
      id: "amberart.layer.raise",
      title: "Bring a layer forward",
      run: () => amberArt.moveLayer(targetLayer(), 1)
    });
  }

  if (!commands.has("amberart.layer.lower")) {
    commands.register({
      id: "amberart.layer.lower",
      title: "Send a layer back",
      run: () => amberArt.moveLayer(targetLayer(), -1)
    });
  }
}
