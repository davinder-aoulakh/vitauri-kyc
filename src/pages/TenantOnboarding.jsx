import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Shield, CheckCircle, AlertTriangle, Loader2, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Public onboarding page — /onboard/:token
 * The invited Tenant Admin lands here after accepting their platform invite.
 * We validate the token, link their account to the correct tenant,
 * grant Tenant Admin role, then redirect them into the app.
 */
export default function TenantOnboarding() {
  const token = window.location.pathname.split('/onboard/')[1]?.split('?')[0];

  const [phase, setPhase] = useState('checking'); // checking | needs_login | linking | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const [tenantName, setTenantName] = useState('');

  useEffect(() => {
    if (!token) { setPhase('error'); setErrorMsg('Invalid onboarding link.'); return; }
    run();
  }, []);

  async function run() {
    try {
      // 1. Check if the user is logged in
      let user = null;
      try { user = await base44.auth.me(); } catch { /* not logged in */ }

      if (!user) {
        // Not logged in — ask them to sign in first, then we'll redirect back
        setPhase('needs_login');
        return;
      }

      setPhase('linking');

      // 2. Find the tenant with this token (service role — user may not have a tenant yet)
      const matches = await base44.asServiceRole.entities.Tenant.filter({ onboarding_token: token });

      if (!matches || matches.length === 0) {
        setPhase('error');
        setErrorMsg('This onboarding link is invalid or has already been used.');
        return;
      }

      const tenant = matches[0];
      setTenantName(tenant.name);

      // 3. Check expiry
      if (tenant.onboarding_token_expires_at && new Date(tenant.onboarding_token_expires_at) < new Date()) {
        setPhase('error');
        setErrorMsg('This onboarding link has expired. Please ask your Vitauri Ops administrator to resend it.');
        return;
      }

      // 4. Link the user to this tenant
      await base44.auth.updateMe({
        tenant_id: tenant.id,
        app_role: 'Tenant Admin',
      });

      // 5. Consume the token (single-use) and clear pending admin email
      await base44.asServiceRole.entities.Tenant.update(tenant.id, {
        onboarding_token: '',
        onboarding_token_expires_at: null,
        pending_admin_email: '',
      });

      setPhase('success');

      // 6. Redirect into the app after a short delay
      setTimeout(() => { window.location.href = '/'; }, 2500);

    } catch (e) {
      setPhase('error');
      setErrorMsg(e.message || 'Something went wrong. Please try again or contact support.');
    }
  }

  function redirectToLogin() {
    base44.auth.redirectToLogin(window.location.href);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-8 max-w-md w-full text-center space-y-4">

        {/* Logo / Brand */}
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg text-foreground">Vitauri KYC</span>
        </div>

        {/* checking */}
        {phase === 'checking' && (
          <>
            <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground">Validating your onboarding link…</p>
          </>
        )}

        {/* needs_login */}
        {phase === 'needs_login' && (
          <>
            <LogIn className="w-10 h-10 text-primary mx-auto" />
            <h1 className="text-xl font-bold">Sign in to continue</h1>
            <p className="text-sm text-muted-foreground">
              You need to be signed in to complete your account setup. After signing in you'll be returned here automatically.
            </p>
            <Button className="w-full gap-2" onClick={redirectToLogin}>
              <LogIn className="w-4 h-4" /> Sign In
            </Button>
          </>
        )}

        {/* linking */}
        {phase === 'linking' && (
          <>
            <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
            <h1 className="text-xl font-bold">Setting up your account…</h1>
            <p className="text-sm text-muted-foreground">Linking your account to your institution. This only takes a moment.</p>
          </>
        )}

        {/* success */}
        {phase === 'success' && (
          <>
            <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto" />
            <h1 className="text-xl font-bold text-emerald-700">You're all set!</h1>
            <p className="text-sm text-muted-foreground">
              Your account has been linked to <strong>{tenantName}</strong> as <strong>Tenant Admin</strong>. Redirecting you to the dashboard…
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Redirecting…
            </div>
          </>
        )}

        {/* error */}
        {phase === 'error' && (
          <>
            <AlertTriangle className="w-10 h-10 text-red-500 mx-auto" />
            <h1 className="text-xl font-bold text-red-700">Onboarding Failed</h1>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <Button variant="outline" className="w-full" onClick={() => window.location.href = '/'}>
              Go to Dashboard
            </Button>
          </>
        )}
      </div>
    </div>
  );
}