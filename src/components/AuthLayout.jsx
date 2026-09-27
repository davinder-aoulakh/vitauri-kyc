import React from "react";
import { cn } from "@/lib/utils";

export default function AuthLayout({ icon: Icon, iconSpin, title, subtitle, footer, children }) {
  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden px-4 py-12 bg-[#0a1c3d]">
      {/* Radial glows */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 80% 10%, rgba(41,78,158,0.55), transparent 55%)' }}
      />
      <div
        className="absolute inset-0 pointer-events-none animate-glow"
        style={{ background: 'radial-gradient(ellipse at 15% 90%, rgba(7,65,153,0.35), transparent 50%)' }}
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-10">
          {/* VITAURI wordmark */}
          <div className="inline-flex items-baseline mb-6 select-none">
            <span className="text-3xl font-bold tracking-tight text-[#5b9cf6]">A</span>
            <span className="text-3xl font-bold tracking-tight text-white">ITAUR</span>
            <span className="text-3xl font-bold tracking-tight text-[#5b9cf6]">I</span>
          </div>

          {Icon && (
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-white/10 border border-white/15 mb-4">
              <Icon className={cn("w-7 h-7 text-[#5b9cf6]", iconSpin && "animate-spin")} />
            </div>
          )}

          <h1 className="text-3xl font-serif-accent tracking-tight text-white">{title}</h1>
          {subtitle && <p className="text-[#a8c8ec] mt-2 text-sm">{subtitle}</p>}
        </div>

        <div className="bg-white rounded-[28px] shadow-2xl border border-white/10 p-8">
          {children}
        </div>

        {footer && (
          <p className="text-center text-sm text-[#a8c8ec] mt-6">{footer}</p>
        )}
      </div>
    </div>
  );
}