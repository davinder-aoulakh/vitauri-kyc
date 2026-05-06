/**
 * Global network error interceptor.
 * Wraps XHR / fetch calls and surfaces toast notifications with a retry option.
 * Import once in App.jsx — no props needed.
 */
import { useEffect } from 'react';
import { toast } from 'sonner';

export default function NetworkErrorToast() {
  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async (...args) => {
      try {
        const response = await originalFetch(...args);
        // Surface 5xx errors as toasts (4xx are handled per-component)
        if (response.status >= 500) {
          toast.error('Server error. Please try again or contact support.', {
            action: { label: 'Retry', onClick: () => window.fetch(...args) },
            duration: 8000,
          });
        }
        return response;
      } catch (err) {
        // Network-level failure (offline, DNS, etc.)
        if (err.name !== 'AbortError') {
          toast.error('Network error — check your connection.', {
            action: { label: 'Retry', onClick: () => window.fetch(...args) },
            duration: 8000,
            id: 'network-error', // deduplicate
          });
        }
        throw err;
      }
    };

    return () => { window.fetch = originalFetch; };
  }, []);

  return null;
}