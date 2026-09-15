// Shared helpers for the expanded NP name/contact model — keep full_name and
// primary_contact_email/phone in sync with the structured fields.

export function computeFullName(firstNames, lastName) {
  return [firstNames, lastName].filter(v => v && String(v).trim()).join(' ').trim();
}

// Backfill: split an existing single full_name into first_names / last_name.
// Everything before the last space -> first_names, last token -> last_name.
export function splitFullName(fullName) {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return { first_names: '', last_name: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first_names: '', last_name: parts[0] };
  return { first_names: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1] };
}

// Given contact_entries, return the flat mirror fields kept for backward compatibility.
export function syncPreferredContacts(contactEntries) {
  const entries = contactEntries || [];
  const preferredEmail = entries.find(e => e.type === 'email' && e.is_preferred) || entries.find(e => e.type === 'email');
  const preferredPhone = entries.find(e => (e.type === 'phone' || e.type === 'mobile') && e.is_preferred) || entries.find(e => e.type === 'phone' || e.type === 'mobile');
  return {
    primary_contact_email: preferredEmail?.value || '',
    primary_contact_phone: preferredPhone?.value || '',
  };
}

// Ensure only one entry per type is marked preferred.
export function setPreferredEntry(entries, index, type) {
  return (entries || []).map((e, i) => {
    if (e.type !== type) return e;
    return { ...e, is_preferred: i === index };
  });
}

// Get a value from an object using a possible "parent.child" dot path.
export function getNestedValue(obj, path) {
  if (!path?.includes('.')) return obj?.[path];
  const [parent, child] = path.split('.');
  return obj?.[parent]?.[child];
}

// Build a Client.update payload for a field key that may be a "parent.child" dot path.
export function buildFieldUpdatePayload(client, fieldKey, value) {
  if (!fieldKey?.includes('.')) return { [fieldKey]: value };
  const [parent, child] = fieldKey.split('.');
  return { [parent]: { ...(client?.[parent] || {}), [child]: value } };
}