import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "sm" | "md";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  kbd?: string;
};

const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary/90 border border-primary",
  accent: "bg-ink text-ground hover:bg-ink/90 border border-ink",
  secondary: "bg-surface text-ink border border-control hover:bg-raised",
  ghost: "text-muted hover:text-ink hover:bg-active border border-transparent",
  danger: "bg-surface text-negative border border-control hover:bg-negative-bg hover:border-negative/40",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-2.5 text-sm gap-1.5",
  md: "h-9 px-3.5 text-[14px] gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, kbd, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-control font-medium transition-colors duration-100 active:translate-y-px disabled:pointer-events-none disabled:opacity-55",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
      {kbd && (
        <kbd className={cn("ml-1 hidden rounded px-1 font-sans text-2xs sm:inline", variant === "primary" ? "bg-on-primary/15" : "bg-active text-faint")}>{kbd}</kbd>
      )}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: Size }>(
  function IconButton({ label, className, children, size = "md", type = "button", ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-active hover:text-ink disabled:opacity-50",
          size === "sm" ? "h-7 w-7" : "h-9 w-9",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
