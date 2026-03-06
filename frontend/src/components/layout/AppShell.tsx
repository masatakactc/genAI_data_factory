"use client";

import { useState } from "react";
import AppSidebar from "./AppSidebar";
import MobileHeader from "./MobileHeader";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background flex justify-center">
      <div className="flex w-full max-w-[1400px]">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex sticky top-0 h-screen w-60 shrink-0 p-2 pr-0">
          <div className="w-full rounded-2xl overflow-hidden shadow-lg">
            <AppSidebar />
          </div>
        </aside>

        {/* Mobile header + sidebar sheet */}
        <div className="lg:hidden fixed top-0 inset-x-0 z-40">
          <MobileHeader onMenuClick={() => setMobileMenuOpen(true)} />
        </div>
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetContent side="left" className="w-60 p-0" showCloseButton={false}>
            <AppSidebar onNavigate={() => setMobileMenuOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Main content */}
        <main className="flex-1 min-w-0 min-h-screen p-6 pt-16 lg:px-12 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
