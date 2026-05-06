/**
 * Screening Vendor Abstraction Layer
 * MVP: Mock stub returning realistic fake data.
 * Production: Replace runScreening() body with live vendor API call.
 */

const PEP_NAMES = [
  { name: 'Former Government Minister', source: 'PEP_List', detail: 'Former Minister of Finance, resigned 2019. Served in government 2014–2019.' },
  { name: 'Municipal Council Member', source: 'PEP_List', detail: 'Active local government official. City council member since 2021.' },
];

const SANCTIONS_NAMES = [
  { name: 'OFAC SDN List Match', source: 'Sanctions_EU', detail: 'Match against OFAC Specially Designated Nationals list. Listed for financial crimes.' },
  { name: 'EU Consolidated Sanctions', source: 'Sanctions_UN', detail: 'Listed on EU consolidated financial sanctions list since 2022.' },
];

const ADVERSE_MEDIA_NAMES = [
  { name: 'Financial Regulator Investigation', source: 'Adverse_Media', detail: 'Subject of investigation by AFM (Netherlands) for suspected market manipulation. Article published 2023.' },
  { name: 'Money Laundering Allegations', source: 'Adverse_Media', detail: 'Multiple news sources report suspected involvement in layering scheme. Case ongoing.' },
  { name: 'Tax Fraud Conviction', source: 'Adverse_Media', detail: 'Convicted of tax fraud in 2020. Sentence of 18 months suspended. Credible source: De Telegraaf.' },
];

function seededRandom(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Run screening for a single entity.
 * @param {{ name: string, dateOfBirth?: string, registrationNumber?: string, country?: string }} entity
 * @returns {Promise<Array<{ hitName: string, source: string, confidenceScore: number, rawDetails: object }>>}
 */
export async function runScreening(entity) {
  // Simulate network delay
  await new Promise(r => setTimeout(r, 400 + Math.random() * 600));

  const seed = entity.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = (offset) => seededRandom(seed + offset);

  const hits = [];

  // PEP check — ~30% chance
  if (rand(1) < 0.3) {
    const pep = PEP_NAMES[Math.floor(rand(2) * PEP_NAMES.length)];
    const dobMatch = entity.dateOfBirth ? rand(3) > 0.5 : false;
    const confidence = Math.round(30 + rand(4) * 55);
    hits.push({
      hitName: pep.name,
      source: pep.source,
      confidenceScore: confidence,
      rawDetails: {
        listed_name: entity.name,
        match_type: 'Name fuzzy match',
        dob_match: dobMatch,
        country_match: rand(5) > 0.4,
        list_entry: pep.detail,
        last_checked: new Date().toISOString(),
      },
    });
  }

  // Sanctions check — ~20% chance
  if (rand(6) < 0.2) {
    const sanc = SANCTIONS_NAMES[Math.floor(rand(7) * SANCTIONS_NAMES.length)];
    const confidence = Math.round(45 + rand(8) * 50);
    hits.push({
      hitName: sanc.name,
      source: sanc.source,
      confidenceScore: confidence,
      rawDetails: {
        listed_name: entity.name,
        match_type: 'Exact name match',
        country_match: true,
        list_entry: sanc.detail,
        last_checked: new Date().toISOString(),
      },
    });
  }

  // Adverse media — ~25% chance
  if (rand(9) < 0.25) {
    const media = ADVERSE_MEDIA_NAMES[Math.floor(rand(10) * ADVERSE_MEDIA_NAMES.length)];
    const confidence = Math.round(40 + rand(11) * 55);
    hits.push({
      hitName: media.name,
      source: media.source,
      confidenceScore: confidence,
      rawDetails: {
        listed_name: entity.name,
        match_type: 'Keyword + name match',
        source_credibility: 'High',
        article_detail: media.detail,
        last_checked: new Date().toISOString(),
      },
    });
  }

  return hits;
}

/**
 * AI triage: generate recommendation + rationale for a hit.
 */
export function triageHit(hit, entity) {
  const score = hit.confidenceScore;
  if (score >= 80) {
    return {
      recommendation: 'Confirmed_Match',
      rationale: `HIGH confidence (${score}%). Name match is strong with corroborating country data. Source credibility is high. This hit warrants close review. Consider escalating to EDR.`,
    };
  }
  if (score >= 50) {
    return {
      recommendation: 'Possible_Match',
      rationale: `MEDIUM confidence (${score}%). Some matching criteria found but not conclusive. Review the raw details carefully. Date of birth or registration number confirmation recommended before discounting.`,
    };
  }
  return {
    recommendation: 'Likely_False_Positive',
    rationale: `LOW confidence (${score}%). Limited matching criteria. Name similarity may be coincidental. Consider discounting with written justification after reviewing details.`,
  };
}