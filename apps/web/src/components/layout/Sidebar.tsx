import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Calendar,
  BarChart2,
  Menu,
  TrendingUp,
  Shield,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/my-team", label: "My Team", icon: Shield },
  { to: "/players", label: "Players", icon: Users },
  { to: "/fixtures", label: "Fixtures", icon: Calendar },
  { to: "/fixtures/fdr", label: "FDR Ticker", icon: BarChart2 },
  { to: "/chat", label: "AI Chat", icon: MessageSquare },
] as const;

function SidebarContent({ onItemClick }: { onItemClick?: () => void }) {
  const location = useLocation();

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="border-b border-white/10 bg-black/20 p-5 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 shadow-lg shadow-primary/40">
            <TrendingUp className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-base font-bold text-white tracking-wide">
              FPLytics
            </h1>
            <p className="text-[10px] text-white/50 uppercase tracking-widest">
              Fantasy Premier League analytics
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 p-3">
        <p className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
          Navigation
        </p>
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive =
            to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
          return (
            <NavLink
              key={to}
              to={to}
              onClick={onItemClick}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 cursor-pointer",
                isActive
                  ? "bg-gradient-to-r from-primary/25 to-primary/10 text-white shadow-[0_0_20px_rgba(233,0,82,0.15)]"
                  : "text-white/60 hover:bg-white/5 hover:text-white",
              )}
            >
              {isActive && (
                <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-primary/15 to-transparent blur-xl pointer-events-none" />
              )}
              <Icon
                className={cn(
                  "relative h-4 w-4 shrink-0 transition-colors",
                  isActive ? "text-primary" : "text-white/50 group-hover:text-white/80",
                )}
              />
              <span className="relative">{label}</span>
              {isActive && (
                <div className="absolute right-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-l-full bg-gradient-to-b from-primary to-primary/60" />
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 bg-black/20 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2.5 rounded-lg bg-accent/10 px-3 py-2.5 ring-1 ring-accent/20">
          <div className="h-2 w-2 rounded-full bg-accent animate-pulse shrink-0" />
          <div>
            <p className="text-xs font-semibold text-accent">Live Data</p>
            <p className="text-[10px] text-white/40">Updated this GW</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile header bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between border-b border-white/10 bg-black/60 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 shadow-md shadow-primary/40">
            <TrendingUp className="h-4 w-4 text-white" />
          </div>
          <span className="font-display text-sm font-bold text-white">FPLytics</span>
        </div>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-64 border-white/10 bg-gradient-to-br from-[#0d0118] via-[#1a0530] to-[#0d0118] p-0"
          >
            <SidebarContent onItemClick={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 h-screen sticky top-0 border-r border-white/10 bg-gradient-to-br from-[#0d0118] via-[#150826] to-[#0d0118]">
        {/* Radial gradient overlays for depth */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(233,0,82,0.08)_0%,transparent_60%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(0,255,191,0.06)_0%,transparent_60%)] pointer-events-none" />
        <div className="relative flex flex-col h-full">
          <SidebarContent />
        </div>
      </aside>
    </>
  );
}
