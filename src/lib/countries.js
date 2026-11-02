export const COUNTRIES = [
  'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda',
  'Argentina','Armenia','Australia','Austria','Azerbaijan','Bahamas','Bahrain',
  'Bangladesh','Barbados','Belarus','Belgium','Belize','Benin','Bhutan','Bolivia',
  'Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso',
  'Burundi','Cabo Verde','Cambodia','Cameroon','Canada','Central African Republic',
  'Chad','Chile','China','Colombia','Comoros','Congo (Democratic Republic)',
  'Congo (Republic)','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic',
  'Denmark','Djibouti','Dominica','Dominican Republic','Ecuador','Egypt',
  'El Salvador','Equatorial Guinea','Eritrea','Estonia','Eswatini','Ethiopia',
  'Fiji','Finland','France','Gabon','Gambia','Georgia','Germany','Ghana','Greece',
  'Grenada','Guatemala','Guinea','Guinea-Bissau','Guyana','Haiti','Honduras',
  'Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy',
  'Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kiribati','Kosovo','Kuwait',
  'Kyrgyzstan','Laos','Latvia','Lebanon','Lesotho','Liberia','Libya',
  'Liechtenstein','Lithuania','Luxembourg','Madagascar','Malawi','Malaysia',
  'Maldives','Mali','Malta','Marshall Islands','Mauritania','Mauritius','Mexico',
  'Micronesia','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique',
  'Myanmar','Namibia','Nauru','Nepal','Netherlands','New Zealand','Nicaragua',
  'Niger','Nigeria','North Korea','North Macedonia','Norway','Oman','Pakistan',
  'Palau','Palestine','Panama','Papua New Guinea','Paraguay','Peru','Philippines',
  'Poland','Portugal','Qatar','Romania','Russia','Rwanda',
  'Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines',
  'Samoa','San Marino','Sao Tome and Principe','Saudi Arabia','Senegal','Serbia',
  'Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Solomon Islands',
  'Somalia','South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan',
  'Suriname','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania',
  'Thailand','Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia',
  'Turkey','Turkmenistan','Tuvalu','Uganda','Ukraine','United Arab Emirates',
  'United Kingdom','United States','Uruguay','Uzbekistan','Vanuatu',
  'Vatican City','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe','Other'
];

// ISO 3166-1 alpha-2 code and international dialling code per country name in COUNTRIES.
// "name:ISO2:dial" — compact so the table stays readable.
const META = `Afghanistan:AF:93|Albania:AL:355|Algeria:DZ:213|Andorra:AD:376|Angola:AO:244|Antigua and Barbuda:AG:1268|
Argentina:AR:54|Armenia:AM:374|Australia:AU:61|Austria:AT:43|Azerbaijan:AZ:994|Bahamas:BS:1242|Bahrain:BH:973|
Bangladesh:BD:880|Barbados:BB:1246|Belarus:BY:375|Belgium:BE:32|Belize:BZ:501|Benin:BJ:229|Bhutan:BT:975|Bolivia:BO:591|
Bosnia and Herzegovina:BA:387|Botswana:BW:267|Brazil:BR:55|Brunei:BN:673|Bulgaria:BG:359|Burkina Faso:BF:226|
Burundi:BI:257|Cabo Verde:CV:238|Cambodia:KH:855|Cameroon:CM:237|Canada:CA:1|Central African Republic:CF:236|
Chad:TD:235|Chile:CL:56|China:CN:86|Colombia:CO:57|Comoros:KM:269|Congo (Democratic Republic):CD:243|
Congo (Republic):CG:242|Costa Rica:CR:506|Croatia:HR:385|Cuba:CU:53|Cyprus:CY:357|Czech Republic:CZ:420|
Denmark:DK:45|Djibouti:DJ:253|Dominica:DM:1767|Dominican Republic:DO:1809|Ecuador:EC:593|Egypt:EG:20|
El Salvador:SV:503|Equatorial Guinea:GQ:240|Eritrea:ER:291|Estonia:EE:372|Eswatini:SZ:268|Ethiopia:ET:251|
Fiji:FJ:679|Finland:FI:358|France:FR:33|Gabon:GA:241|Gambia:GM:220|Georgia:GE:995|Germany:DE:49|Ghana:GH:233|Greece:GR:30|
Grenada:GD:1473|Guatemala:GT:502|Guinea:GN:224|Guinea-Bissau:GW:245|Guyana:GY:592|Haiti:HT:509|Honduras:HN:504|
Hungary:HU:36|Iceland:IS:354|India:IN:91|Indonesia:ID:62|Iran:IR:98|Iraq:IQ:964|Ireland:IE:353|Israel:IL:972|Italy:IT:39|
Jamaica:JM:1876|Japan:JP:81|Jordan:JO:962|Kazakhstan:KZ:7|Kenya:KE:254|Kiribati:KI:686|Kosovo:XK:383|Kuwait:KW:965|
Kyrgyzstan:KG:996|Laos:LA:856|Latvia:LV:371|Lebanon:LB:961|Lesotho:LS:266|Liberia:LR:231|Libya:LY:218|
Liechtenstein:LI:423|Lithuania:LT:370|Luxembourg:LU:352|Madagascar:MG:261|Malawi:MW:265|Malaysia:MY:60|
Maldives:MV:960|Mali:ML:223|Malta:MT:356|Marshall Islands:MH:692|Mauritania:MR:222|Mauritius:MU:230|Mexico:MX:52|
Micronesia:FM:691|Moldova:MD:373|Monaco:MC:377|Mongolia:MN:976|Montenegro:ME:382|Morocco:MA:212|Mozambique:MZ:258|
Myanmar:MM:95|Namibia:NA:264|Nauru:NR:674|Nepal:NP:977|Netherlands:NL:31|New Zealand:NZ:64|Nicaragua:NI:505|
Niger:NE:227|Nigeria:NG:234|North Korea:KP:850|North Macedonia:MK:389|Norway:NO:47|Oman:OM:968|Pakistan:PK:92|
Palau:PW:680|Palestine:PS:970|Panama:PA:507|Papua New Guinea:PG:675|Paraguay:PY:595|Peru:PE:51|Philippines:PH:63|
Poland:PL:48|Portugal:PT:351|Qatar:QA:974|Romania:RO:40|Russia:RU:7|Rwanda:RW:250|
Saint Kitts and Nevis:KN:1869|Saint Lucia:LC:1758|Saint Vincent and the Grenadines:VC:1784|
Samoa:WS:685|San Marino:SM:378|Sao Tome and Principe:ST:239|Saudi Arabia:SA:966|Senegal:SN:221|Serbia:RS:381|
Seychelles:SC:248|Sierra Leone:SL:232|Singapore:SG:65|Slovakia:SK:421|Slovenia:SI:386|Solomon Islands:SB:677|
Somalia:SO:252|South Africa:ZA:27|South Korea:KR:82|South Sudan:SS:211|Spain:ES:34|Sri Lanka:LK:94|Sudan:SD:249|
Suriname:SR:597|Sweden:SE:46|Switzerland:CH:41|Syria:SY:963|Taiwan:TW:886|Tajikistan:TJ:992|Tanzania:TZ:255|
Thailand:TH:66|Timor-Leste:TL:670|Togo:TG:228|Tonga:TO:676|Trinidad and Tobago:TT:1868|Tunisia:TN:216|
Turkey:TR:90|Turkmenistan:TM:993|Tuvalu:TV:688|Uganda:UG:256|Ukraine:UA:380|United Arab Emirates:AE:971|
United Kingdom:GB:44|United States:US:1|Uruguay:UY:598|Uzbekistan:UZ:998|Vanuatu:VU:678|
Vatican City:VA:379|Venezuela:VE:58|Vietnam:VN:84|Yemen:YE:967|Zambia:ZM:260|Zimbabwe:ZW:263|
Aruba:AW:297|Curacao:CW:599|Sint Maarten:SX:1721|Bonaire:BQ:599|Hong Kong:HK:852|Gibraltar:GI:350|Jersey:JE:44|Guernsey:GG:44|Isle of Man:IM:44`;

/** [{ name, iso2, dial }] — every COUNTRIES entry plus a few territories clients often have (Aruba, Curaçao…). */
export const COUNTRY_META = META.replace(/\n/g, '').split('|').filter(Boolean).map((row) => {
  const [name, iso2, dial] = row.split(':');
  return { name, iso2, dial: `+${dial}` };
});

const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ALIASES = {
  nederland: 'NL', holland: 'NL', 'the netherlands': 'NL', usa: 'US', 'united states of america': 'US', uk: 'GB',
  'great britain': 'GB', england: 'GB', deutschland: 'DE', belgie: 'BE', duitsland: 'DE', frankrijk: 'FR', curacao: 'CW',
};

/** Country by name, "Netherlands (NL)", ISO2 ("NL") or common alias ("Nederland"). Null when unknown. */
export function countryByName(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const paren = v.match(/\(([A-Za-z]{2})\)\s*$/);
  if (paren) return COUNTRY_META.find((c) => c.iso2 === paren[1].toUpperCase()) || null;
  if (/^[A-Za-z]{2}$/.test(v)) return COUNTRY_META.find((c) => c.iso2 === v.toUpperCase()) || null;
  const n = norm(v);
  if (ALIASES[n]) return COUNTRY_META.find((c) => c.iso2 === ALIASES[n]) || null;
  return COUNTRY_META.find((c) => norm(c.name) === n) || null;
}

// Country shown for a dial code several countries share (+1, +7, +44, +599)
const DIAL_DEFAULT = { '+1': 'US', '+7': 'RU', '+44': 'GB', '+599': 'CW' };

/** The country with the longest dial prefix of a number like "+31647978701". */
export function countryByDial(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) return null;
  let best = null;
  for (const c of COUNTRY_META) {
    if (digits.startsWith(c.dial) && (!best || c.dial.length > best.dial.length)) best = c;
  }
  if (best && DIAL_DEFAULT[best.dial]) best = COUNTRY_META.find((c) => c.iso2 === DIAL_DEFAULT[best.dial]) || best;
  return best;
}

/**
 * Split a stored phone value into { iso2, dial, number }.
 * "+31 647978701" / "+31647978701" / "0031 6…" → NL; "06 47978701" uses the fallback country (national 0 dropped).
 */
export function splitPhone(value, fallbackCountry) {
  let v = String(value || '').trim().replace(/^00/, '+');
  const fallback = countryByName(fallbackCountry) || COUNTRY_META.find((c) => c.iso2 === 'NL');
  if (v.startsWith('+')) {
    const c = countryByDial(v);
    if (c) {
      // Shared codes (+1, +7, +44, +599): keep the fallback's flag when it has the same code
      const pick = fallback && fallback.dial === c.dial ? fallback : c;
      return { iso2: pick.iso2, dial: c.dial, number: v.slice(c.dial.length).replace(/[^\d]/g, '') };
    }
  }
  return { iso2: fallback.iso2, dial: fallback.dial, number: v.replace(/[^\d]/g, '').replace(/^0+/, '') };
}

/** "+31" + "647978701" → "+31 647978701" (empty number → ""). */
export function joinPhone(dial, number) {
  const n = String(number || '').replace(/[^\d]/g, '').replace(/^0+/, '');
  return n ? `${dial} ${n}` : '';
}
