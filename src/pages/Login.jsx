import React, { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import GoogleIcon from "@/components/GoogleIcon";
import { safeReturnTo } from "@/lib/authReturnTo";

const FEATURE_PILLS = ["Onboard & Verify", "Screen & Triage", "Case Management"];

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Post-login destination (e.g. the MCP OAuth consent page sends users here
  // with returnTo so the grant flow can resume). Same-origin paths only.
  const returnTo = safeReturnTo();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await base44.auth.loginViaEmailPassword(email, password);
      window.location.href = returnTo;
    } catch (err) {
      setError(err.message || "Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = () => {
    base44.auth.loginWithProvider("google", returnTo);
  };

  return (
    <div className="min-h-screen bg-[#0a1530] flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 md:px-10 py-5 border-b border-white/10">
        <div className="inline-flex items-center gap-3 select-none">
          <span className="text-xl font-bold tracking-tight text-white">
            VIT<span className="text-[#5b9cf6]">A</span>URI
          </span>
          <span className="px-2 py-0.5 rounded-full border border-white/20 text-[10px] font-semibold tracking-wider text-white/70">
            KYC
          </span>
        </div>
        <a href="#" className="text-sm text-white/70 hover:text-white transition-colors">
          Need help?
        </a>
      </header>

      {/* Hero */}
      <main className="flex-1 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 75% 25%, rgba(41,78,158,0.45), transparent 55%)" }}
        />
        <div
          className="absolute inset-0 pointer-events-none animate-glow"
          style={{ background: "radial-gradient(ellipse at 10% 90%, rgba(7,65,153,0.3), transparent 50%)" }}
        />

        <div className="relative z-10 max-w-6xl mx-auto px-6 md:px-10 py-16 md:py-24 grid md:grid-cols-2 gap-12 items-center">
          {/* Left copy */}
          <div>
            <div className="eyebrow text-[#7fb3ff] mb-5">KYC · COMPLIANCE PLATFORM</div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white leading-[1.1]">
              Welcome back
              <br />
              <span className="text-[#a9c8f5]">to Vitauri KYC.</span>
            </h1>
            <p className="text-white/60 mt-5 max-w-md">
              Onboard, verify and screen customers with AI-assisted workflows and a continuous audit trail.
            </p>
            <div className="flex flex-wrap gap-3 mt-8">
              {FEATURE_PILLS.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/15 bg-white/5 text-sm text-white/80"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Login card */}
          <div className="w-full max-w-md md:ml-auto">
            <div className="rounded-3xl border border-white/10 bg-[#0f2049]/80 backdrop-blur-md p-8 shadow-2xl">
              <h2 className="text-2xl font-semibold text-white">Log in</h2>
              <p className="text-white/50 text-sm mt-1 mb-6">Use your work account to continue.</p>

              <Button
                variant="outline"
                className="w-full h-12 text-sm font-medium border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
                onClick={handleGoogle}
              >
                <GoogleIcon className="w-5 h-5 mr-2" />
                Continue with Google
              </Button>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-[#0f2049] px-3 text-white/40">or</span>
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3 rounded-lg bg-destructive/15 text-red-300 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-white/80">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 bg-white/5 border-white/15 text-white placeholder:text-white/30 focus-visible:ring-[#5b9cf6]"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-white/80">Password</Label>
                    <Link to="/forgot-password" className="text-xs text-[#7fb3ff] hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 pr-14 bg-white/5 border-white/15 text-white placeholder:text-white/30 focus-visible:ring-[#5b9cf6]"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/50 hover:text-white/80"
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full h-11 font-medium bg-white text-[#0a1530] hover:bg-white/90"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Logging in...
                    </>
                  ) : (
                    "Log in"
                  )}
                </Button>
              </form>

              <p className="text-center text-sm text-white/50 mt-5">
                Don't have an account?{" "}
                <Link
                  to={"/register" + (returnTo !== "/" ? "?returnTo=" + encodeURIComponent(returnTo) : "")}
                  className="text-[#7fb3ff] font-medium hover:underline"
                >
                  Create one
                </Link>
              </p>
            </div>

            <p className="text-center text-xs text-white/30 mt-4">
              Protected by encryption · GDPR · EU AMLD compliant
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}