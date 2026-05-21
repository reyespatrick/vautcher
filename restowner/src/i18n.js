// restowner — internationalisation (French / German / Italian).
import { createI18n } from 'vue-i18n'

const fr = {
  lang: { fr: 'Français', de: 'Deutsch', it: 'Italiano' },
  nav: { events: 'Événements', scan: 'Scanner', history: 'Historique', approve: 'À approuver' },
  app: { tagline: 'Console restaurateur' },
  common: {
    loading: 'Chargement…', save: 'Enregistrer', cancel: 'Annuler',
    retry: 'Réessayer', loadError: 'Impossible de charger les événements.',
    signOut: 'Déconnexion'
  },
  profile: {
    title: 'Profil', textSize: 'Taille du texte', language: 'Langue',
    smaller: 'Réduire', reset: 'Normal', larger: 'Agrandir'
  },
  login: {
    title: 'Connexion', subtitle: 'Recevez un code à usage unique par e-mail.',
    email: 'Adresse e-mail', emailPlaceholder: "vous{'@'}restaurant.ch",
    sendCode: 'Recevoir le code', sending: 'Envoi…',
    codeTitle: 'Code de vérification',
    codeSentTo: 'Saisissez le code envoyé à {email}.',
    code: 'Code reçu', verify: 'Se connecter', verifying: 'Vérification…',
    changeEmail: '← Changer d’adresse',
    codeInvalid: 'Code invalide ou expiré. Réessayez.',
    deniedTitle: 'Accès refusé',
    deniedBody: 'L’adresse {email} n’est pas enregistrée comme propriétaire de restaurant.',
    useAnother: 'Utiliser une autre adresse'
  },
  dashboard: {
    title: 'Événements à venir', create: 'Créer un événement',
    empty: 'Aucun événement à venir.',
    emptyHint: 'Créez-en un pour qu’il apparaisse dans l’app cliente.'
  },
  history: {
    title: 'Historique',
    subtitle: 'Événements passés et annulés — réutilisez-les en un clic.',
    empty: 'Aucun événement passé.', duplicate: 'Dupliquer'
  },
  event: {
    edit: 'Modifier', cancel: 'Annuler',
    published: 'Publié', draft: 'Brouillon', cancelled: 'Annulé',
    pending: 'En attente', approved: 'Approuvé', refused: 'Refusé',
    allAges: 'Tous âges', ageRange: '{min}–{max} ans',
    ageMinOnly: '{min} ans et +', ageMaxOnly: 'jusqu’à {max} ans',
    confirmCancel: 'Annuler définitivement « {title} » ?'
  },
  editor: {
    newTitle: 'Nouvel événement', editTitle: 'Modifier l’événement',
    title: 'Titre', titlePlaceholder: 'Soirée dégustation…',
    description: 'Description',
    descriptionPlaceholder: 'Tout ce que le client doit savoir sur l’événement…',
    date: 'Date', time: 'Heure', timePlaceholder: '19h00',
    place: 'Lieu', placePlaceholder: 'La Terrasse',
    price: 'Prix', pricePlaceholder: '45 CHF — ou « Entrée libre »',
    visual: 'Visuel', preview: 'Aperçu', addImage: 'Ajouter',
    imageHint: 'Choisissez ici la photo affichée pour cet événement. Touchez une vignette pour la sélectionner — elle apparaît dans l’aperçu ci-dessus. Les vignettes proposées sont des exemples ; « Ajouter » téléverse votre propre photo, et le × retire une photo importée de votre bibliothèque.',
    ageTarget: 'Cibler une tranche d’âge', ageOpen: 'Ouvert à tous les âges.',
    ageMin: 'Âge min.', ageMax: 'Âge max.',
    pointsTarget: 'Cibler selon les points de fidélité',
    pointsOpen: 'Visible par tous les clients.',
    pointsMin: 'Points min.', pointsMax: 'Points max.',
    pointsHint: 'Min : récompensez vos meilleurs clients (beaucoup de points) ou incitez-les à compléter leur carte. Max : touchez vos nouveaux clients — et évitez d’attirer ceux qui sont proches de compléter leur carte et de réclamer leur récompense.',
    rebate: 'Offrir un rabais', rebateOf: 'Rabais de',
    rebateLimit: 'Limiter aux premiers inscrits',
    rebateForFirst: 'Pour les', rebateFirstSuffix: 'premiers.',
    rebateNoLimit: 'Valable pour tous les inscrits, sans limite.',
    rebateHint: 'Affiché sur l’événement dans l’app cliente.',
    save: 'Enregistrer', saving: 'Enregistrement…', createBtn: 'Créer l’événement',
    cancelEvent: 'Annuler l’événement',
    confirmCancel: 'Annuler cet événement ? Il ne sera plus visible par les clients.',
    loadFailed: 'Le chargement a échoué. Vérifiez votre connexion et réessayez.',
    loadError: 'Impossible de charger l’événement.',
    saveFailed: 'L’enregistrement a échoué. Réessayez.',
    uploadFailed: 'Échec de l’envoi de l’image. Réessayez.',
    confirmDeleteImage: 'Supprimer cette image ?'
  },
  scan: {
    title: 'Scanner',
    subtitle: 'Ajoutez un tampon de fidélité en scannant la carte Vautcher du client.',
    ready: 'Caméra prête', readyAgain: 'Prêt pour un nouveau scan',
    start: 'Démarrer le scan', startAgain: 'Scanner un autre code', stop: 'Arrêter',
    stampAdded: 'Tampon ajouté pour {name}.', stampTotal: '{n} tampon(s) au total',
    notFound: 'Client introuvable.', cameraError: 'Caméra inaccessible : {msg}'
  },
  approve: {
    title: 'Événements à approuver', empty: 'Aucun événement en attente.',
    at: 'chez', approveBtn: 'Approuver', refuseBtn: 'Refuser'
  },
  refuse: {
    title: 'Refuser l’événement',
    intro: 'Indiquez la ou les raisons du refus :',
    r1: 'Texte ou description inappropriés',
    r2: 'Image inappropriée ou de mauvaise qualité',
    r3: 'Informations incomplètes',
    r4: 'Date ou lieu incorrects',
    r5: 'Non conforme aux règles de la plateforme',
    other: 'Autre raison', otherPlaceholder: 'Précisez…',
    confirm: 'Confirmer le refus'
  }
}

const de = {
  lang: { fr: 'Français', de: 'Deutsch', it: 'Italiano' },
  nav: { events: 'Veranstaltungen', scan: 'Scannen', history: 'Verlauf', approve: 'Zu prüfen' },
  app: { tagline: 'Gastronomen-Konsole' },
  common: {
    loading: 'Wird geladen…', save: 'Speichern', cancel: 'Abbrechen',
    retry: 'Erneut versuchen', loadError: 'Veranstaltungen konnten nicht geladen werden.',
    signOut: 'Abmelden'
  },
  profile: {
    title: 'Profil', textSize: 'Textgröße', language: 'Sprache',
    smaller: 'Verkleinern', reset: 'Normal', larger: 'Vergrößern'
  },
  login: {
    title: 'Anmeldung', subtitle: 'Erhalten Sie einen Einmalcode per E-Mail.',
    email: 'E-Mail-Adresse', emailPlaceholder: "sie{'@'}restaurant.ch",
    sendCode: 'Code erhalten', sending: 'Wird gesendet…',
    codeTitle: 'Bestätigungscode',
    codeSentTo: 'Geben Sie den an {email} gesendeten Code ein.',
    code: 'Erhaltener Code', verify: 'Anmelden', verifying: 'Wird überprüft…',
    changeEmail: '← Adresse ändern',
    codeInvalid: 'Ungültiger oder abgelaufener Code. Bitte erneut versuchen.',
    deniedTitle: 'Zugriff verweigert',
    deniedBody: 'Die Adresse {email} ist nicht als Restaurantbesitzer registriert.',
    useAnother: 'Andere Adresse verwenden'
  },
  dashboard: {
    title: 'Kommende Veranstaltungen', create: 'Veranstaltung erstellen',
    empty: 'Keine kommenden Veranstaltungen.',
    emptyHint: 'Erstellen Sie eine, damit sie in der Kunden-App erscheint.'
  },
  history: {
    title: 'Verlauf',
    subtitle: 'Vergangene und abgesagte Veranstaltungen — mit einem Klick wiederverwenden.',
    empty: 'Keine vergangenen Veranstaltungen.', duplicate: 'Duplizieren'
  },
  event: {
    edit: 'Bearbeiten', cancel: 'Absagen',
    published: 'Veröffentlicht', draft: 'Entwurf', cancelled: 'Abgesagt',
    pending: 'Ausstehend', approved: 'Genehmigt', refused: 'Abgelehnt',
    allAges: 'Alle Altersgruppen', ageRange: '{min}–{max} Jahre',
    ageMinOnly: 'ab {min} Jahren', ageMaxOnly: 'bis {max} Jahre',
    confirmCancel: '« {title} » endgültig absagen?'
  },
  editor: {
    newTitle: 'Neue Veranstaltung', editTitle: 'Veranstaltung bearbeiten',
    title: 'Titel', titlePlaceholder: 'Degustationsabend…',
    description: 'Beschreibung',
    descriptionPlaceholder: 'Alles, was der Kunde über die Veranstaltung wissen muss…',
    date: 'Datum', time: 'Uhrzeit', timePlaceholder: '19:00',
    place: 'Ort', placePlaceholder: 'Die Terrasse',
    price: 'Preis', pricePlaceholder: '45 CHF — oder « Eintritt frei »',
    visual: 'Bild', preview: 'Vorschau', addImage: 'Hinzufügen',
    imageHint: 'Wählen Sie hier das Foto, das für diesen Anlass angezeigt wird. Tippen Sie auf ein Vorschaubild, um es auszuwählen — es erscheint oben in der Vorschau. Die angebotenen Bilder sind Beispiele; « Hinzufügen » lädt Ihr eigenes Foto hoch, und das × entfernt ein hochgeladenes Foto aus Ihrer Bibliothek.',
    ageTarget: 'Altersgruppe ansprechen', ageOpen: 'Für alle Altersgruppen offen.',
    ageMin: 'Mindestalter', ageMax: 'Höchstalter',
    pointsTarget: 'Nach Treuepunkten ansprechen',
    pointsOpen: 'Für alle Kunden sichtbar.',
    pointsMin: 'Punkte min.', pointsMax: 'Punkte max.',
    pointsHint: 'Min: belohnen Sie Ihre besten Kunden (viele Punkte) oder motivieren Sie sie, ihre Karte zu vervollständigen. Max: erreichen Sie neue Kunden — und vermeiden Sie es, Kunden anzuziehen, die ihre Karte fast voll haben und ihre Belohnung einlösen würden.',
    rebate: 'Rabatt anbieten', rebateOf: 'Rabatt von',
    rebateLimit: 'Auf die ersten Angemeldeten beschränken',
    rebateForFirst: 'Für die ersten', rebateFirstSuffix: 'Angemeldeten.',
    rebateNoLimit: 'Gültig für alle Angemeldeten, ohne Begrenzung.',
    rebateHint: 'Wird bei der Veranstaltung in der Kunden-App angezeigt.',
    save: 'Speichern', saving: 'Wird gespeichert…', createBtn: 'Veranstaltung erstellen',
    cancelEvent: 'Veranstaltung absagen',
    confirmCancel: 'Diese Veranstaltung absagen? Sie wird für Kunden nicht mehr sichtbar sein.',
    loadFailed: 'Laden fehlgeschlagen. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
    loadError: 'Veranstaltung konnte nicht geladen werden.',
    saveFailed: 'Speichern fehlgeschlagen. Bitte erneut versuchen.',
    uploadFailed: 'Bild-Upload fehlgeschlagen. Bitte erneut versuchen.',
    confirmDeleteImage: 'Dieses Bild löschen?'
  },
  scan: {
    title: 'Scannen',
    subtitle: 'Fügen Sie einen Treuestempel hinzu, indem Sie die Vautcher-Karte des Kunden scannen.',
    ready: 'Kamera bereit', readyAgain: 'Bereit für einen neuen Scan',
    start: 'Scan starten', startAgain: 'Weiteren Code scannen', stop: 'Stoppen',
    stampAdded: 'Stempel hinzugefügt für {name}.', stampTotal: 'Insgesamt {n} Stempel',
    notFound: 'Kunde nicht gefunden.', cameraError: 'Kamera nicht verfügbar: {msg}'
  },
  approve: {
    title: 'Zu prüfende Veranstaltungen', empty: 'Keine ausstehenden Veranstaltungen.',
    at: 'bei', approveBtn: 'Genehmigen', refuseBtn: 'Ablehnen'
  },
  refuse: {
    title: 'Veranstaltung ablehnen',
    intro: 'Geben Sie den oder die Ablehnungsgründe an:',
    r1: 'Unangemessener Text oder Beschreibung',
    r2: 'Unangemessenes oder schlechtes Bild',
    r3: 'Unvollständige Informationen',
    r4: 'Falsches Datum oder falscher Ort',
    r5: 'Verstößt gegen die Plattformregeln',
    other: 'Anderer Grund', otherPlaceholder: 'Bitte angeben…',
    confirm: 'Ablehnung bestätigen'
  }
}

const it = {
  lang: { fr: 'Français', de: 'Deutsch', it: 'Italiano' },
  nav: { events: 'Eventi', scan: 'Scansiona', history: 'Cronologia', approve: 'Da approvare' },
  app: { tagline: 'Console ristoratore' },
  common: {
    loading: 'Caricamento…', save: 'Salva', cancel: 'Annulla',
    retry: 'Riprova', loadError: 'Impossibile caricare gli eventi.',
    signOut: 'Disconnetti'
  },
  profile: {
    title: 'Profilo', textSize: 'Dimensione del testo', language: 'Lingua',
    smaller: 'Riduci', reset: 'Normale', larger: 'Ingrandisci'
  },
  login: {
    title: 'Accesso', subtitle: 'Ricevi un codice monouso via e-mail.',
    email: 'Indirizzo e-mail', emailPlaceholder: "tu{'@'}ristorante.ch",
    sendCode: 'Ricevi il codice', sending: 'Invio…',
    codeTitle: 'Codice di verifica',
    codeSentTo: 'Inserisci il codice inviato a {email}.',
    code: 'Codice ricevuto', verify: 'Accedi', verifying: 'Verifica…',
    changeEmail: '← Cambia indirizzo',
    codeInvalid: 'Codice non valido o scaduto. Riprova.',
    deniedTitle: 'Accesso negato',
    deniedBody: 'L’indirizzo {email} non è registrato come proprietario di ristorante.',
    useAnother: 'Usa un altro indirizzo'
  },
  dashboard: {
    title: 'Prossimi eventi', create: 'Crea un evento',
    empty: 'Nessun evento in programma.',
    emptyHint: 'Creane uno perché appaia nell’app cliente.'
  },
  history: {
    title: 'Cronologia',
    subtitle: 'Eventi passati e annullati — riutilizzali con un clic.',
    empty: 'Nessun evento passato.', duplicate: 'Duplica'
  },
  event: {
    edit: 'Modifica', cancel: 'Annulla',
    published: 'Pubblicato', draft: 'Bozza', cancelled: 'Annullato',
    pending: 'In attesa', approved: 'Approvato', refused: 'Rifiutato',
    allAges: 'Tutte le età', ageRange: '{min}–{max} anni',
    ageMinOnly: 'da {min} anni', ageMaxOnly: 'fino a {max} anni',
    confirmCancel: 'Annullare definitivamente « {title} »?'
  },
  editor: {
    newTitle: 'Nuovo evento', editTitle: 'Modifica evento',
    title: 'Titolo', titlePlaceholder: 'Serata degustazione…',
    description: 'Descrizione',
    descriptionPlaceholder: 'Tutto ciò che il cliente deve sapere sull’evento…',
    date: 'Data', time: 'Ora', timePlaceholder: '19:00',
    place: 'Luogo', placePlaceholder: 'La Terrazza',
    price: 'Prezzo', pricePlaceholder: '45 CHF — o « Ingresso libero »',
    visual: 'Immagine', preview: 'Anteprima', addImage: 'Aggiungi',
    imageHint: 'Scegli qui la foto mostrata per questo evento. Tocca una miniatura per selezionarla — appare nell’anteprima qui sopra. Le miniature proposte sono esempi; « Aggiungi » carica la tua foto e la × rimuove una foto caricata dalla tua libreria.',
    ageTarget: 'Targetizza una fascia d’età', ageOpen: 'Aperto a tutte le età.',
    ageMin: 'Età min.', ageMax: 'Età max.',
    pointsTarget: 'Targetizza per punti fedeltà',
    pointsOpen: 'Visibile a tutti i clienti.',
    pointsMin: 'Punti min.', pointsMax: 'Punti max.',
    pointsHint: 'Min: premia i tuoi migliori clienti (molti punti) o incoraggiali a completare la carta. Max: raggiungi i nuovi clienti — ed evita di attirare chi è vicino a completare la carta e a riscuotere la ricompensa.',
    rebate: 'Offrire uno sconto', rebateOf: 'Sconto di',
    rebateLimit: 'Limitare ai primi iscritti',
    rebateForFirst: 'Per i primi', rebateFirstSuffix: 'iscritti.',
    rebateNoLimit: 'Valido per tutti gli iscritti, senza limite.',
    rebateHint: 'Mostrato sull’evento nell’app cliente.',
    save: 'Salva', saving: 'Salvataggio…', createBtn: 'Crea l’evento',
    cancelEvent: 'Annulla l’evento',
    confirmCancel: 'Annullare questo evento? Non sarà più visibile ai clienti.',
    loadFailed: 'Caricamento non riuscito. Controlla la connessione e riprova.',
    loadError: 'Impossibile caricare l’evento.',
    saveFailed: 'Salvataggio non riuscito. Riprova.',
    uploadFailed: 'Caricamento dell’immagine non riuscito. Riprova.',
    confirmDeleteImage: 'Eliminare questa immagine?'
  },
  scan: {
    title: 'Scansiona',
    subtitle: 'Aggiungi un timbro fedeltà scansionando la carta Vautcher del cliente.',
    ready: 'Fotocamera pronta', readyAgain: 'Pronto per una nuova scansione',
    start: 'Avvia la scansione', startAgain: 'Scansiona un altro codice', stop: 'Ferma',
    stampAdded: 'Timbro aggiunto per {name}.', stampTotal: '{n} timbri in totale',
    notFound: 'Cliente non trovato.', cameraError: 'Fotocamera non disponibile: {msg}'
  },
  approve: {
    title: 'Eventi da approvare', empty: 'Nessun evento in attesa.',
    at: 'presso', approveBtn: 'Approva', refuseBtn: 'Rifiuta'
  },
  refuse: {
    title: 'Rifiuta l’evento',
    intro: 'Indica il motivo o i motivi del rifiuto:',
    r1: 'Testo o descrizione inappropriati',
    r2: 'Immagine inappropriata o di bassa qualità',
    r3: 'Informazioni incomplete',
    r4: 'Data o luogo errati',
    r5: 'Non conforme alle regole della piattaforma',
    other: 'Altro motivo', otherPlaceholder: 'Specifica…',
    confirm: 'Conferma il rifiuto'
  }
}

export const SUPPORTED_LOCALES = ['fr', 'de', 'it']

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: 'fr',
  fallbackLocale: 'fr',
  messages: { fr, de, it }
})
