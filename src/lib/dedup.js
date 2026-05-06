/**
 * Client de-duplication utilities.
 * Computes a similarity score (0–100) between a candidate name+country
 * and an existing client record. Threshold ≥ 80 is considered a duplicate.
 */

/** Simple Jaro-Winkler-style bigram similarity (0–1) */
function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;

  const longer  = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;

  // Count matching chars within a window
  const matchDistance = Math.floor(longer.length / 2) - 1;
  const longerMatches  = new Array(longer.length).fill(false);
  const shorterMatches = new Array(shorter.length).fill(false);
  let matches = 0;

  for (let i = 0; i < shorter.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end   = Math.min(i + matchDistance + 1, longer.length);
    for (let j = start; j < end; j++) {
      if (!longerMatches[j] && shorter[i] === longer[j]) {
        longerMatches[j] = shorterMatches[i] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (shorterMatches[i]) {
      while (!longerMatches[k]) k++;
      if (shorter[i] !== longer[k]) transpositions++;
      k++;
    }
  }

  const jaro = (
    matches / shorter.length +
    matches / longer.length +
    (matches - transpositions / 2) / matches
  ) / 3;

  // Winkler prefix bonus
  let prefix = 0;
  for (let i = 0; i < Math.min(4, shorter.length); i++) {
    if (shorter[i] === longer[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Score a candidate (name + country) against an existing client.
 * Returns 0-100.
 */
export function dedupScore(candidateName, candidateCountry, existingClient) {
  const nameScore    = stringSimilarity(candidateName, existingClient.full_name) * 100;
  const country1     = candidateCountry?.toLowerCase().trim() || '';
  const country2     = (existingClient.registered_country || existingClient.nationality || existingClient.country_of_residence || '').toLowerCase().trim();
  const countryMatch = country1 && country2 && (country1 === country2 || country1.includes(country2) || country2.includes(country1));

  // Weighted: name 70%, country 30%
  const countryScore = countryMatch ? 100 : (country1 && country2 ? stringSimilarity(country1, country2) * 100 : 0);
  return Math.round(nameScore * 0.7 + countryScore * 0.3);
}

export const DEDUP_THRESHOLD = 80;

/**
 * Find all duplicates above threshold from a list of existing clients.
 */
export function findDuplicates(name, country, existingClients) {
  return existingClients
    .map(c => ({ client: c, score: dedupScore(name, country, c) }))
    .filter(r => r.score >= DEDUP_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}