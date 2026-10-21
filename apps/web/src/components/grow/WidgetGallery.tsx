import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { useWidgetPool, WidgetPage } from "./WidgetPage";

const GALLERY_THREAD = { title: "Fund hint on the Plan card", status: "review" };

/** Every widget in the pool drawn from its own example, like Storybook docs. */
function WidgetGallery(props: { readonly environmentId: EnvironmentId }) {
  const pool = useWidgetPool(props.environmentId, []);
  const blocks = useMemo(
    () =>
      (pool?.widgets ?? []).map((widget) => ({
        widget: widget.name,
        props: widget.meta.example,
        caption: { title: widget.name, detail: widget.meta.description },
      })),
    [pool],
  );
  if (pool === null) return <p className="text-muted-foreground text-sm">Loading the pool...</p>;
  if (!pool.configured) {
    return <p className="text-muted-foreground text-sm">No widget pool is set.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {pool.broken.map((broken) => (
        <p key={broken.name} className="rounded-md border border-dashed px-3 py-2 text-xs">
          <span className="font-medium font-mono">{broken.name}</span>
          <span className="text-muted-foreground"> does not load: {broken.error}</span>
        </p>
      ))}
      {blocks.length === 0 ? (
        <p className="text-muted-foreground text-sm">{pool.dir} has no widgets yet.</p>
      ) : (
        <WidgetPage
          environmentId={props.environmentId}
          blocks={blocks}
          thread={GALLERY_THREAD}
          readOnly
          onAnswer={() => undefined}
        />
      )}
    </div>
  );
}

export function WidgetGalleryButton() {
  const environmentId = usePrimaryEnvironmentId();
  const [open, setOpen] = useState(false);
  if (environmentId === null) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Gallery
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Widget pool</DialogTitle>
            <DialogDescription>
              What living pages are made of. When none fits, a widget smith adds one here.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>{open ? <WidgetGallery environmentId={environmentId} /> : null}</DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}
