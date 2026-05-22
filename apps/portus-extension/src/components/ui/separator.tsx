import * as React from "react";
import { cn } from "../../lib/utils.js";

function Separator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("h-px w-full bg-border", className)} role="separator" {...props} />;
}

export { Separator };
