/**
 * Shared matching helpers between an OutreachRequest item's label and a
 * structured profile field label — used to keep outreach item status in sync
 * with the Profile Verification step, and to hide field-mapped items from
 * the raw Outreach & Documents item tracker (they're verified in the grid instead).
 */

// Normalise a label for loose matching (case/whitespace/punctuation insensitive)
export function normalizeLabel(label) {
  return (label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// True if this outreach item's label corresponds to a structured profile field.
export function isFieldMappedLabel(itemLabel, fieldLabels) {
  const norm = normalizeLabel(itemLabel);
  if (!norm) return false;
  return Object.values(fieldLabels).some(fieldLabel => {
    const fieldNorm = normalizeLabel(fieldLabel.split('—')[0]); // strip "— Country" etc. suffixes
    return fieldNorm && (norm === fieldNorm || norm.includes(fieldNorm) || fieldNorm.includes(norm));
  });
}