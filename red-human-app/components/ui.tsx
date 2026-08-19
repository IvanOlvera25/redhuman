import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/* ---------- Logo ----------
   Wordmark oficial: "Red" gris + "Human" rojo con subrayado rojo.
   `onDark` fuerza la variante clara para paneles con fondo oscuro fijo. */
export function Logo({
  className = "",
  onDark = false,
  size = "md",
}: {
  className?: string;
  onDark?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const sizes: Record<string, string> = {
    sm: "text-[17px]",
    md: "text-[21px]",
    lg: "text-[28px]",
  };
  return (
    <span
      className={cn(
        "inline-flex flex-col leading-none tracking-tight select-none",
        sizes[size],
        className,
      )}
      aria-label="RedHuman"
    >
      <span className="pb-[0.14em] font-sans font-semibold">
        <span className={onDark ? "text-white" : "text-ink-2"}>Red</span>
        <span className="text-brand">Human</span>
      </span>
      <span className="h-[0.09em] w-full rounded-full bg-brand" aria-hidden />
    </span>
  );
}

/* ---------- Button ---------- */
type ButtonProps = {
  variant?: "primary" | "secondary" | "ghost" | "outline";
  size?: "sm" | "md" | "lg";
  className?: string;
  href?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const btnBase =
  "relative inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-200 focus-visible:outline-2 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap select-none";
const btnVariants: Record<string, string> = {
  primary:
    "bg-brand text-brand-ink hover:brightness-110 shadow-[0_8px_24px_-10px_var(--glow)] hover:shadow-[0_12px_32px_-8px_var(--glow)] active:scale-[0.98]",
  secondary: "bg-surface-2 text-ink border border-border-soft hover:border-brand/50 active:scale-[0.98]",
  outline: "border border-border-soft text-ink hover:bg-surface-2 hover:border-brand/50 active:scale-[0.98]",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
};
const btnSizes: Record<string, string> = {
  sm: "h-9 px-3.5 text-[13px]",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export function Button({ variant = "primary", size = "md", className, href, ...props }: ButtonProps) {
  const cls = cn(btnBase, btnVariants[variant], btnSizes[size], className);
  if (href) {
    return (
      <Link href={href} className={cls}>
        {props.children}
      </Link>
    );
  }
  return <button className={cls} {...props} />;
}

/* ---------- Card ---------- */
export function Card({
  className,
  hover = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border-soft bg-surface",
        hover && "card-hover",
        className,
      )}
      {...props}
    />
  );
}

/* ---------- Badge / Pill ---------- */
const toneMap: Record<string, string> = {
  brand: "bg-brand-soft text-brand border-brand/25",
  human: "bg-human-soft text-human border-human/25",
  good: "bg-good-soft text-good border-good/25",
  warn: "bg-warn-soft text-warn border-warn/25",
  bad: "bg-bad-soft text-bad border-bad/25",
  neutral: "bg-surface-2 text-ink-2 border-border-soft",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  dot = false,
}: {
  tone?: keyof typeof toneMap;
  className?: string;
  children: React.ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold font-mono",
        toneMap[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ---------- Eyebrow ---------- */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-brand",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Progress ---------- */
export function Progress({ value, tone = "brand" }: { value: number; tone?: "brand" | "human" | "good" | "warn" }) {
  const colors: Record<string, string> = {
    brand: "bg-brand",
    human: "bg-human",
    good: "bg-good",
    warn: "bg-warn",
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className={cn("h-full rounded-full transition-all duration-700", colors[tone])}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

/* ---------- Avatar ---------- */
export function Avatar({ name, tone = 0 }: { name: string; tone?: number }) {
  const grads = [
    "from-brand to-brand-2",
    "from-[#6b6c70] to-[#454649]",
    "from-[#f26663] to-brand-2",
    "from-human to-human-2",
  ];
  const ini = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br text-[12px] font-bold text-white",
        grads[tone % grads.length],
      )}
    >
      {ini}
    </span>
  );
}
