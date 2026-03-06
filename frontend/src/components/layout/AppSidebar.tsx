"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Factory, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/templates", label: "テンプレート", icon: FileText },
  { href: "/jobs/augment", label: "データ増幅", icon: Copy },
];

interface AppSidebarProps {
  onNavigate?: () => void;
}

export default function AppSidebar({ onNavigate }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex items-center gap-3 h-16 px-5">
        <div className="flex items-center justify-center size-9 rounded-xl bg-sidebar-primary">
          <Factory className="size-5 text-sidebar-primary-foreground" />
        </div>
        <Link
          href="/templates"
          className="font-bold text-sm tracking-tight text-sidebar-foreground"
          onClick={onNavigate}
        >
          GenAI Data Factory
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-1.5">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-xl px-4 py-3 text-base font-medium transition-all duration-200",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="size-5 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
