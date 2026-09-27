import React from 'react';
import { LogOut } from 'lucide-react';
import NotificationBell from '@/components/layout/NotificationBell';
import ThemeToggle from '@/components/layout/ThemeToggle';
import { base44 } from '@/api/base44Client';

const iconButtonClass =
  "w-[18px] h-6 p-0 rounded-[5px] flex items-center justify-center text-[#6b7a9e] hover:text-white hover:bg-white/10 active:scale-[.92] transition-colors transition-transform duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#a9c7ff] focus-visible:outline-offset-1 focus-visible:text-white";

export default function ProfileFooterCard({ currentUser, collapsed }) {
  if (collapsed) {
    return (
      <div className="flex justify-center">
        <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center">
          <span className="text-white text-xs font-semibold">
            {currentUser?.full_name?.charAt(0) || '?'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-[200px] h-12 box-border p-[6px_7px] flex items-center gap-[7px] rounded-[10px] border border-white/[0.08] bg-[#16264a] shadow-[0_5px_14px_rgba(0,0,0,0.22)] transition-[background-color,box-shadow] duration-[180ms] ease-in-out hover:bg-[#20365f] hover:shadow-[0_7px_18px_rgba(0,0,0,0.28)] animate-card-arrive">
      {/* Avatar */}
      <div className="w-[30px] h-[30px] flex-none rounded-full bg-[#294674] flex items-center justify-center">
        <span className="text-[#e8f1ff] text-xs font-semibold">
          {currentUser?.full_name?.charAt(0) || '?'}
        </span>
      </div>

      {/* Identity */}
      <div className="min-w-0 flex-1 flex flex-col gap-[1px] leading-tight">
        <div className="text-[#f2f6ff] text-[11px] font-semibold truncate">
          {currentUser?.full_name || 'User'}
        </div>
        <div className="text-[#aebbd4] text-[9px] font-medium truncate">
          {currentUser?.app_role} · {currentUser?.language_preference?.toUpperCase() || 'EN'}
        </div>
      </div>

      {/* Tools */}
      <div className="flex items-center gap-[3px] flex-none">
        <ThemeToggle className={iconButtonClass} />
        <button className={iconButtonClass} aria-label="Help">
          <span className="text-[15px] leading-none">?</span>
        </button>
        <NotificationBell
          userId={currentUser?.id}
          tenantId={currentUser?.tenant_id}
          className={iconButtonClass}
          badgeVariant="dot"
        />
      </div>

      {/* Logout */}
      <button
        onClick={() => base44?.auth?.logout?.()}
        aria-label="Logout"
        className="w-[17px] h-6 flex-none flex items-center justify-center rounded-[5px] text-[#6b7a9e] hover:text-white hover:bg-white/10 active:scale-[.92] transition-colors transition-transform duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#a9c7ff] focus-visible:outline-offset-1 focus-visible:text-white"
      >
        <LogOut className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}