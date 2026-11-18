// Generated from docs/outreach/02-block-library.json and 03-form-templates.json (pack of 8 Nov 2026). Do not edit by hand:
// tests/outreach-seed.test.js checks that this equals the pack files. Used by seedOutreachLibrary (no file access in functions).
export const OUTREACH_BLOCK_LIBRARY = {
 "_readme": "Block library for the Client Outreach module. One entry per Outreach Block (Tenant Config > Outreach Templates). Conditions use the DSL described in the build spec section 5.4. 'question' texts may contain {placeholders}. All text is English; every translatable string needs a translations map (NL to be added).",
 "condition_dsl": {
  "answer_includes": {
   "block": "id",
   "value": "option"
  },
  "answer_equals": {
   "block": "id",
   "value": "option"
  },
  "risk_in": [
   "low",
   "medium",
   "high"
  ],
  "legal_form_kind": "company|partnership|sole",
  "route": "nl|document",
  "document_check_failed": "check name",
  "calculated": "named calculation",
  "all": "[conditions]",
  "any": "[conditions]",
  "not": "condition"
 },
 "datapoint_sources": {
  "idv": "Didit ID check",
  "client": "Declared by client",
  "ai": "Declared by client, AI follow-up",
  "doc": "From document",
  "pre": "Prefilled from invitation",
  "kvk": "KvK trade register",
  "prop": "Suggested from registry data, confirmed by client",
  "calc": "Calculated by the tool",
  "rep": "Declared by the representative"
 },
 "np_blocks": [
  {
   "id": "idv",
   "section": "id",
   "label": "Identity verification (ID&V)",
   "widget": "idv",
   "question": "First, your identity. After that you do not have to type your name, date of birth or nationality.",
   "why": "This is how we make sure it is really you. Your ID also fills in your name, date of birth and nationality for you.",
   "datapoints": [
    {
     "key": "full_name",
     "label": "Full name",
     "type": "text",
     "default_source": "idv"
    },
    {
     "key": "dob",
     "label": "Date of birth",
     "type": "date",
     "default_source": "idv"
    },
    {
     "key": "nat",
     "label": "Nationality",
     "type": "text",
     "default_source": "idv"
    },
    {
     "key": "doc",
     "label": "Identity document",
     "type": "text",
     "default_source": "idv"
    }
   ],
   "kyc_mapping": "ID document, full name, date of birth, nationality",
   "evidence": "Is itself the evidence",
   "provider": "Didit (ID&V session). Wide screen: QR code that opens the session on the phone. Phone-sized screen: button that opens the session on the same device. Result arrives by webhook; the conversation continues on its own.",
   "on_decline": "Reply \"No problem. Without verification we cannot complete the application, but you can continue later with the same link. Would you like to try now?\" and ask again. Log block.declined.",
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "name_confirm",
   "section": "id",
   "label": "Confirm identity data",
   "widget": "confirm_facts",
   "question": "This is what we read from your identity document. Is it correct?",
   "why": "You do not have to type anything. You only confirm that what we read from your document is correct.",
   "options": [
    "Yes, this is correct",
    "Something is wrong"
   ],
   "show_if": "after idv",
   "follow_ups": [
    {
     "id": "dispute",
     "when": {
      "answer_equals": {
       "block": "name_confirm",
       "value": "Something is wrong"
      }
     },
     "action": "ask_text",
     "question": "What is wrong? A colleague will take a look.",
     "key": "id_dispute",
     "label": "Remark on ID data",
     "then_message": "Thank you. We have noted this and a colleague will look into it. You can simply continue.",
     "flag": "case flagged for analyst"
    }
   ],
   "datapoints": [
    {
     "key": "id_dispute",
     "label": "Remark on ID data",
     "type": "text",
     "default_source": "client"
    }
   ],
   "kyc_mapping": "-",
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "address",
   "section": "id",
   "label": "Residential address",
   "widget": "address",
   "question": "Where do you live?",
   "why": "We are legally required to know where you live.",
   "fields": [
    "country (United Kingdom, Netherlands, Ireland, Other country)",
    "postcode",
    "house number",
    "street",
    "city"
   ],
   "behaviour": "On blur of postcode and house number, look up street and city (address lookup service, simulated in the prototype). Fields stay editable. All fields required.",
   "datapoints": [
    {
     "key": "address",
     "label": "Residential address",
     "type": "text",
     "default_source": "client"
    }
   ],
   "kyc_mapping": "Residential address",
   "edit": {
    "type": "text"
   },
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "address_proof",
   "section": "id",
   "label": "Proof of address",
   "widget": "upload",
   "question": "Do you have a recent proof of this address, for example a utility bill or bank statement? Maximum 3 months old.",
   "why": "A recent bill or statement shows that this address is yours.",
   "document_checks": [
    "Readable and complete",
    "Name matches your ID",
    "Address matches what you entered",
    "Not older than 3 months"
   ],
   "follow_ups": [
    {
     "id": "name_mismatch",
     "when": {
      "document_check_failed": "Name matches your ID"
     },
     "action": "re_request",
     "message": "This looks like a document in another name. Do you have a document in your own name, for example a bank statement?",
     "tag": "Document checked"
    }
   ],
   "allow_defer": false,
   "datapoints": [
    {
     "key": "address_proof",
     "label": "Proof of address",
     "type": "file",
     "default_source": "doc"
    }
   ],
   "kyc_mapping": "Residential address (evidence)",
   "evidence": "Utility bill, bank statement or municipal extract, max 3 months",
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "email",
   "section": "contact",
   "label": "Email address",
   "widget": "confirm_or_text",
   "question": "We used {invitation_email} for your invitation. Is that email address still correct?",
   "why": "We send updates about your application here.",
   "options": [
    "Yes, that is correct",
    "Different email address"
   ],
   "follow_ups": [
    {
     "id": "other_email",
     "when": {
      "answer_equals": {
       "block": "email",
       "value": "Different email address"
      }
     },
     "action": "ask_text",
     "question": "Which email address would you like to use?",
     "key": "email",
     "validate": "email format",
     "message_on_invalid": "This email address does not look right."
    }
   ],
   "prefill": "invitation.email (source: Prefilled from invitation)",
   "datapoints": [
    {
     "key": "email",
     "label": "Email address",
     "type": "text",
     "default_source": "pre"
    }
   ],
   "kyc_mapping": "Email address",
   "edit": {
    "type": "text"
   },
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "phone",
   "section": "contact",
   "label": "Phone number",
   "widget": "phone",
   "question": "What is your phone number?",
   "why": "In case we need to reach you quickly.",
   "fields": [
    "country code (+44, +31, +353, +49, +1)",
    "number"
   ],
   "validation": "At least 8 digits. Error: \"This number looks too short. Enter it without the leading 0.\"",
   "datapoints": [
    {
     "key": "phone",
     "label": "Phone number",
     "type": "text",
     "default_source": "client"
    }
   ],
   "kyc_mapping": "Phone number",
   "edit": {
    "type": "text"
   },
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "purpose",
   "section": "rel",
   "label": "Purpose of the relationship",
   "widget": "multi",
   "question": "Why would you like to become a customer of New Age Bank? Choose what applies.",
   "why": "Banks need to know what you will use the account for, so they can spot unusual transactions.",
   "options": [
    "Everyday payments",
    "Saving",
    "Receiving salary",
    "Mortgage or loan",
    "Investing",
    "Other"
   ],
   "follow_ups": [
    {
     "id": "other",
     "when": {
      "answer_includes": {
       "block": "purpose",
       "value": "Other"
      }
     },
     "action": "ask_text",
     "question": "Could you briefly describe what you mean by \"other\"?",
     "key": "purpose",
     "merge": "replace \"Other\" by \"Other: <text>\""
    }
   ],
   "datapoints": [
    {
     "key": "purpose",
     "label": "Purpose of the relationship",
     "type": "multi",
     "default_source": "client"
    }
   ],
   "kyc_mapping": "Purpose of relationship",
   "edit": {
    "type": "multi"
   },
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "nature",
   "section": "rel",
   "label": "Nature of the relationship",
   "widget": "multi",
   "question": "Which products and services would you like to use?",
   "why": "This tells us which products fit your situation.",
   "options": [
    "Current account",
    "Savings account",
    "Debit card",
    "Credit card",
    "International payments",
    "Other"
   ],
   "datapoints": [
    {
     "key": "nature",
     "label": "Products and services",
     "type": "multi",
     "default_source": "client"
    }
   ],
   "kyc_mapping": "Products and services",
   "edit": {
    "type": "multi"
   },
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "employment",
   "section": "fin",
   "label": "Employment status",
   "widget": "chips",
   "question": "What is your work situation?",
   "why": "Your work situation helps us understand your income.",
   "options": [
    "Employed",
    "Self-employed",
    "Retired",
    "Student",
    "Not working",
    "Other"
   ],
   "follow_ups": [
    {
     "id": "company",
     "when": {
      "answer_equals": {
       "block": "employment",
       "value": "Self-employed"
      }
     },
     "action": "ask_text",
     "question": "What is the name of your company?",
     "key": "company",
     "label": "Company name"
    }
   ],
   "datapoints": [
    {
     "key": "employment",
     "label": "Work situation",
     "type": "chips",
     "default_source": "client"
    },
    {
     "key": "company",
     "label": "Company name",
     "type": "text",
     "default_source": "client"
    }
   ],
   "kyc_mapping": "Employment status",
   "edit": {
    "type": "chips"
   },
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "income",
   "section": "fin",
   "label": "Income range",
   "widget": "chips",
   "question": "Roughly what is your gross annual income?",
   "why": "We ask for a range, not an exact amount.",
   "options": [
    "Under € 25,000",
    "€ 25,000 to € 50,000",
    "€ 50,000 to € 100,000",
    "€ 100,000 to € 250,000",
    "Over € 250,000"
   ],
   "datapoints": [
    {
     "key": "income",
     "label": "Annual income",
     "type": "chips",
     "default_source": "client"
    }
   ],
   "kyc_mapping": "Annual income range",
   "edit": {
    "type": "chips"
   },
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "sof",
   "section": "fin",
   "label": "Source of funds",
   "widget": "multi",
   "question": "Where does the money come from that you will put into your account?",
   "why": "We need to know where the money you put into your account comes from.",
   "options": [
    "Salary",
    "Own business",
    "Savings",
    "Sale of property",
    "Inheritance or gift",
    "Investments",
    "Benefits or pension",
    "Other"
   ],
   "follow_ups": [
    {
     "id": "deed",
     "when": {
      "any": [
       {
        "answer_includes": {
         "block": "sof",
         "value": "Inheritance or gift"
        }
       },
       {
        "answer_includes": {
         "block": "sof",
         "value": "Sale of property"
        }
       }
      ]
     },
     "action": "ask_file",
     "question": "Do you have a document that supports this, such as a notarial deed or certificate of inheritance?",
     "key": "sof_doc",
     "label": "Evidence of source of funds",
     "allow_defer": true,
     "defer_creates_open_request": true,
     "document_checks": [
      "Readable and complete",
      "Document is a deed or certificate",
      "Amount and date visible"
     ]
    },
    {
     "id": "payslip",
     "when": {
      "all": [
       {
        "risk_in": [
         "high"
        ]
       },
       {
        "answer_includes": {
         "block": "sof",
         "value": "Salary"
        }
       }
      ]
     },
     "action": "ask_file",
     "question": "Because we take extra care here: could you upload your latest payslip?",
     "key": "payslip",
     "label": "Payslip",
     "allow_defer": false,
     "document_checks": [
      "Readable and complete",
      "Employer and name visible",
      "Not older than 3 months"
     ]
    },
    {
     "id": "other",
     "when": {
      "answer_includes": {
       "block": "sof",
       "value": "Other"
      }
     },
     "action": "ai_followup",
     "question": "You chose \"other\" for the source of your money. Could you say what the source is, and the amount and period involved?",
     "key": "sof_other",
     "label": "Explanation of source (other)"
    }
   ],
   "datapoints": [
    {
     "key": "sof",
     "label": "Source of funds",
     "type": "multi",
     "default_source": "client"
    },
    {
     "key": "sof_doc",
     "label": "Evidence of source of funds",
     "type": "file",
     "default_source": "doc"
    },
    {
     "key": "payslip",
     "label": "Payslip",
     "type": "file",
     "default_source": "doc"
    },
    {
     "key": "sof_other",
     "label": "Explanation of source (other)",
     "type": "text",
     "default_source": "ai"
    }
   ],
   "kyc_mapping": "Source of funds",
   "edit": {
    "type": "multi"
   },
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "activities",
   "section": "act",
   "label": "Expected activities",
   "widget": "multi",
   "question": "Do you expect to use New Age Bank for any of these activities? Choose everything that applies.",
   "why": "This helps us monitor your account properly without blocking it unnecessarily.",
   "options": [
    "Crypto",
    "Real estate",
    "Cash deposits",
    "Gambling",
    "Payments within the EU",
    "Payments outside the EU",
    "Frequent transactions above € 15,000",
    "Adult industry",
    "Drugs related",
    "None of these"
   ],
   "none_option": "None of these",
   "follow_ups": [
    {
     "id": "countries",
     "when": {
      "answer_includes": {
       "block": "activities",
       "value": "Payments outside the EU"
      }
     },
     "action": "ask_text",
     "question": "To or from which countries outside the EU do you expect payments?",
     "key": "countries",
     "label": "Countries outside the EU"
    },
    {
     "id": "cash",
     "when": {
      "answer_includes": {
       "block": "activities",
       "value": "Cash deposits"
      }
     },
     "action": "ai_followup",
     "question": "You expect to deposit cash. Roughly what amount per month, and why in cash?",
     "key": "cash_reason",
     "label": "Explanation of cash deposits"
    },
    {
     "id": "crypto",
     "when": {
      "answer_includes": {
       "block": "activities",
       "value": "Crypto"
      }
     },
     "action": "ai_followup",
     "question": "You mention crypto. Via which platforms and for what purpose?",
     "key": "crypto_reason",
     "label": "Explanation of crypto use"
    }
   ],
   "datapoints": [
    {
     "key": "activities",
     "label": "Expected activities",
     "type": "multi",
     "default_source": "client"
    },
    {
     "key": "countries",
     "label": "Countries outside the EU",
     "type": "text",
     "default_source": "client"
    },
    {
     "key": "cash_reason",
     "label": "Explanation of cash deposits",
     "type": "text",
     "default_source": "ai"
    },
    {
     "key": "crypto_reason",
     "label": "Explanation of crypto use",
     "type": "text",
     "default_source": "ai"
    }
   ],
   "kyc_mapping": "Expected activities, risk indicators",
   "edit": {
    "type": "multi",
    "none": "None of these"
   },
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "pep",
   "section": "act",
   "label": "Politically exposed person",
   "widget": "chips",
   "question": "Are you, or is someone close to you, a politically exposed person (PEP)? Think of a minister, member of parliament, judge at a high court or ambassador, and their family or close associates.",
   "why": "By law, people in senior public roles and their close associates carry a higher risk. That does not mean it is not allowed.",
   "options": [
    "No",
    "Yes",
    "I don't know"
   ],
   "follow_ups": [
    {
     "id": "unsure",
     "when": {
      "answer_equals": {
       "block": "pep",
       "value": "I don't know"
      }
     },
     "action": "explain_and_reask",
     "message": "No worries. It concerns people with an important public function in the last 12 months, their partner, children and parents, and their close business associates. Does that apply to you or someone close to you?",
     "tag": "Explanation"
    },
    {
     "id": "yes_who",
     "when": {
      "answer_equals": {
       "block": "pep",
       "value": "Yes"
      }
     },
     "action": "ask_text",
     "question": "Who is this and what position does or did that person hold?",
     "key": "pep_detail_who"
    },
    {
     "id": "yes_rel",
     "when": {
      "answer_equals": {
       "block": "pep",
       "value": "Yes"
      }
     },
     "action": "ask_choice",
     "question": "What is your relationship to this person?",
     "options": [
      "Myself",
      "Partner or child",
      "Parent or sibling",
      "Close business associate"
     ],
     "key": "pep_detail_rel",
     "combine_into": "pep_detail"
    }
   ],
   "datapoints": [
    {
     "key": "pep",
     "label": "PEP declaration",
     "type": "chips",
     "default_source": "client"
    },
    {
     "key": "pep_detail",
     "label": "PEP details",
     "type": "text",
     "default_source": "client"
    }
   ],
   "kyc_mapping": "PEP self-declaration",
   "evidence": "Compared with the screening result when it arrives",
   "edit": {
    "type": "chips",
    "options": [
     "No",
     "Yes"
    ]
   },
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "review",
   "section": "decl",
   "label": "Review of all answers",
   "widget": "review",
   "question": "Almost done. Here is everything once more. Change anything that is not right before you declare it.",
   "why": "You see everything once more before you declare it.",
   "behaviour": "Answers grouped (Identity, Contact, Purpose of relationship, Financial, Expected activity). Each row shows value and source label. Rows with an edit definition get a Change link that reopens the input inline. Saving an edit sets source to \"Declared by client\", logs answer.edited and keeps the previous value in history. Button: \"Everything is correct, continue to sign\".",
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "sign",
   "section": "decl",
   "label": "Terms and signed declaration",
   "widget": "sign",
   "question": "Last step: the terms and your declaration.",
   "why": "By signing you declare that the information is true.",
   "declaration": "I declare that the information above is true to the best of my knowledge.",
   "behaviour": "Checkbox terms + privacy notice; typed full name must equal the name from ID&V (case-insensitive), else block with \"The name does not match your ID ({name}). Type your name as it appears on your ID.\" and log rule; signature canvas (pointer events, touch supported); submit disabled until all three are done.",
   "datapoints": [
    {
     "key": "declaration",
     "label": "Declaration and signature",
     "type": "text",
     "default_source": "client"
    }
   ],
   "kyc_mapping": "Declaration, signature",
   "evidence": "Signature image + timestamp + IP + version hash",
   "client_types": [
    "NP"
   ],
   "active_default": true,
   "version": 1
  }
 ],
 "org_blocks": [
  {
   "id": "country",
   "section": "org",
   "label": "Country of registration",
   "widget": "chips",
   "question": "Where is your organisation registered?",
   "why": "The way we check your organisation depends on where it is registered.",
   "options": [
    "Netherlands",
    "Curaçao",
    "Other country"
   ],
   "routing": {
    "Netherlands": "route=nl (KvK)",
    "Curaçao": "route=document",
    "Other country": "route=document, then ask \"Which country?\" (free text)"
   },
   "follow_ups": [
    {
     "id": "which",
     "when": {
      "answer_equals": {
       "block": "country",
       "value": "Other country"
      }
     },
     "action": "ask_text",
     "question": "Which country?",
     "key": "country"
    }
   ],
   "datapoints": [
    {
     "key": "country",
     "label": "Country of registration",
     "type": "text",
     "default_source": "rep"
    }
   ],
   "kyc_mapping": "Jurisdiction (selects the route)",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "registry",
   "section": "org",
   "label": "Find and confirm the organisation",
   "widget": "registry_lookup_or_document",
   "why": "We check your organisation against the official register or your documents, so you do not have to type its details.",
   "route_nl": {
    "question": "What is the name of your organisation? Start typing and pick it from the list.",
    "search": "KvK Zoeken (typeahead, min. 2 characters, matches name or KvK number)",
    "not_found_button": "I cannot find my organisation → falls back to the document route",
    "confirm": {
     "question": "Is this your organisation? This is what the register shows.",
     "options": [
      "Yes, this is my organisation",
      "No, search again"
     ],
     "note": "Source: Dutch trade register (KvK)."
    },
    "stop_rule": "Status not starting with \"Active\": say \"The trade register lists {name} as {status}. We cannot open an account for an inactive organisation. Please pick another organisation, or contact your relationship manager.\" and ask again",
    "calls": "Basisprofiel for the selected KvK number (EUR 0.02)"
   },
   "route_document": {
    "intro": "For an organisation registered in {country} we work from your documents. We start with the extract of the trade register (Chamber of Commerce). It must not be older than 3 months.",
    "steps": [
     {
      "ask": "Please upload the extract of the trade register.",
      "document_checks": [
       "Readable and complete",
       "Issued by a trade register or Chamber of Commerce",
       "Not older than 3 months"
      ],
      "on_fail": "This document does not pass our check. Please upload a current version.",
      "required": true
     },
     {
      "ai_read": "AI reads name, registration number, legal form, address, activity, registration date and listed officers from the extract.",
      "confirm": {
       "question": "We read your extract. Is this correct?",
       "tag": "Read from your document",
       "ai_label": true,
       "options": [
        "Yes, this is correct",
        "Something is wrong"
       ],
       "note": "Read from your document. A colleague checks it against the original."
      },
      "on_wrong": "Form to correct name, registration number, legal form and address; source becomes \"Declared by the representative\""
     },
     {
      "ask": "Please upload your articles of association.",
      "document_checks": [
       "Readable and complete",
       "Company name matches the extract",
       "Signed and dated"
      ],
      "required": true
     }
    ]
   },
   "datapoints": [
    {
     "key": "legal_name",
     "label": "Legal name",
     "type": "text",
     "default_source": "kvk|doc"
    },
    {
     "key": "reg_no",
     "label": "Registration number",
     "type": "text",
     "default_source": "kvk|doc"
    },
    {
     "key": "rsin",
     "label": "RSIN (NL only)",
     "type": "text",
     "default_source": "kvk"
    },
    {
     "key": "legal_form",
     "label": "Legal form",
     "type": "text",
     "default_source": "kvk|doc"
    },
    {
     "key": "co_status",
     "label": "Status",
     "type": "text",
     "default_source": "kvk|doc"
    },
    {
     "key": "co_address",
     "label": "Registered address",
     "type": "text",
     "default_source": "kvk|doc"
    },
    {
     "key": "sbi",
     "label": "Main activity (SBI, NL)",
     "type": "text",
     "default_source": "kvk"
    },
    {
     "key": "co_activity",
     "label": "Activity (document route)",
     "type": "text",
     "default_source": "doc"
    },
    {
     "key": "reg_date",
     "label": "Registered since",
     "type": "text",
     "default_source": "kvk|doc"
    },
    {
     "key": "trade_name",
     "label": "Trade name (NL)",
     "type": "text",
     "default_source": "kvk"
    },
    {
     "key": "doc_extract",
     "label": "Document: extract of the trade register",
     "type": "file",
     "default_source": "doc"
    },
    {
     "key": "doc_articles",
     "label": "Document: articles of association",
     "type": "file",
     "default_source": "doc"
    }
   ],
   "kyc_mapping": "Legal name, registration number, legal form, status, address, activity, registration date",
   "evidence": "Document route: extract (max 3 months) and articles, both required",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "directors",
   "section": "own",
   "label": "Directors and representatives",
   "widget": "people_list",
   "question_nl": "From registry data we suggest these directors. The trade register does not list everyone, so untick anyone who is not correct and add anyone who is missing.",
   "question_document": "Your extract lists these people. Untick anyone who is not correct and add anyone who is missing.",
   "question_empty": "Who are the directors or managing officers of your organisation? Add everyone who may act for it.",
   "why": "We need to know who runs the organisation and who may sign for it.",
   "behaviour": "Each suggested person is a row with checkbox (default ticked), name, role, authority text (for example \"May sign alone\") and source pill. \"Add person\": name + role (default Director). At least one person must remain. NL proposal comes from the second source (the KvK API returns no directors). Document route: officers read from the extract.",
   "datapoints": [
    {
     "key": "directors",
     "label": "Directors and representatives",
     "type": "list",
     "default_source": "prop|doc|rep"
    }
   ],
   "kyc_mapping": "Directors, authorised representatives, signing authority",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "authreps",
   "section": "own",
   "label": "Authorised representatives",
   "widget": "chips + people_with_authority + upload",
   "question": "Besides the directors: does anyone else act for the organisation, for example an employee with a power of attorney?",
   "options": [
    "Yes, there are others",
    "No, only the directors"
   ],
   "why": "Besides the directors, we need to know who else may act for the organisation.",
   "follow_ups": [
    {
     "id": "who",
     "when": {
      "answer_equals": {
       "block": "authreps",
       "value": "Yes, there are others"
      }
     },
     "action": "ask_people",
     "question": "Who are they, and what may they do on behalf of the organisation?",
     "fields": [
      "name",
      "authority (May sign alone | May sign jointly | Limited authority)",
      "role or limit (free text)"
     ],
     "key": "authreps"
    },
    {
     "id": "poa",
     "when": {
      "answer_equals": {
       "block": "authreps",
       "value": "Yes, there are others"
      }
     },
     "action": "ask_file_per_person",
     "question": "Please upload the power of attorney, or another document that shows the authority of {name}.",
     "key": "auth_doc_{slug(name)}",
     "allow_defer": false,
     "document_checks": [
      "Readable and complete",
      "Names {name} and the authority granted",
      "Signed by a director"
     ]
    }
   ],
   "datapoints": [
    {
     "key": "authreps",
     "label": "Authorised representatives",
     "type": "list",
     "default_source": "rep"
    },
    {
     "key": "auth_doc_{slug}",
     "label": "Authority of {name}",
     "type": "file",
     "default_source": "doc"
    }
   ],
   "kyc_mapping": "Authorised representatives, scope of authority, evidence of authority",
   "evidence": "Power of attorney or other proof of authority. Required",
   "party_effect": "Every authorised representative who is not already a director or UBO becomes a related party and receives the person flow.",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "owners",
   "section": "own",
   "label": "Owners and ownership chain",
   "widget": "ownership_builder",
   "question_company": "Please list everyone who owns {ownerListThreshold}% or more of the organisation, with their share.",
   "question_nl": "The trade register does not publish shareholders. Registry data suggests that {parent} is the parent company. Please list everyone who owns {ownerListThreshold}% or more, with their share.",
   "question_partnership": "Please list all partners, with their share in the partnership.",
   "why": "Banks must know who ultimately owns a company.",
   "behaviour": "Rows: type (Person | Company), name, share % . Total shown; error above 100%; under 100% shows \"the rest is held by smaller owners (under {ownerListThreshold}%) and does not need to be listed\". NL: parent company from the second source is pre-added as a company row without percentage. For every company row: (NL) try KvK match by name → ask \"We found {name} in the trade register. Is this the same company?\" [Yes, same company | No, a different company]; no match or other country → ask \"Where is {name} registered, and what is its registration number?\" (free text). Then always ask \"Who owns {name}? List everyone who holds {ownerListThreshold}% or more of it.\" and repeat the same builder for that company (recursion; cycle protection by company id).",
   "datapoints": [
    {
     "key": "owners",
     "label": "Owners",
     "type": "list",
     "default_source": "rep"
    },
    {
     "key": "chain_{slug}",
     "label": "Owners of {name}",
     "type": "list",
     "default_source": "rep"
    }
   ],
   "kyc_mapping": "Shareholders or partners, ownership chain, percentages",
   "evidence": "Shareholder register or partnership agreement (block docs)",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "ubo",
   "section": "own",
   "label": "Ultimate beneficial owners",
   "widget": "calculated_confirm",
   "question": "Based on what you told us, these people own the organisation, directly or through other companies. At {uboThreshold}% or more they count as ultimate beneficial owners (UBO). Is this complete?",
   "options": [
    "Yes, this is complete",
    "Someone else also controls the organisation"
   ],
   "why": "We calculate who owns {uboThreshold}% or more, also through other companies, and you confirm the result.",
   "precede_with": "Structure card with live organisation chart (see spec section 9.5)",
   "follow_ups": [
    {
     "id": "control",
     "when": {
      "answer_equals": {
       "block": "ubo",
       "value": "Someone else also controls the organisation"
      }
     },
     "action": "ask_text",
     "question": "Who is this, and how do they control the organisation? For example through voting rights or the right to appoint directors.",
     "key": "control",
     "label": "Control other than ownership",
     "effect": "person added to UBO list as \"(control)\""
    },
    {
     "id": "no_owner",
     "when": {
      "calculated": "no owner reaches threshold"
     },
     "action": "rule",
     "effect": "senior managing officials (the directors) are recorded as UBO and an audit event is written"
    }
   ],
   "algorithm": "effective share per person = sum over all paths of the product of the shares along the path; round to 0.1 percentage point; UBO when >= uboThreshold",
   "datapoints": [
    {
     "key": "ubos",
     "label": "Ultimate beneficial owners",
     "type": "list",
     "default_source": "calc"
    },
    {
     "key": "control",
     "label": "Control other than ownership",
     "type": "text",
     "default_source": "rep"
    }
   ],
   "kyc_mapping": "UBOs at threshold, control other than ownership",
   "evidence": "Shareholder register or partnership agreement",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "invites",
   "section": "own",
   "label": "Representative and related parties",
   "widget": "chips + related_party_tracker",
   "question_who": "Before we continue: which of these people are you?",
   "options_from": "names of directors, UBOs and authorised representatives + \"None of these\"",
   "follow_ups": [
    {
     "id": "role",
     "when": {
      "answer_equals": {
       "block": "invites",
       "value": "None of these"
      }
     },
     "action": "ask_text",
     "question": "What is your role at {company}?",
     "key": "rep_role"
    }
   ],
   "question": "Each person below needs to complete a short check of their own: an identity check and a PEP declaration. Choose who to invite, so they can do it while you carry on.",
   "note_queue": "Invitations go out as soon as you have verified your own identity at the end of this conversation. (shown when releaseInvitesAfterIdv is on)",
   "note_threshold": "No check needed for {names}: below the {uboThreshold}% threshold. We record them as owners.",
   "why": "These people must identify themselves. Inviting them now saves time.",
   "behaviour": "Parties = union of directors, UBOs and authorised representatives (unique by name). The declared representative gets status \"Your check comes last\" and no invitation. Others start as \"To invite\" with a \"Send invitation\" button. With releaseInvitesAfterIdv=true the status becomes \"Queued\" and the invitation is sent when the representative has passed ID&V; otherwise \"Invited\" at once. Continue is disabled while any party is still \"To invite\".",
   "datapoints": [
    {
     "key": "rep_role",
     "label": "Representative (declared)",
     "type": "text",
     "default_source": "rep"
    },
    {
     "key": "invites",
     "label": "People to invite for own checks",
     "type": "list",
     "default_source": "calc"
    }
   ],
   "kyc_mapping": "Representative (declared), related parties, ID&V status, PEP declaration",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "purpose_org",
   "section": "prof",
   "label": "Purpose of the relationship",
   "widget": "multi",
   "question": "What will your organisation use New Age Bank for?",
   "why": "Banks need to know what the account will be used for, so they can spot unusual transactions.",
   "options": [
    "Day-to-day business payments",
    "Receiving customer payments",
    "Payroll and supplier payments",
    "Treasury and savings",
    "International trade",
    "Other"
   ],
   "follow_ups": [
    {
     "id": "other",
     "when": {
      "answer_includes": {
       "block": "purpose_org",
       "value": "Other"
      }
     },
     "action": "ask_text",
     "question": "Could you briefly describe what you mean by \"other\"?",
     "key": "o_purpose_other",
     "label": "Other purpose"
    }
   ],
   "datapoints": [
    {
     "key": "o_purpose",
     "label": "Purpose of the relationship",
     "type": "multi",
     "default_source": "rep"
    },
    {
     "key": "o_purpose_other",
     "label": "Other purpose",
     "type": "text",
     "default_source": "rep"
    }
   ],
   "kyc_mapping": "Purpose of relationship",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "nature_org",
   "section": "prof",
   "label": "Products and services",
   "widget": "multi",
   "question": "Which products and services would your organisation like to use?",
   "why": "This tells us which products fit your organisation.",
   "options": [
    "Business current account",
    "Business savings",
    "Debit cards",
    "Payment terminals",
    "International payments",
    "Credit facility"
   ],
   "datapoints": [
    {
     "key": "o_nature",
     "label": "Products and services",
     "type": "multi",
     "default_source": "rep"
    }
   ],
   "kyc_mapping": "Products and services",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "activity",
   "section": "prof",
   "label": "Business activity",
   "widget": "confirm_or_text",
   "question": "The registry lists your main activity as: “{activity}”. Is that an accurate description?",
   "options": [
    "Yes, that is accurate",
    "I want to add detail"
   ],
   "why": "We prefill your registered activity. Add detail if it is incomplete.",
   "follow_ups": [
    {
     "id": "detail",
     "when": {
      "answer_equals": {
       "block": "activity",
       "value": "I want to add detail"
      }
     },
     "action": "ask_area",
     "question": "Please describe what your organisation does, in a few sentences.",
     "key": "o_activity",
     "merge": "registered activity + \". \" + client text"
    }
   ],
   "when_no_registered_activity": "Skip the confirmation and ask the open question directly.",
   "datapoints": [
    {
     "key": "o_activity",
     "label": "Business activity",
     "type": "text",
     "default_source": "kvk|doc|rep"
    }
   ],
   "kyc_mapping": "Activities (SBI, or activity read from the extract)",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "countries_org",
   "section": "prof",
   "label": "Countries of activity and payments",
   "widget": "multi",
   "question": "In which countries does your organisation operate, or send and receive payments?",
   "why": "This helps us monitor international payments properly without blocking them unnecessarily.",
   "options": [
    "Netherlands",
    "Other EU countries",
    "United Kingdom",
    "United States",
    "Caribbean",
    "Asia",
    "Africa",
    "Other"
   ],
   "follow_ups": [
    {
     "id": "outside",
     "when": {
      "any": [
       {
        "answer_includes": {
         "block": "countries_org",
         "value": "Caribbean"
        }
       },
       {
        "answer_includes": {
         "block": "countries_org",
         "value": "Asia"
        }
       },
       {
        "answer_includes": {
         "block": "countries_org",
         "value": "Africa"
        }
       },
       {
        "answer_includes": {
         "block": "countries_org",
         "value": "Other"
        }
       }
      ]
     },
     "action": "ai_followup",
     "question": "You mention payments outside Europe and the US. Which countries, and what are the payments for?",
     "key": "o_countries_detail",
     "label": "Explanation of countries and payments"
    }
   ],
   "datapoints": [
    {
     "key": "o_countries",
     "label": "Countries of activity and payments",
     "type": "multi",
     "default_source": "rep"
    },
    {
     "key": "o_countries_detail",
     "label": "Explanation of countries and payments",
     "type": "text",
     "default_source": "ai"
    }
   ],
   "kyc_mapping": "Countries of operation and payments",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "volume",
   "section": "prof",
   "label": "Expected monthly volume",
   "widget": "chips",
   "question": "What payment volume do you expect per month, in and out together?",
   "why": "We ask for a range, not an exact amount.",
   "options": [
    "Under € 50,000",
    "€ 50,000 to € 250,000",
    "€ 250,000 to € 1 million",
    "Over € 1 million"
   ],
   "follow_ups": [
    {
     "id": "high",
     "when": {
      "answer_equals": {
       "block": "volume",
       "value": "Over € 1 million"
      }
     },
     "action": "ai_followup",
     "question": "You expect more than € 1 million per month. What drives this volume?",
     "key": "o_volume_detail",
     "label": "Explanation of volume"
    }
   ],
   "datapoints": [
    {
     "key": "o_volume",
     "label": "Expected monthly volume",
     "type": "chips",
     "default_source": "rep"
    },
    {
     "key": "o_volume_detail",
     "label": "Explanation of volume",
     "type": "text",
     "default_source": "ai"
    }
   ],
   "kyc_mapping": "Expected transaction volume",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "sof_org",
   "section": "prof",
   "label": "Source of funds",
   "widget": "multi",
   "question": "Where does the money in the account come from?",
   "why": "We need to know where the money in the account comes from.",
   "options": [
    "Revenue from customers",
    "Shareholder funding",
    "Bank loan",
    "Sale of assets",
    "Investor funding",
    "Other"
   ],
   "follow_ups": [
    {
     "id": "loan",
     "when": {
      "answer_includes": {
       "block": "sof_org",
       "value": "Shareholder funding"
      }
     },
     "action": "ask_file",
     "question": "You mention shareholder funding. Do you have a loan or capital contribution agreement?",
     "key": "o_sof_doc",
     "label": "Evidence of shareholder funding",
     "allow_defer": true,
     "defer_creates_open_request": true,
     "document_checks": [
      "Readable and complete",
      "Parties and amounts visible",
      "Dates visible"
     ]
    },
    {
     "id": "other",
     "when": {
      "answer_includes": {
       "block": "sof_org",
       "value": "Other"
      }
     },
     "action": "ai_followup",
     "question": "You chose \"other\". Which source, and over which period and amount?",
     "key": "o_sof_other",
     "label": "Explanation of source (other)"
    }
   ],
   "datapoints": [
    {
     "key": "o_sof",
     "label": "Source of funds",
     "type": "multi",
     "default_source": "rep"
    },
    {
     "key": "o_sof_doc",
     "label": "Evidence of shareholder funding",
     "type": "file",
     "default_source": "doc"
    },
    {
     "key": "o_sof_other",
     "label": "Explanation of source (other)",
     "type": "text",
     "default_source": "ai"
    }
   ],
   "kyc_mapping": "Source of funds of the organisation",
   "evidence": "Loan or capital contribution agreement",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "sow_ubo",
   "section": "prof",
   "label": "Source of wealth of the UBO",
   "widget": "area",
   "question": "Because of the structure, we also ask about {ubo_name}: how did they build their wealth? Think of salary, sale of a company, inheritance or investments.",
   "why": "For larger or more complex organisations we also ask how the owner built their wealth.",
   "show_if": {
    "risk_in": [
     "medium",
     "high"
    ]
   },
   "ubo_name_rule": "first UBO in the calculated list, else \"the main owner\"",
   "follow_ups": [
    {
     "id": "evidence",
     "when": {
      "risk_in": [
       "high"
      ]
     },
     "action": "ask_file",
     "question": "As this is a higher-risk case, could you upload a document that supports this, such as a sale agreement or annual accounts?",
     "key": "o_sow_doc",
     "label": "Evidence of wealth",
     "allow_defer": true,
     "defer_creates_open_request": true,
     "document_checks": [
      "Readable and complete",
      "Name and amount visible",
      "Date visible"
     ]
    }
   ],
   "datapoints": [
    {
     "key": "o_sow",
     "label": "Source of wealth",
     "type": "text",
     "default_source": "rep"
    },
    {
     "key": "o_sow_doc",
     "label": "Evidence of wealth",
     "type": "file",
     "default_source": "doc"
    }
   ],
   "kyc_mapping": "Source of wealth (UBO)",
   "evidence": "High risk: sale agreement, accounts or similar",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "decl_regulated",
   "section": "prof",
   "label": "Regulated or listed",
   "widget": "chips",
   "question": "Is your organisation regulated, or listed on a stock exchange?",
   "why": "Regulated or listed organisations carry a different risk profile.",
   "options": [
    "No",
    "Yes"
   ],
   "active_default": false,
   "follow_ups": [
    {
     "id": "detail",
     "when": {
      "answer_equals": {
       "block": "decl_regulated",
       "value": "Yes"
      }
     },
     "action": "ask_text",
     "question": "Which regulator or exchange, and what is the licence number or ticker?",
     "key": "o_regulated_detail",
     "label": "Regulator or exchange"
    }
   ],
   "datapoints": [
    {
     "key": "o_regulated",
     "label": "Regulated or listed",
     "type": "chips",
     "default_source": "rep"
    },
    {
     "key": "o_regulated_detail",
     "label": "Regulator or exchange",
     "type": "text",
     "default_source": "rep"
    }
   ],
   "kyc_mapping": "Regulated or listed status",
   "client_types": [
    "ORG"
   ],
   "version": 1
  },
  {
   "id": "decl_nominee",
   "section": "prof",
   "label": "Nominee, bearer shares or trust",
   "widget": "chips",
   "question": "Do any of the shares belong to nominee shareholders, bearer shares or a trust?",
   "why": "These arrangements hide who owns a company, so banks must ask.",
   "options": [
    "No",
    "Yes"
   ],
   "active_default": false,
   "follow_ups": [
    {
     "id": "detail",
     "when": {
      "answer_equals": {
       "block": "decl_nominee",
       "value": "Yes"
      }
     },
     "action": "ask_area",
     "question": "Please describe the arrangement and who stands behind it.",
     "key": "o_nominee_detail",
     "label": "Description of arrangement"
    }
   ],
   "datapoints": [
    {
     "key": "o_nominee",
     "label": "Nominee, bearer shares or trust",
     "type": "chips",
     "default_source": "rep"
    },
    {
     "key": "o_nominee_detail",
     "label": "Description of arrangement",
     "type": "text",
     "default_source": "rep"
    }
   ],
   "kyc_mapping": "Opaque structure declaration",
   "client_types": [
    "ORG"
   ],
   "version": 1
  },
  {
   "id": "docs",
   "section": "prof",
   "label": "Ownership document",
   "widget": "upload",
   "question_company": "Last document: please upload your shareholder register. It shows who owns the shares and we use it to check the ownership you described.",
   "question_partnership": "Last document: please upload the partnership agreement (or deed of partnership). It shows the partners, their shares and who may act for the partnership.",
   "why": "It confirms the ownership you described.",
   "show_if": {
    "not": {
     "legal_form_kind": "sole"
    }
   },
   "document_checks_company": [
    "Readable and complete",
    "Lists all shareholders and their shares",
    "Percentages match what you declared"
   ],
   "document_checks_partnership": [
    "Readable and complete",
    "Lists all partners and their shares",
    "Signed by the partners",
    "Shares match what you declared"
   ],
   "allow_defer": false,
   "datapoints": [
    {
     "key": "o_register",
     "label": "Shareholder register",
     "type": "file",
     "default_source": "doc"
    },
    {
     "key": "o_agreement",
     "label": "Partnership agreement",
     "type": "file",
     "default_source": "doc"
    }
   ],
   "kyc_mapping": "Shareholder register (companies) or partnership agreement (partnerships)",
   "evidence": "Required before submitting",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "rep",
   "section": "id",
   "label": "Representative: role, ID check and PEP",
   "widget": "idv + chips",
   "question": "Finally, your own identity, as the person who submits this application. After that you do not have to type your name, date of birth or nationality.",
   "why": "We need to know who submits this application, so we verify your identity before we process it.",
   "steps": [
    "ID&V (same widget as NP block idv)",
    "Confirm identity data (same as name_confirm)",
    "If a person was declared in block invites: compare name on ID with the declared name. Mismatch → say \"The name on your ID ({id_name}) differs from the person you selected ({declared}). A colleague will check this. You can simply continue.\" and store datapoint rep_flag; analyst is alerted",
    "PEP declaration (same as NP block pep, including the unsure loop and yes follow-ups)",
    "Mark representative verified; set own party status \"Verified (you)\"; release all \"Queued\" invitations (status Invited, request created, email sent) and say \"Thank you, you are verified. We have now sent the invitations to {names}. They can complete their own checks while you finish here.\" (tag: Invitations sent)"
   ],
   "datapoints": [
    {
     "key": "full_name",
     "label": "Full name",
     "type": "text",
     "default_source": "idv"
    },
    {
     "key": "dob",
     "label": "Date of birth",
     "type": "date",
     "default_source": "idv"
    },
    {
     "key": "nat",
     "label": "Nationality",
     "type": "text",
     "default_source": "idv"
    },
    {
     "key": "doc",
     "label": "Identity document",
     "type": "text",
     "default_source": "idv"
    },
    {
     "key": "pep",
     "label": "PEP declaration (representative)",
     "type": "chips",
     "default_source": "client"
    },
    {
     "key": "pep_detail",
     "label": "PEP details",
     "type": "text",
     "default_source": "client"
    },
    {
     "key": "rep_flag",
     "label": "Representative mismatch",
     "type": "text",
     "default_source": "calc"
    }
   ],
   "kyc_mapping": "Representative identity, PEP status",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "review_org",
   "section": "decl",
   "label": "Review of all answers",
   "widget": "review",
   "question": "Almost done. Here is everything once more. Change anything that is not right before you declare it.",
   "why": "You see everything once more before you declare it.",
   "groups": [
    "Organisation",
    "People and ownership",
    "Business profile",
    "Documents",
    "You, as representative"
   ],
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  },
  {
   "id": "sign_org",
   "section": "decl",
   "label": "Terms and signed declaration",
   "widget": "sign",
   "question": "Last step: the terms and your declaration. You sign on behalf of {company}, so please read it carefully.",
   "why": "By signing you declare that the information is true.",
   "declaration": "I declare that the information above is true and complete, and that I am authorised to submit it on behalf of {company}.",
   "datapoints": [
    {
     "key": "declaration",
     "label": "Declaration and signature",
     "type": "text",
     "default_source": "client"
    }
   ],
   "kyc_mapping": "Declaration, signature",
   "client_types": [
    "ORG"
   ],
   "active_default": true,
   "version": 1
  }
 ]
};

export const OUTREACH_FORM_TEMPLATES = {
 "_readme": "Form Templates (assembled from blocks). Order is the order of the conversation. A block that is inactive or whose show_if is false is skipped and logged (block.skipped). Progress total = number of counted blocks, see build spec section 5.5.",
 "templates": [
  {
   "id": "onboarding_np",
   "name": "Onboarding NP",
   "client_type": "NP",
   "case_types": [
    "Onboarding"
   ],
   "channel": "email invitation, link opens the portal",
   "default_deadline_days": 14,
   "expected_minutes": 6,
   "sections": [
    [
     "id",
     "Identity"
    ],
    [
     "contact",
     "Contact"
    ],
    [
     "rel",
     "Purpose of relationship"
    ],
    [
     "fin",
     "Financial situation"
    ],
    [
     "act",
     "Expected activity"
    ],
    [
     "decl",
     "Declaration"
    ]
   ],
   "blocks": [
    "idv",
    "name_confirm",
    "address",
    "address_proof",
    "email",
    "phone",
    "purpose",
    "nature",
    "employment",
    "income",
    "sof",
    "activities",
    "pep",
    "review",
    "sign"
   ],
   "progress_total": 15,
   "intro": [
    "Hi {first_name}, welcome to New Age Bank.",
    "This takes about 6 minutes. Please respond by {deadline_date}. Your answers are saved automatically, so you can stop at any time and continue later with the same link."
   ],
   "start_chip": "Let's begin"
  },
  {
   "id": "onboarding_org",
   "name": "Onboarding ORG (KYB)",
   "client_type": "ORG",
   "case_types": [
    "Onboarding"
   ],
   "channel": "email invitation to the representative",
   "default_deadline_days": 14,
   "expected_minutes": 12,
   "sections": [
    [
     "org",
     "Organisation"
    ],
    [
     "own",
     "People and ownership"
    ],
    [
     "prof",
     "Business profile"
    ],
    [
     "id",
     "You"
    ],
    [
     "decl",
     "Declaration"
    ]
   ],
   "blocks": [
    "country",
    "registry",
    "directors",
    "authreps",
    "owners",
    "ubo",
    "invites",
    "purpose_org",
    "nature_org",
    "activity",
    "countries_org",
    "volume",
    "sof_org",
    "sow_ubo",
    "decl_regulated",
    "decl_nominee",
    "docs",
    "rep",
    "review_org",
    "sign_org"
   ],
   "progress_total": "2 (review, sign) + 2 (idv and name_confirm inside block rep) + number of active blocks, excluding review_org and sign_org, whose show_if is true at the start. Example at Low risk with default switches: 2 + 2 + 15 = 19. See build spec section 5.5",
   "settings": {
    "uboThreshold": 25,
    "ownerListThreshold": 10,
    "releaseInvitesAfterIdv": true
   },
   "intro": [
    "Hi {first_name}, welcome to New Age Bank.",
    "We are opening an account for your organisation. This takes about 12 minutes and your answers are saved automatically. We start with the organisation. At the end we ask for your own identity, and you can invite colleagues and owners to complete their own part while you carry on."
   ],
   "start_chip": "Let's begin"
  },
  {
   "id": "related_party_np",
   "name": "Related party (person)",
   "client_type": "NP (related party of an organisation)",
   "case_types": [
    "Onboarding (child of an ORG case)"
   ],
   "channel": "email invitation sent by the platform when the ORG representative has passed ID&V",
   "default_deadline_days": 14,
   "expected_minutes": 4,
   "sections": [
    [
     "id",
     "Identity"
    ],
    [
     "contact",
     "Contact and checks"
    ],
    [
     "decl",
     "Declaration"
    ]
   ],
   "blocks": [
    "idv",
    "name_confirm",
    "address",
    "email",
    "phone",
    "pep",
    "review",
    "sign"
   ],
   "progress_total": 8,
   "intro": [
    "Hi {first_name}, {company} has asked you to complete your own details as {role_text}.",
    "This takes about 4 minutes. Your answers are saved automatically."
   ],
   "start_chip": "Let's begin",
   "notes": "Block pep sits in section 'contact' for this template. No proof of address. The completion marks the parent request answered and the party Completed."
  }
 ]
};
