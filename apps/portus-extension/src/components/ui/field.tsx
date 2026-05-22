import * as React from "react";
import { cn } from "../../lib/utils.js";

function FieldGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("flex flex-col gap-3", className)} {...props} />;
}

function Field({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

function FieldLabel({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>): React.JSX.Element {
  return <label className={cn("text-xs font-semibold text-muted-foreground", className)} {...props} />;
}

function FieldDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>): React.JSX.Element {
  return <p className={cn("text-xs leading-5 text-muted-foreground", className)} {...props} />;
}

export { Field, FieldDescription, FieldGroup, FieldLabel };
