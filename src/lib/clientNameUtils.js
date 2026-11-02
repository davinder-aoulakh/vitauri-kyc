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
  // Phone / email also update the preferred entry in contact_entries (the editable contact list)
  if (fieldKey === 'primary_contact_phone' || fieldKey === 'primary_contact_email') {
    const isPhone = fieldKey === 'primary_contact_phone';
    const matches = (e) => (isPhone ? e.type === 'phone' || e.type === 'mobile' : e.type === 'email');
    const entries = [...(client?.contact_entries || [])];
    const idx = entries.findIndex((e) => matches(e) && e.is_preferred);
    const at = idx >= 0 ? idx : entries.findIndex(matches);
    if (at >= 0) entries[at] = { ...entries[at], value };
    else entries.push({ type: isPhone ? 'phone' : 'email', value, is_preferred: true });
    return { [fieldKey]: value, contact_entries: entries };
  }
  if (!fieldKey?.includes('.')) return { [fieldKey]: value };
  const [parent, child] = fieldKey.split('.');
  return { [parent]: { ...(client?.[parent] || {}), [child]: value } };
}