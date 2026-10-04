"use client";

import { Fragment } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Keys handled by the workspace keydown effect — keep the two in sync. */
const KEYBOARD_SHORTCUTS: Array<{ combos: string[][]; description: string }> = [
  {
    combos: [["Delete"], ["Backspace"]],
    description: "Delete the selected box (rejects an AI suggestion)",
  },
  { combos: [["Ctrl / ⌘", "Z"]], description: "Undo" },
  { combos: [["Ctrl / ⌘", "Shift", "Z"]], description: "Redo" },
  { combos: [["A"]], description: "Accept the selected AI suggestion" },
  { combos: [["Shift", "A"]], description: "Accept all AI suggestions on this image" },
];

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts are paused while you type in a text field or have a
            dialog or menu open.
          </DialogDescription>
        </DialogHeader>
        <dl className="divide-y rounded-lg border">
          {KEYBOARD_SHORTCUTS.map((shortcut) => (
            <div key={shortcut.description} className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm">
              <dt>{shortcut.description}</dt>
              <dd className="flex shrink-0 flex-wrap items-center justify-end gap-1 text-xs text-muted-foreground">
                {shortcut.combos.map((combo, index) => (
                  <Fragment key={combo.join("+")}>
                    {index > 0 ? <span>or</span> : null}
                    <span className="flex items-center gap-0.5">
                      {combo.map((key) => (
                        <kbd key={key} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </Fragment>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
