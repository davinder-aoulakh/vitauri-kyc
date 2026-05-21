import { useEffect, useRef, useState } from 'react';

/**
 * Debounced auto-save hook.
 *
 * @param {any}      data       - Value to watch. When it changes, a save is scheduled.
 * @param {Function} saveFn     - Async function that persists the data. Receives current data value.
 * @param {number}   [delay=1500] - Debounce delay in ms.
 * @param {boolean}  [skip=false] - Pass true to disable saving (e.g. while initially loading).
 *
 * @returns {{ autoSaving: boolean, lastSaved: Date|null }}
 */
export function useAutoSave(data, saveFn, delay = 1500, skip = false) {
  const [autoSaving, setAutoSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const timerRef = useRef(null);
  const firstRender = useRef(true);

  useEffect(() => {
    // Skip the initial mount — we don't want to save before any user interaction.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (skip) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      setAutoSaving(true);
      await saveFn(data);
      setAutoSaving(false);
      setLastSaved(new Date());
    }, delay);

    return () => clearTimeout(timerRef.current);
  }, [JSON.stringify(data)]); // eslint-disable-line react-hooks/exhaustive-deps

  return { autoSaving, lastSaved };
}