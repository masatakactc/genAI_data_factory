"use client";

import { Menu, Factory } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MobileHeaderProps {
  onMenuClick: () => void;
}

export default function MobileHeader({ onMenuClick }: MobileHeaderProps) {
  return (
    <header className="lg:hidden sticky top-0 z-50 h-14 border-b bg-background/80 backdrop-blur-sm flex items-center px-4 gap-3">
      <Button variant="ghost" size="icon" onClick={onMenuClick}>
        <Menu className="size-5" />
      </Button>
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center size-6 rounded-md bg-primary">
          <Factory className="size-3 text-primary-foreground" />
        </div>
        <span className="font-bold text-sm tracking-tight">
          GenAI Data Factory
        </span>
      </div>
    </header>
  );
}
