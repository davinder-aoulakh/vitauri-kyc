/**
 * Lightweight i18n context for Vitauri KYC — EN / NL
 * Language resolution order:
 *   1. user.language_preference  (set on User entity)
 *   2. tenant.default_language
 *   3. 'en' fallback
 */
import React, { createContext, useContext, useMemo } from 'react';

// ─── Translation strings ──────────────────────────────────────────────────────

const translations = {
  en: {
    // Navigation
    nav_dashboard: 'Dashboard',
    nav_my_cases: 'My Cases',
    nav_all_cases: 'All Cases',
    nav_new_client: 'New Client',
    nav_client_search: 'Client Search',
    nav_screening: 'Screening',
    nav_review_planner: 'Review Planner',
    nav_mi_dashboard: 'MI Dashboard',
    nav_archive: 'Archive',
    nav_tenant_config: 'Tenant Config',
    nav_user_management: 'User Management',
    nav_ai_prompts: 'AI Prompts',

    // Common actions
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    view: 'View',
    close: 'Close',
    submit: 'Submit',
    confirm: 'Confirm',
    refresh: 'Refresh',
    export: 'Export',
    search: 'Search',
    filter: 'Filter',
    loading: 'Loading…',
    saving: 'Saving…',
    back: 'Back',
    next: 'Next',
    previous: 'Previous',
    try_again: 'Try again',
    add: 'Add',
    remove: 'Remove',
    assign: 'Assign',
    create: 'Create',
    approve: 'Approve',
    reject: 'Reject',
    yes: 'Yes',
    no: 'No',
    all: 'All',
    none: 'None',
    unknown: 'Unknown',
    optional: '(optional)',
    required: 'Required',

    // Status labels
    status_draft: 'Draft',
    status_in_progress: 'In Progress',
    status_outreach_pending: 'Outreach Pending',
    status_screening: 'Screening',
    status_assessment: 'Assessment',
    status_qc: 'QC',
    status_compliance_review: 'Compliance Review',
    status_sign_off_pending: 'Sign-Off Pending',
    status_approved: 'Approved',
    status_rejected: 'Rejected',
    status_closed: 'Closed',

    // Risk labels
    risk_low: 'Low',
    risk_medium: 'Medium',
    risk_high: 'High',
    risk_unacceptable: 'Unacceptable',

    // Client status
    client_prospect: 'Prospect',
    client_active: 'Active',
    client_inactive: 'Inactive',
    client_former: 'Former',
    client_rejected: 'Rejected',
    client_unacceptable: 'Unacceptable',

    // Case types
    case_onboarding: 'Onboarding',
    case_periodic_review: 'Periodic Review',
    case_event_driven_review: 'Event-Driven Review',
    case_offboarding: 'Offboarding',

    // Notifications
    notifications: 'Notifications',
    no_notifications: 'No new notifications',
    mark_all_read: 'Mark all read',
    mark_read: 'Mark read',
    notif_case_assigned: 'Case assigned to you',
    notif_sign_off_request: 'Sign-off request',
    notif_sign_off_decision: 'Sign-off decision',
    notif_outreach_response: 'Client response received',
    notif_monitoring_alert: 'New monitoring alert',
    notif_control_measure_due: 'Control measure due',
    notif_periodic_review: 'Periodic review created',

    // Errors
    error_generic: 'Something went wrong. Please try again.',
    error_network: 'Network error. Check your connection.',
    error_ai: 'AI generation failed. Please try again.',
    error_upload: 'File upload failed. Please try again.',
    error_required_field: 'This field is required.',
    error_min_chars: 'Minimum {{n}} characters required.',
    error_file_too_large: 'File too large (max {{size}}).',
    error_invalid_date: 'Invalid date.',
    error_unauthorized: 'You don\'t have permission to do this.',

    // Empty states
    empty_cases: 'No cases found',
    empty_cases_cta: 'Start a new KYC case',
    empty_clients: 'No clients found',
    empty_clients_cta: 'Add a new client',
    empty_notifications: 'You\'re all caught up!',
    empty_alerts: 'No alerts at this time',
    empty_documents: 'No documents uploaded yet',
    empty_screening: 'No screening hits',
    empty_reviews: 'No reviews due',
    empty_search: 'No results match your search',

    // Dashboard
    dashboard_welcome: 'Good morning',
    dashboard_welcome_afternoon: 'Good afternoon',
    dashboard_welcome_evening: 'Good evening',
    my_cases: 'My Cases',
    overdue: 'Overdue',
    due_today: 'Due Today',
    pending_signoff: 'Pending Sign-off',
    recent_activity: 'Recent Activity',
    open_cases: 'Open Cases',
    active_clients: 'Active Clients',

    // Case workspace
    case_workspace: 'Case Workspace',
    case_notes: 'Case Notes',
    add_notes: 'Add notes…',
    mark_complete: 'Mark Complete',
    mark_flagged: 'Flag',
    override_status: 'Override Status',
    audit_trail: 'Audit Trail',
    ai_assistant: 'AI Assistant',
    generate: 'Generate',
    accept: 'Accept',
    override: 'Override',
    step_outreach: 'Outreach & Documents',
    step_identity: 'Identity Verification',
    step_screening: 'Screening',
    step_profile: 'Client Profile',
    step_sofsow: 'Source of Funds/Wealth',
    step_risk: 'Risk Assessment',
    step_controls: 'Control Measures',
    step_signoff: 'Sign-Off & Report',

    // Review Planner
    review_planner: 'Review Planner',
    upcoming_reviews: 'Upcoming Reviews',
    overdue_reviews: 'Overdue',
    due_in_90: 'Due in 90 days',
    trigger_review: 'Trigger Review',
    assign_analyst: 'Assign Analyst',
    extend_date: 'Extend Date',
    auto_assign: 'Auto-assign Reviews',
    justification: 'Justification',
    new_review_date: 'New Review Date',

    // Archive
    archive: 'Archive',
    restricted_list: 'Restricted Client List',
    reactivate: 'Re-activate',
    retention_expires: 'Retention expires',

    // AI
    ai_generating: 'AI is generating…',
    ai_error: 'AI generation failed.',
    ai_accept: 'Accept',
    ai_edit: 'Edit',
    ai_override: 'Override',
    ai_reject: 'Reject',
    ai_key_points: 'Key Points',
    ai_justification_required: 'Justification required (min 10 chars)',

    // Sign-off
    submit_for_signoff: 'Submit for Sign-Off',
    approve_case: 'Approve Case',
    reject_case: 'Reject Case',
    sign_off_approved: 'Case Approved',
    sign_off_rejected: 'Sign-Off Rejected',
    rejection_reason: 'Rejection Reason',

    // Language toggle
    switch_to_nl: 'NL',
    switch_to_en: 'EN',
    language: 'Language',
  },

  nl: {
    // Navigation
    nav_dashboard: 'Dashboard',
    nav_my_cases: 'Mijn Dossiers',
    nav_all_cases: 'Alle Dossiers',
    nav_new_client: 'Nieuwe Cliënt',
    nav_client_search: 'Cliënt Zoeken',
    nav_screening: 'Screening',
    nav_review_planner: 'Herzieningen Planner',
    nav_mi_dashboard: 'MI Dashboard',
    nav_archive: 'Archief',
    nav_tenant_config: 'Instellingen',
    nav_user_management: 'Gebruikersbeheer',
    nav_ai_prompts: 'AI Prompts',

    // Common actions
    save: 'Opslaan',
    cancel: 'Annuleren',
    delete: 'Verwijderen',
    edit: 'Bewerken',
    view: 'Bekijken',
    close: 'Sluiten',
    submit: 'Verzenden',
    confirm: 'Bevestigen',
    refresh: 'Vernieuwen',
    export: 'Exporteren',
    search: 'Zoeken',
    filter: 'Filteren',
    loading: 'Laden…',
    saving: 'Opslaan…',
    back: 'Terug',
    next: 'Volgende',
    previous: 'Vorige',
    try_again: 'Opnieuw proberen',
    add: 'Toevoegen',
    remove: 'Verwijderen',
    assign: 'Toewijzen',
    create: 'Aanmaken',
    approve: 'Goedkeuren',
    reject: 'Afwijzen',
    yes: 'Ja',
    no: 'Nee',
    all: 'Alle',
    none: 'Geen',
    unknown: 'Onbekend',
    optional: '(optioneel)',
    required: 'Verplicht',

    // Status labels
    status_draft: 'Concept',
    status_in_progress: 'In Behandeling',
    status_outreach_pending: 'Uitvraag In Afwachting',
    status_screening: 'Screening',
    status_assessment: 'Beoordeling',
    status_qc: 'Kwaliteitscontrole',
    status_compliance_review: 'Compliance Review',
    status_sign_off_pending: 'Accordering In Afwachting',
    status_approved: 'Goedgekeurd',
    status_rejected: 'Afgewezen',
    status_closed: 'Gesloten',

    // Risk labels
    risk_low: 'Laag',
    risk_medium: 'Gemiddeld',
    risk_high: 'Hoog',
    risk_unacceptable: 'Onaanvaardbaar',

    // Client status
    client_prospect: 'Prospect',
    client_active: 'Actief',
    client_inactive: 'Inactief',
    client_former: 'Voormalig',
    client_rejected: 'Afgewezen',
    client_unacceptable: 'Onaanvaardbaar',

    // Case types
    case_onboarding: 'Onboarding',
    case_periodic_review: 'Periodieke Herziening',
    case_event_driven_review: 'Gebeurtenisgestuurde Herziening',
    case_offboarding: 'Offboarding',

    // Notifications
    notifications: 'Meldingen',
    no_notifications: 'Geen nieuwe meldingen',
    mark_all_read: 'Alles als gelezen markeren',
    mark_read: 'Als gelezen markeren',
    notif_case_assigned: 'Dossier aan u toegewezen',
    notif_sign_off_request: 'Accorderingsverzoek',
    notif_sign_off_decision: 'Accorderingsbeslissing',
    notif_outreach_response: 'Reactie cliënt ontvangen',
    notif_monitoring_alert: 'Nieuwe monitoring melding',
    notif_control_measure_due: 'Beheersmaatregel vervalt',
    notif_periodic_review: 'Periodieke herziening aangemaakt',

    // Errors
    error_generic: 'Er is iets misgegaan. Probeer het opnieuw.',
    error_network: 'Netwerkfout. Controleer uw verbinding.',
    error_ai: 'AI-generatie mislukt. Probeer het opnieuw.',
    error_upload: 'Bestand uploaden mislukt. Probeer het opnieuw.',
    error_required_field: 'Dit veld is verplicht.',
    error_min_chars: 'Minimaal {{n}} tekens vereist.',
    error_file_too_large: 'Bestand te groot (max {{size}}).',
    error_invalid_date: 'Ongeldige datum.',
    error_unauthorized: 'U heeft geen toestemming voor deze actie.',

    // Empty states
    empty_cases: 'Geen dossiers gevonden',
    empty_cases_cta: 'Start een nieuw KYC dossier',
    empty_clients: 'Geen cliënten gevonden',
    empty_clients_cta: 'Voeg een nieuwe cliënt toe',
    empty_notifications: 'Alles bijgewerkt!',
    empty_alerts: 'Geen meldingen op dit moment',
    empty_documents: 'Nog geen documenten geüpload',
    empty_screening: 'Geen screeningresultaten',
    empty_reviews: 'Geen herzieningsdatums',
    empty_search: 'Geen resultaten gevonden',

    // Dashboard
    dashboard_welcome: 'Goedemorgen',
    dashboard_welcome_afternoon: 'Goedemiddag',
    dashboard_welcome_evening: 'Goedenavond',
    my_cases: 'Mijn Dossiers',
    overdue: 'Achterstallig',
    due_today: 'Vandaag Vervallend',
    pending_signoff: 'Wacht op Accordering',
    recent_activity: 'Recente Activiteit',
    open_cases: 'Open Dossiers',
    active_clients: 'Actieve Cliënten',

    // Case workspace
    case_workspace: 'Dossier Werkruimte',
    case_notes: 'Dossiernotities',
    add_notes: 'Notities toevoegen…',
    mark_complete: 'Markeer als Voltooid',
    mark_flagged: 'Markeer',
    override_status: 'Status Overschrijven',
    audit_trail: 'Auditspoor',
    ai_assistant: 'AI Assistent',
    generate: 'Genereren',
    accept: 'Accepteren',
    override: 'Overschrijven',
    step_outreach: 'Uitvraag & Documenten',
    step_identity: 'Identiteitsverificatie',
    step_screening: 'Screening',
    step_profile: 'Cliëntprofiel',
    step_sofsow: 'Bron van Vermogen',
    step_risk: 'Risicobeoordeling',
    step_controls: 'Beheersmaatregelen',
    step_signoff: 'Accordering & Rapport',

    // Review Planner
    review_planner: 'Herzieningen Planner',
    upcoming_reviews: 'Aankomende Herzieningn',
    overdue_reviews: 'Achterstallig',
    due_in_90: 'Vervalt binnen 90 dagen',
    trigger_review: 'Herziening Starten',
    assign_analyst: 'Analist Toewijzen',
    extend_date: 'Datum Verlengen',
    auto_assign: 'Automatisch Toewijzen',
    justification: 'Motivering',
    new_review_date: 'Nieuwe Herzieningsdatum',

    // Archive
    archive: 'Archief',
    restricted_list: 'Beperkte Cliëntenlijst',
    reactivate: 'Heractiveren',
    retention_expires: 'Bewaring vervalt',

    // AI
    ai_generating: 'AI genereert…',
    ai_error: 'AI-generatie mislukt.',
    ai_accept: 'Accepteren',
    ai_edit: 'Bewerken',
    ai_override: 'Overschrijven',
    ai_reject: 'Afwijzen',
    ai_key_points: 'Kernpunten',
    ai_justification_required: 'Motivering vereist (min 10 tekens)',

    // Sign-off
    submit_for_signoff: 'Indienen voor Accordering',
    approve_case: 'Dossier Goedkeuren',
    reject_case: 'Dossier Afwijzen',
    sign_off_approved: 'Dossier Goedgekeurd',
    sign_off_rejected: 'Accordering Afgewezen',
    rejection_reason: 'Reden voor Afwijzing',

    // Language toggle
    switch_to_nl: 'NL',
    switch_to_en: 'EN',
    language: 'Taal',
  },
};

// ─── Context ──────────────────────────────────────────────────────────────────

const I18nContext = createContext({ lang: 'en', t: (k) => k });

export function I18nProvider({ lang = 'en', children }) {
  const value = useMemo(() => ({
    lang,
    t: (key, vars = {}) => {
      const str = translations[lang]?.[key] ?? translations['en']?.[key] ?? key;
      return Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), str);
    },
  }), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

/** Helper: resolve lang from user + tenant objects */
export function resolveLang(user, tenant) {
  const pref = user?.language_preference;
  if (pref === 'nl' || pref === 'en') return pref;
  const def = tenant?.default_language;
  if (def === 'nl' || def === 'en') return def;
  return 'en';
}

export { translations };