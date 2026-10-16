import { Link, useRouterState } from "@tanstack/react-router";
import { LibraryBig, Settings2, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Meetings", icon: LibraryBig },
  { to: "/settings", label: "Settings", icon: Settings2 },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen bg-background">
      <nav
        aria-label="Primary"
        className="hidden w-56 shrink-0 flex-col border-r border-border bg-sidebar px-3 py-4 md:flex"
      >
        <Link to="/" className="mb-6 flex items-center gap-2 rounded-md px-2 py-1">
          <img src="./tara-icon.png" alt="" className="size-8 shrink-0" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">Tara</span>
        </Link>

        <ul className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-auto flex items-start gap-2 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <p>Audio and transcripts stay on this computer unless you turn on external AI.</p>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
