import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import {
  startActivityTracking,
  stopActivityTracking,
  isSessionExpired,
  isSessionAboutToExpire,
  clearSession,
} from '@/lib/sessionManager';

/**
 * Mounts invisibly in AppShell. Polls every 30s:
 * - If expired → logs out
 * - If about to expire (< 5 min) → shows toast once per window
 */
export default function SessionWatcher() {
  const warnedRef = useRef(false);

  useEffect(() => {
    startActivityTracking();

    const interval = setInterval(() => {
      if (isSessionExpired()) {
        clearSession();
        stopActivityTracking();
        toast.error('Your session has expired. Please sign in again.');
        setTimeout(() => base44.auth.redirectToLogin(window.location.href), 1500);
        clearInterval(interval);
        return;
      }

      if (isSessionAboutToExpire() && !warnedRef.current) {
        warnedRef.current = true;
        toast.warning('Your session will expire in 5 minutes due to inactivity.', {
          duration: 10000,
          action: {
            label: 'Stay signed in',
            onClick: () => {
              // Recording a synthetic activity resets the clock
              import('@/lib/sessionManager').then(m => m.recordActivity());
              warnedRef.current = false;
            },
          },
        });
      }
    }, 30_000);

    return () => {
      stopActivityTracking();
      clearInterval(interval);
    };
  }, []);

  return null;
}