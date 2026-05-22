import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const alertVariants = cva("rounded-md px-3 py-2 text-sm", {
  variants: {
    variant: {
      default: "bg-background text-foreground",
      destructive: "text-destructive dark:text-red-300"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

function Alert({ className, variant, ...props }: AlertProps): React.JSX.Element {
  return <div className={cn(alertVariants({ variant }), className)} role="alert" {...props} />;
}

export { Alert };
