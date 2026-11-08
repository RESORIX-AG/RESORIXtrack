/**
 * Email texts (i18n namespace "mail", server side only). Placeholders: {name}. Paragraphs in `*.body`
 * are separated by a blank line. Every locale must have the same keys and placeholders (mail.test.ts).
 */
import type { Locale } from "@/lib/locales"

export const en = {
  "common.hello": "Hello {name},",
  "common.note": "Note: {note}",
  "common.reason": "Reason: {reason}",
  "common.days_one": "{count} working day",
  "common.days_other": "{count} working days",
  "common.someone": "An administrator",
  "common.ignore": "Not expected? Contact your administrator.",

  "type.vacation": "Vacation",
  "type.sick": "Sick leave",
  "type.accident": "Accident",
  "type.child_sick": "Caring for a sick child",
  "type.military": "Military / civil service",
  "type.training": "Training",
  "type.comp_time": "Time off in lieu",
  "type.special": "Special leave",
  "type.unpaid": "Unpaid leave",

  "invite.subject": "Your RESORIXtrack account",
  "invite.body":
    "{actor} created a RESORIXtrack account for you at {company}. Choose your password within {days} days.\n\nYour sign-in email: {email}",
  "invite.cta": "Set password",

  "password_reset.subject": "Reset your password",
  "password_reset.body":
    "Use the link within {minutes} minutes to choose a new password.\n\nDidn't ask for this? Ignore this email; your password stays unchanged.",
  "password_reset.cta": "Choose new password",

  "passkey_added.subject": "A passkey was added to your account",
  "passkey_added.body":
    "A new passkey was added to your RESORIXtrack account. It signs you in without password or two-factor code.\n\nNot you? Remove it under Profile → Passkeys, change your password and tell your administrator.",

  "password_changed.subject": "Your password was changed",
  "password_changed.body":
    "Your RESORIXtrack password was changed. Other devices were signed out.\n\nNot you? Reset your password at {url} and tell your administrator.",

  "password_set_by_admin.subject": "{actor} set a new password",
  "password_set_by_admin.body":
    "{actor} set a new password for your account and all your devices were signed out. You get it from {actor} directly, never by email.\n\nAfter signing in, choose your own password under Profile.",
  "password_set_by_admin.cta": "Sign in",

  "email_changed.subject": "Your sign-in email was changed",
  "email_changed.body":
    "{actor} changed your sign-in email to {newEmail}. This address no longer receives messages from RESORIXtrack. All devices were signed out.",

  "entry_corrected.subject": "{actor} changed your time entry",
  "entry_corrected.create": "{actor} added a time entry on {date} ({time}).",
  "entry_corrected.update": "{actor} changed your time entry on {date} ({time}).",
  "entry_corrected.delete": "{actor} deleted your time entry on {date} ({time}).",
  "entry_corrected.footer": "Every change is logged. You can dispute it in RESORIXtrack.",
  "entry_corrected.cta": "Review change",

  "entry_disputed.subject": "{actor} disputes a correction",
  "entry_disputed.body": "{actor} disagrees with a change to their time entry on {date}:\n\n“{message}”",
  "entry_disputed.cta": "Open",

  "absence_requested.subject": "{requester} requests: {type}",
  "absence_requested.body": "{requester} requests {type} from {start} to {end} ({days}).",
  "absence_requested.cta": "Review request",

  "absence_reported.subject": "{requester} reported: {type}",
  "absence_reported.body": "{requester} reported {type} from {start} to {end} ({days}).",
  "absence_reported.cta": "Open team",

  "absence_recorded.subject": "{actor} recorded an absence for you",
  "absence_recorded.body": "{actor} recorded {type} for you from {start} to {end} ({days}).",
  "absence_recorded.attachments": "You can upload a doctor's note in RESORIXtrack (optional).",
  "absence_recorded.cta": "View absences",

  "absence_approved.subject": "{type} approved",
  "absence_approved.body": "{actor} approved your {type} from {start} to {end} ({days}).",
  "absence_approved.cta": "View absences",

  "absence_rejected.subject": "{type} declined",
  "absence_rejected.body": "{actor} declined your {type} request from {start} to {end}.",
  "absence_rejected.cta": "View absences",

  "absence_cancelled.subject": "{type} cancelled",
  "absence_cancelled.body": "{actor} cancelled your {type} from {start} to {end}.",
  "absence_cancelled.cta": "View absences",
  "absence_changed.subject": "{type} changed",
  "absence_changed.body": "{actor} changed your {type}: {start} to {end}.",
  "absence_changed.cta": "View absences",

  "clock_reminder.subject": "Still working?",
  "clock_reminder.body":
    "You have been clocked in since {time} on {date}, more than {hours} hours. Forgot to clock out?",
  "clock_reminder.cta": "Open RESORIXtrack",

  "test.subject": "RESORIXtrack test email",
  "test.body": "SMTP works: this test email from RESORIXtrack arrived.",

  "month_signed_off.subject": "{month} signed off",
  "month_signed_off.body": "{actor} signed off your working time for {month}. The month can no longer be changed.",
  "month_signed_off.cta": "View report",

  "mfa_reset.subject": "Two-factor authentication reset",
  "mfa_reset.body": "{actor} reset two-factor authentication for your account. Set it up again under Profile.",
  "mfa_reset.cta": "Open profile",
}

export type MailKey = keyof typeof en
export type MailStrings = Record<MailKey, string>

export const de: MailStrings = {
  "common.hello": "Hallo {name}",
  "common.note": "Notiz: {note}",
  "common.reason": "Begründung: {reason}",
  "common.days_one": "{count} Arbeitstag",
  "common.days_other": "{count} Arbeitstage",
  "common.someone": "Die Administration",
  "common.ignore": "Nicht erwartet? Melde dich bei deiner Administration.",

  "type.vacation": "Ferien",
  "type.sick": "Krankheit",
  "type.accident": "Unfall",
  "type.child_sick": "Pflege krankes Kind",
  "type.military": "Militär / Zivildienst",
  "type.training": "Weiterbildung",
  "type.comp_time": "Kompensation",
  "type.special": "Sonderurlaub",
  "type.unpaid": "Unbezahlter Urlaub",

  "invite.subject": "Dein RESORIXtrack-Konto",
  "invite.body":
    "{actor} hat für dich ein RESORIXtrack-Konto bei {company} eingerichtet. Lege innerhalb von {days} Tagen dein Passwort fest.\n\nDeine Anmelde-E-Mail: {email}",
  "invite.cta": "Passwort festlegen",

  "password_reset.subject": "Passwort zurücksetzen",
  "password_reset.body":
    "Wähle über den Link innerhalb von {minutes} Minuten ein neues Passwort.\n\nNicht angefordert? Ignoriere diese E-Mail; dein Passwort bleibt unverändert.",
  "password_reset.cta": "Neues Passwort wählen",

  "passkey_added.subject": "Ein Passkey wurde zu deinem Konto hinzugefügt",
  "passkey_added.body":
    "Zu deinem RESORIXtrack-Konto wurde ein neuer Passkey hinzugefügt. Er meldet dich ohne Passwort und Zwei-Faktor-Code an.\n\nWarst du das nicht? Entferne ihn unter Profil → Passkeys, ändere dein Passwort und informiere deine Administration.",

  "password_changed.subject": "Dein Passwort wurde geändert",
  "password_changed.body":
    "Dein RESORIXtrack-Passwort wurde geändert. Andere Geräte wurden abgemeldet.\n\nNicht du? Setze dein Passwort unter {url} zurück und informiere deine Administration.",

  "password_set_by_admin.subject": "{actor} hat ein neues Passwort gesetzt",
  "password_set_by_admin.body":
    "{actor} hat ein neues Passwort für dein Konto gesetzt, alle deine Geräte wurden abgemeldet. Du erhältst es direkt von {actor}, nie per E-Mail.\n\nNach der Anmeldung wählst du unter Profil dein eigenes Passwort.",
  "password_set_by_admin.cta": "Anmelden",

  "email_changed.subject": "Deine Anmelde-E-Mail wurde geändert",
  "email_changed.body":
    "{actor} hat deine Anmelde-E-Mail auf {newEmail} geändert. Diese Adresse erhält keine Nachrichten von RESORIXtrack mehr. Alle Geräte wurden abgemeldet.",

  "entry_corrected.subject": "{actor} hat deine Zeiterfassung geändert",
  "entry_corrected.create": "{actor} hat einen Zeiteintrag am {date} ({time}) hinzugefügt.",
  "entry_corrected.update": "{actor} hat deinen Zeiteintrag am {date} ({time}) geändert.",
  "entry_corrected.delete": "{actor} hat deinen Zeiteintrag am {date} ({time}) gelöscht.",
  "entry_corrected.footer": "Jede Änderung wird protokolliert. Du kannst sie in RESORIXtrack beanstanden.",
  "entry_corrected.cta": "Änderung ansehen",

  "entry_disputed.subject": "{actor} beanstandet eine Korrektur",
  "entry_disputed.body": "{actor} ist mit einer Änderung am Zeiteintrag vom {date} nicht einverstanden:\n\n«{message}»",
  "entry_disputed.cta": "Öffnen",

  "absence_requested.subject": "{requester} beantragt: {type}",
  "absence_requested.body": "{requester} beantragt «{type}» vom {start} bis {end} ({days}).",
  "absence_requested.cta": "Antrag prüfen",

  "absence_reported.subject": "{requester} meldet: {type}",
  "absence_reported.body": "{requester} hat «{type}» vom {start} bis {end} gemeldet ({days}).",
  "absence_reported.cta": "Team öffnen",

  "absence_recorded.subject": "{actor} hat eine Absenz für dich erfasst",
  "absence_recorded.body": "{actor} hat für dich «{type}» vom {start} bis {end} erfasst ({days}).",
  "absence_recorded.attachments": "Du kannst in RESORIXtrack ein Arztzeugnis hochladen (freiwillig).",
  "absence_recorded.cta": "Absenzen ansehen",

  "absence_approved.subject": "{type} bewilligt",
  "absence_approved.body": "{actor} hat «{type}» vom {start} bis {end} bewilligt ({days}).",
  "absence_approved.cta": "Absenzen ansehen",

  "absence_rejected.subject": "{type} abgelehnt",
  "absence_rejected.body": "{actor} hat deinen Antrag «{type}» vom {start} bis {end} abgelehnt.",
  "absence_rejected.cta": "Absenzen ansehen",

  "absence_cancelled.subject": "{type} storniert",
  "absence_cancelled.body": "{actor} hat «{type}» vom {start} bis {end} storniert.",
  "absence_cancelled.cta": "Absenzen ansehen",
  "absence_changed.subject": "{type} geändert",
  "absence_changed.body": "{actor} hat «{type}» geändert: {start} bis {end}.",
  "absence_changed.cta": "Absenzen ansehen",

  "clock_reminder.subject": "Arbeitest du noch?",
  "clock_reminder.body":
    "Du bist seit {time} Uhr am {date} eingestempelt, mehr als {hours} Stunden. Vergessen auszustempeln?",
  "clock_reminder.cta": "RESORIXtrack öffnen",

  "test.subject": "RESORIXtrack Test-E-Mail",
  "test.body": "SMTP funktioniert: Diese Test-E-Mail von RESORIXtrack ist angekommen.",

  "month_signed_off.subject": "{month} abgeschlossen",
  "month_signed_off.body":
    "{actor} hat deine Arbeitszeit für {month} abgeschlossen. Der Monat kann nicht mehr geändert werden.",
  "month_signed_off.cta": "Bericht ansehen",

  "mfa_reset.subject": "Zwei-Faktor-Anmeldung zurückgesetzt",
  "mfa_reset.body":
    "{actor} hat die Zwei-Faktor-Anmeldung für dein Konto zurückgesetzt. Richte sie unter Profil neu ein.",
  "mfa_reset.cta": "Profil öffnen",
}

export const fr: MailStrings = {
  "common.hello": "Bonjour {name},",
  "common.note": "Note : {note}",
  "common.reason": "Motif : {reason}",
  "common.days_one": "{count} jour ouvré",
  "common.days_other": "{count} jours ouvrés",
  "common.someone": "L'administration",
  "common.ignore": "Inattendu ? Contacte ton administration.",

  "type.vacation": "Vacances",
  "type.sick": "Maladie",
  "type.accident": "Accident",
  "type.child_sick": "Garde d'enfant malade",
  "type.military": "Service militaire / civil",
  "type.training": "Formation",
  "type.comp_time": "Compensation",
  "type.special": "Congé spécial",
  "type.unpaid": "Congé non payé",

  "invite.subject": "Ton compte RESORIXtrack",
  "invite.body":
    "{actor} a créé un compte RESORIXtrack pour toi chez {company}. Choisis ton mot de passe dans les {days} jours.\n\nTon e-mail de connexion : {email}",
  "invite.cta": "Définir le mot de passe",

  "password_reset.subject": "Réinitialiser ton mot de passe",
  "password_reset.body":
    "Utilise le lien dans les {minutes} minutes pour choisir un nouveau mot de passe.\n\nTu n'as rien demandé ? Ignore cet e-mail ; ton mot de passe reste inchangé.",
  "password_reset.cta": "Choisir un mot de passe",

  "passkey_added.subject": "Une clé d'accès a été ajoutée à ton compte",
  "passkey_added.body":
    "Une nouvelle clé d'accès a été ajoutée à ton compte RESORIXtrack. Elle te connecte sans mot de passe ni code à deux facteurs.\n\nCe n'était pas toi ? Supprime-la sous Profil → Clés d'accès, change ton mot de passe et informe ton administrateur.",

  "password_changed.subject": "Ton mot de passe a été modifié",
  "password_changed.body":
    "Ton mot de passe RESORIXtrack a été modifié. Les autres appareils ont été déconnectés.\n\nCe n'était pas toi ? Réinitialise ton mot de passe sur {url} et informe ton administration.",

  "password_set_by_admin.subject": "{actor} a défini un nouveau mot de passe",
  "password_set_by_admin.body":
    "{actor} a défini un nouveau mot de passe pour ton compte et tous tes appareils ont été déconnectés. Tu le reçois directement de {actor}, jamais par e-mail.\n\nAprès la connexion, choisis ton propre mot de passe sous Profil.",
  "password_set_by_admin.cta": "Se connecter",

  "email_changed.subject": "Ton e-mail de connexion a été modifié",
  "email_changed.body":
    "{actor} a remplacé ton e-mail de connexion par {newEmail}. Cette adresse ne reçoit plus de messages de RESORIXtrack. Tous les appareils ont été déconnectés.",

  "entry_corrected.subject": "{actor} a modifié ta saisie de temps",
  "entry_corrected.create": "{actor} a ajouté une saisie le {date} ({time}).",
  "entry_corrected.update": "{actor} a modifié ta saisie du {date} ({time}).",
  "entry_corrected.delete": "{actor} a supprimé ta saisie du {date} ({time}).",
  "entry_corrected.footer": "Chaque modification est journalisée. Tu peux la contester dans RESORIXtrack.",
  "entry_corrected.cta": "Voir la modification",

  "entry_disputed.subject": "{actor} conteste une correction",
  "entry_disputed.body": "{actor} conteste une modification de sa saisie du {date} :\n\n« {message} »",
  "entry_disputed.cta": "Ouvrir",

  "absence_requested.subject": "{requester} demande : {type}",
  "absence_requested.body": "{requester} demande « {type} » du {start} au {end} ({days}).",
  "absence_requested.cta": "Examiner la demande",

  "absence_reported.subject": "{requester} annonce : {type}",
  "absence_reported.body": "{requester} a annoncé « {type} » du {start} au {end} ({days}).",
  "absence_reported.cta": "Ouvrir l'équipe",

  "absence_recorded.subject": "{actor} a saisi une absence pour toi",
  "absence_recorded.body": "{actor} a saisi « {type} » pour toi du {start} au {end} ({days}).",
  "absence_recorded.attachments": "Tu peux déposer un certificat médical dans RESORIXtrack (facultatif).",
  "absence_recorded.cta": "Voir les absences",

  "absence_approved.subject": "{type} approuvé",
  "absence_approved.body": "{actor} a approuvé « {type} » du {start} au {end} ({days}).",
  "absence_approved.cta": "Voir les absences",

  "absence_rejected.subject": "{type} refusé",
  "absence_rejected.body": "{actor} a refusé ta demande « {type} » du {start} au {end}.",
  "absence_rejected.cta": "Voir les absences",

  "absence_cancelled.subject": "{type} annulé",
  "absence_cancelled.body": "{actor} a annulé « {type} » du {start} au {end}.",
  "absence_cancelled.cta": "Voir les absences",
  "absence_changed.subject": "{type} modifié",
  "absence_changed.body": "{actor} a modifié « {type} » : du {start} au {end}.",
  "absence_changed.cta": "Voir les absences",

  "clock_reminder.subject": "Toujours au travail ?",
  "clock_reminder.body": "Tu pointes depuis {time} le {date}, plus de {hours} heures. Oublié de dépointer ?",
  "clock_reminder.cta": "Ouvrir RESORIXtrack",

  "test.subject": "E-mail de test RESORIXtrack",
  "test.body": "Le SMTP fonctionne : cet e-mail de test de RESORIXtrack est bien arrivé.",

  "month_signed_off.subject": "{month} clôturé",
  "month_signed_off.body": "{actor} a clôturé ton temps de travail pour {month}. Le mois ne peut plus être modifié.",
  "month_signed_off.cta": "Voir le rapport",

  "mfa_reset.subject": "Authentification à deux facteurs réinitialisée",
  "mfa_reset.body":
    "{actor} a réinitialisé l'authentification à deux facteurs de ton compte. Configure-la à nouveau sous Profil.",
  "mfa_reset.cta": "Ouvrir le profil",
}

export const it: MailStrings = {
  "common.hello": "Ciao {name},",
  "common.note": "Nota: {note}",
  "common.reason": "Motivo: {reason}",
  "common.days_one": "{count} giorno lavorativo",
  "common.days_other": "{count} giorni lavorativi",
  "common.someone": "L'amministrazione",
  "common.ignore": "Non te l'aspettavi? Contatta l'amministrazione.",

  "type.vacation": "Vacanze",
  "type.sick": "Malattia",
  "type.accident": "Infortunio",
  "type.child_sick": "Cura di un figlio malato",
  "type.military": "Servizio militare / civile",
  "type.training": "Formazione",
  "type.comp_time": "Compensazione",
  "type.special": "Congedo speciale",
  "type.unpaid": "Congedo non pagato",

  "invite.subject": "Il tuo account RESORIXtrack",
  "invite.body":
    "{actor} ha creato per te un account RESORIXtrack presso {company}. Scegli la tua password entro {days} giorni.\n\nLa tua e-mail di accesso: {email}",
  "invite.cta": "Imposta password",

  "password_reset.subject": "Reimposta la password",
  "password_reset.body":
    "Usa il link entro {minutes} minuti per scegliere una nuova password.\n\nNon l'hai richiesto? Ignora questa e-mail: la tua password resta invariata.",
  "password_reset.cta": "Scegli nuova password",

  "passkey_added.subject": "Una passkey è stata aggiunta al tuo account",
  "passkey_added.body":
    "Al tuo account RESORIXtrack è stata aggiunta una nuova passkey. Ti fa accedere senza password né codice a due fattori.\n\nNon sei stato tu? Rimuovila in Profilo → Passkey, cambia la password e avvisa il tuo amministratore.",

  "password_changed.subject": "La tua password è stata modificata",
  "password_changed.body":
    "La tua password RESORIXtrack è stata modificata. Gli altri dispositivi sono stati disconnessi.\n\nNon eri tu? Reimposta la password su {url} e informa l'amministrazione.",

  "password_set_by_admin.subject": "{actor} ha impostato una nuova password",
  "password_set_by_admin.body":
    "{actor} ha impostato una nuova password per il tuo account e tutti i tuoi dispositivi sono stati disconnessi. La ricevi direttamente da {actor}, mai via e-mail.\n\nDopo l'accesso, scegli la tua password nel Profilo.",
  "password_set_by_admin.cta": "Accedi",

  "email_changed.subject": "La tua e-mail di accesso è stata modificata",
  "email_changed.body":
    "{actor} ha cambiato la tua e-mail di accesso in {newEmail}. Questo indirizzo non riceve più messaggi da RESORIXtrack. Tutti i dispositivi sono stati disconnessi.",

  "entry_corrected.subject": "{actor} ha modificato la tua registrazione",
  "entry_corrected.create": "{actor} ha aggiunto una registrazione il {date} ({time}).",
  "entry_corrected.update": "{actor} ha modificato la tua registrazione del {date} ({time}).",
  "entry_corrected.delete": "{actor} ha eliminato la tua registrazione del {date} ({time}).",
  "entry_corrected.footer": "Ogni modifica è tracciata. Puoi contestarla in RESORIXtrack.",
  "entry_corrected.cta": "Vedi modifica",

  "entry_disputed.subject": "{actor} contesta una correzione",
  "entry_disputed.body": "{actor} non è d'accordo con una modifica alla sua registrazione del {date}:\n\n«{message}»",
  "entry_disputed.cta": "Apri",

  "absence_requested.subject": "{requester} richiede: {type}",
  "absence_requested.body": "{requester} richiede «{type}» dal {start} al {end} ({days}).",
  "absence_requested.cta": "Esamina richiesta",

  "absence_reported.subject": "{requester} segnala: {type}",
  "absence_reported.body": "{requester} ha segnalato «{type}» dal {start} al {end} ({days}).",
  "absence_reported.cta": "Apri team",

  "absence_recorded.subject": "{actor} ha registrato un'assenza per te",
  "absence_recorded.body": "{actor} ha registrato per te «{type}» dal {start} al {end} ({days}).",
  "absence_recorded.attachments": "Puoi caricare un certificato medico in RESORIXtrack (facoltativo).",
  "absence_recorded.cta": "Vedi assenze",

  "absence_approved.subject": "Assenza approvata: {type}",
  "absence_approved.body": "{actor} ha approvato «{type}» dal {start} al {end} ({days}).",
  "absence_approved.cta": "Vedi assenze",

  "absence_rejected.subject": "Assenza rifiutata: {type}",
  "absence_rejected.body": "{actor} ha rifiutato la tua richiesta «{type}» dal {start} al {end}.",
  "absence_rejected.cta": "Vedi assenze",

  "absence_cancelled.subject": "Assenza annullata: {type}",
  "absence_cancelled.body": "{actor} ha annullato «{type}» dal {start} al {end}.",
  "absence_cancelled.cta": "Vedi assenze",
  "absence_changed.subject": "Assenza modificata: {type}",
  "absence_changed.body": "{actor} ha modificato «{type}»: dal {start} al {end}.",
  "absence_changed.cta": "Vedi assenze",

  "clock_reminder.subject": "Stai ancora lavorando?",
  "clock_reminder.body":
    "Hai timbrato l'entrata alle {time} del {date}, oltre {hours} ore fa. Hai dimenticato di timbrare l'uscita?",
  "clock_reminder.cta": "Apri RESORIXtrack",

  "test.subject": "E-mail di test RESORIXtrack",
  "test.body": "SMTP funziona: questa e-mail di test di RESORIXtrack è arrivata.",

  "month_signed_off.subject": "{month} firmato",
  "month_signed_off.body":
    "{actor} ha firmato il tuo tempo di lavoro di {month}. Il mese non può più essere modificato.",
  "month_signed_off.cta": "Vedi rapporto",

  "mfa_reset.subject": "Autenticazione a due fattori reimpostata",
  "mfa_reset.body":
    "{actor} ha reimpostato l'autenticazione a due fattori del tuo account. Configurala di nuovo nel Profilo.",
  "mfa_reset.cta": "Apri profilo",
}

export const MAIL_STRINGS: Record<Locale, MailStrings> = { en, de, fr, it }
