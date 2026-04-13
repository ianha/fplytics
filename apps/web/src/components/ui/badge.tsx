import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/20 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive/20 text-destructive-foreground",
        outline: "border-border text-foreground",
        teal: "border-transparent bg-accent/20 text-accent",
        magenta: "border-transparent bg-primary/20 text-primary",
        position:
          "border-border/50 bg-secondary/50 text-muted-foreground font-medium",
        // H2H luck/skill states
        "lucky-lead":
          "border-transparent bg-primary/15 text-primary font-semibold",   // rival running hot — magenta
        "unlucky-deficit":
          "border-transparent bg-accent/15 text-accent font-semibold",     // user underperforming xP — teal
        "under-index":
          "border-destructive/40 bg-destructive/10 text-destructive-foreground font-medium",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
