import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "../../lib/utils.js";

export function Accordion({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return <div className={cn("grid gap-1", className)}>{children}</div>;
}

export function AccordionItem({
  title,
  children,
  defaultOpen = false
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="rounded-md border">
      <button
        aria-expanded={open}
        className="flex min-h-9 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-semibold hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{title}</span>
        <ChevronDownIcon aria-hidden="true" className={cn("size-4 shrink-0 transition-transform", open ? "rotate-180" : "")} />
      </button>
      {open ? <div className="border-t p-3">{children}</div> : null}
    </section>
  );
}
