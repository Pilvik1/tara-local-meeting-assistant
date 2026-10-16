const WINDOW_TITLES: Array<[prefix: string, title: string]> = [
  ["/meeting/", "Meeting"],
  ["/settings", "Settings"],
  ["/record", "Recording"],
  ["/new", "New meeting"],
  ["/onboarding", "Welcome"],
];

export function windowTitleForPath(pathname: string): string {
  if (pathname === "/") return "Meetings";
  return WINDOW_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "Tara";
}

export function WindowTitleBar({ pathname }: { pathname: string }) {
  return (
    <header className="tara-titlebar flex h-[42px] shrink-0 items-center border-b border-sidebar-border bg-sidebar px-3 pr-36 text-sidebar-foreground">
      <div className="flex min-w-0 items-center gap-2.5">
        <img src="./tara-icon.png" alt="" className="size-6 shrink-0" aria-hidden />
        <span className="text-xs font-semibold tracking-tight">Tara</span>
        <span className="h-3.5 w-px shrink-0 bg-sidebar-border" aria-hidden />
        <span className="truncate text-xs text-muted-foreground">
          {windowTitleForPath(pathname)}
        </span>
      </div>
    </header>
  );
}
