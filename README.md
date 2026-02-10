# Wine QuoteKit — Sistema di Generazione Carta dei Vini

**Wine QuoteKit** è un sistema backend che genera automaticamente **carte dei vini** in formato PDF partendo da dati archiviati in Airtable. Il sistema è progettato per essere utilizzato tramite API REST e non richiede interazione diretta con il codice sorgente.

---

## 📖 Introduzione

### Cos'è questo sistema

Wine QuoteKit è un'API backend che:

- **Recupera dati** sui vini da Airtable (inventario, enoteche, zone)
- **Genera documenti YAML** strutturati con i dati della carta dei vini
- **Produce PDF** professionali in formato A4 pronti per la stampa
- **Carica automaticamente** i PDF generati su Airtable come allegati

### Problema che risolve

Il sistema automatizza la creazione di carte dei vini per enoteche e ristoranti, eliminando la necessità di:
- Creare manualmente documenti PDF
- Aggiornare le liste quando cambiano i vini disponibili
- Gestire la formattazione e l'impaginazione

### A chi è rivolto

Questo sistema è pensato per:
- **Sistemi esterni** che devono generare carte dei vini automaticamente
- **Interfacce grafiche** che chiamano l'API per produrre documenti
- **Integrazioni** con sistemi di gestione inventario basati su Airtable

**Nota**: Gli utenti finali non interagiscono direttamente con questo repository, ma utilizzano un'interfaccia che chiama l'API.

---

## 🏗️ Panoramica ad Alto Livello

### Architettura

Il sistema è composto da:

1. **Server Express** (`src/lib/api/server/server.js`)
   - Espone endpoint REST
   - Gestisce autenticazione e validazione parametri
   - Restituisce risposte JSON

2. **Handler di Generazione** (`src/generation-handler.js`)
   - Orchestra l'intero processo di generazione
   - Coordina le chiamate ad Airtable
   - Gestisce la scrittura dei file

3. **Modulo Airtable** (`src/lib/api/airtable/`)
   - Interfaccia con l'API di Airtable
   - Gestisce autenticazione, paginazione, upload file

4. **Modulo Build** (`src/build.js`)
   - Converte YAML in HTML usando template Handlebars
   - Genera PDF usando Puppeteer

5. **Modulo Wine List** (`src/lib/wineList.js`)
   - Pulisce e normalizza i dati dei vini
   - Raggruppa per categoria, regione, zona
   - Genera la struttura YAML finale

### Componenti Principali

```
┌─────────────────┐
│  Client/UI      │
│  (Esterno)      │
└────────┬────────┘
         │ HTTP POST
         ▼
┌─────────────────┐
│  Express Server │  ← Validazione parametri
│  /wine-list     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Generation      │  ← Orchestrazione
│ Handler         │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌──────────┐
│Airtable│ │  Build   │
│  API   │ │  Engine  │
└────────┘ └──────────┘
```

---

## 🔄 Come Funziona il Sistema (Flusso Concettuale)

### Ciclo di Vita di una Richiesta

1. **Ricezione Richiesta**
   - Il client invia una richiesta POST a `/wine-list` con i parametri necessari
   - Il server valida tutti i parametri (formato, presenza, tipi)

2. **Validazione Parametri**
   - Verifica che tutti i parametri obbligatori siano presenti
   - Controlla il formato degli ID Airtable (record, base, table, field)
   - Se la validazione fallisce, restituisce errore 400 con dettagli

3. **Recupero Dati Enoteca**
   - Il sistema recupera i dati dell'enoteca da Airtable usando `enotecaId`
   - Estrae: nome, logo, QR code, URL menu digitale, descrizione

4. **Filtraggio Vini**
   - Costruisce una formula di filtro Airtable: `AND({Carta dei Vini}, FIND("Nome Enoteca", ARRAYJOIN({Enoteca}, ",")) > 0)`
   - Recupera solo i vini con checkbox "Carta dei Vini" attiva e associati all'enoteca

5. **Pulizia e Normalizzazione Dati**
   - Rimuove campi non necessari
   - Normalizza valori (prezzi, zone, produttori)
   - Valida campi obbligatori vs opzionali

6. **Ordinamento**
   - Ordina i vini per: Tipologia → Regione → Zona (con priorità) → Produttore
   - Utilizza mapping delle zone per risolvere nomi e priorità

7. **Generazione YAML**
   - Crea struttura YAML con metadati (data, enoteca, categorie)
   - Raggruppa vini per categoria → regione → zona
   - Salva file YAML in `data/menu/{enoteca-id}/{data}-Carta-dei-Vini-{enoteca-id}.yaml`

8. **Generazione HTML e PDF**
   - Carica template Handlebars
   - Renderizza HTML con dati YAML
   - Usa Puppeteer per generare PDF A4 con margini ottimizzati
   - Salva PDF in `out/{data}_Carta-dei-Vini_{nome-enoteca}.pdf`

9. **Upload su Airtable**
   - Crea un nuovo record nella tabella "Wine List" di Airtable
   - Collega il record all'enoteca
   - Imposta la data
   - Carica il PDF come allegato nel campo specificato

10. **Risposta al Client**
    - Restituisce JSON con `success: true` e messaggio di conferma
    - In caso di errore, restituisce dettagli dell'errore

---

## 🌐 Utilizzo dell'API

### Modello di Interazione

Il sistema è progettato per essere chiamato via **HTTP POST** da sistemi esterni. Non è prevista interazione diretta con il codice.

### Endpoint Disponibili

#### `GET /`
**Health check**

Verifica che il server sia in esecuzione.

**Risposta:**
```json
{
  "success": true,
  "status": "ok",
  "message": "QuoteKit API is running"
}
```

#### `GET /help`
**Documentazione endpoint**

Restituisce la lista degli endpoint disponibili e la loro descrizione.

**Risposta:**
```json
{
  "success": true,
  "status": "ok",
  "message": "Available routes: ..."
}
```

#### `POST /wine-list`
**Generazione carta dei vini**

Endpoint principale per generare una carta dei vini.

**Metodo:** `POST`  
**Content-Type:** `application/json`

---

## ⚙️ Configurazione

### Variabili d'Ambiente

Il sistema supporta variabili d'ambiente come fallback per i parametri. Tutte le variabili sono **opzionali** se i parametri vengono passati nella richiesta.

#### Variabili Supportate

| Variabile | Descrizione | Formato | Obbligatoria |
|-----------|-------------|---------|--------------|
| `AIRTABLE_API_KEY` | Token di autenticazione Airtable (Personal Access Token) | `pat...` | No* |
| `AIRTABLE_AUTH_TOKEN` | Alias alternativo per il token (usato se `AIRTABLE_API_KEY` non è presente) | `pat...` | No* |
| `AIRTABLE_BASE_ID` | ID della base Airtable | `appXXXXXXXXXXXXXX` | No* |
| `AIRTABLE_INV_TAB_ID` | ID della tabella inventario vini | `tblXXXXXXXXXXXXXX` | No* |
| `AIRTABLE_WINE_LIST_TAB_ID` | ID della tabella "Wine List" dove salvare i PDF | `tblXXXXXXXXXXXXXX` | No* |
| `AIRTABLE_ENO_TAB_ID` | ID della tabella enoteche | `tblXXXXXXXXXXXXXX` | No* |
| `AIRTABLE_ENO_REC_ID_TEST` | ID record enoteca di test (solo per sviluppo) | `recXXXXXXXXXXXXXX` | No |
| `AIRTABLE_OUT_TAB_ID` | ID della tabella output (stesso di `AIRTABLE_WINE_LIST_TAB_ID`) | `tblXXXXXXXXXXXXXX` | No* |
| `AIRTABLE_PDF_FIELD_ID` | ID del campo attachment per il PDF | `fldXXXXXXXXXXXXXX` | No* |
| `AIRTABLE_ZONE_TAB_ID` | ID della tabella zone geografiche | `tblXXXXXXXXXXXXXX` | No |
| `PUPPETEER_CACHE_DIR` | Directory cache per Puppeteer/Chrome | Percorso assoluto | No |
| `PUPPETEER_CHROME_BUILD_ID` | Build ID di Chrome per Puppeteer | Versione (es. `131.0.6778.204`) | No |

\* **Obbligatorie solo se non passate come parametri nella richiesta**

### File di Configurazione

Il sistema cerca un file `.env` nella root del progetto. Se non presente, utilizza solo i parametri passati nella richiesta o i valori di default.

**Esempio `.env`:**
```env
AIRTABLE_API_KEY=patXXXXXXXXXXXXXX
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
AIRTABLE_INV_TAB_ID=tblXXXXXXXXXXXXXX
AIRTABLE_WINE_LIST_TAB_ID=tblXXXXXXXXXXXXXX
AIRTABLE_ENO_TAB_ID=tblXXXXXXXXXXXXXX
AIRTABLE_OUT_TAB_ID=tblXXXXXXXXXXXXXX
AIRTABLE_PDF_FIELD_ID=fldXXXXXXXXXXXXXX
AIRTABLE_ZONE_TAB_ID=tblXXXXXXXXXXXXXX
```

### Configurazione Airtable

Il sistema si aspetta che Airtable contenga:

1. **Tabella Inventario Vini**
   - Campo checkbox `Carta dei Vini` (obbligatorio)
   - Campo link `Enoteca` (obbligatorio)
   - Campi vino: `Vino + Annata`, `Produttore`, `Tipologia`, `Regione`, `Zona`, `Prezzo In Carta Testo`
   - Campi opzionali: `Lista Vitigni AI`, `Luogo di Produzione`, `Affinamento AI`, `Alcolicità AI`

2. **Tabella Enoteche**
   - Campo `Nome` (obbligatorio)
   - Campo `Introduzione` (descrizione)
   - Campo attachment `Logo`
   - Campo attachment `QR Code`
   - Campo `URL Menu Digitale`

3. **Tabella Wine List** (Output)
   - Campo link `Enoteca` (obbligatorio)
   - Campo data `Data` (obbligatorio)
   - Campo attachment `PDF Carta dei Vini` (obbligatorio)

4. **Tabella Zone** (Opzionale)
   - Campo `Nome Zona` o `Zona` o `Nome`
   - Campo `Regione`
   - Campo `Nazione`
   - Campo `Priorità Zone` o `Priorità Zona` (numerico)

---

## 📋 Parametri Richiesti

Tutti i parametri devono essere passati nel body della richiesta POST come JSON.

### `enotecaId` (Obbligatorio)

**Tipo:** `string`  
**Formato:** `rec` seguito da 14 caratteri alfanumerici  
**Esempio:** `"recABC1234567890"`  
**Descrizione:** ID del record Airtable dell'enoteca per cui generare la carta dei vini.

**Validazione:**
- Deve corrispondere al pattern: `/^rec[a-zA-Z0-9]{14}$/`
- Se mancante o formato errato, la richiesta viene rifiutata con errore 400

### `access_token` (Obbligatorio)

**Tipo:** `string`  
**Formato:** Personal Access Token di Airtable (inizia con `pat`)  
**Esempio:** `"patm1It1CgNgk7QGY.abc123..."`  
**Descrizione:** Token di autenticazione per accedere all'API Airtable.

**Note:**
- Se omesso, il sistema tenta di usare `AIRTABLE_API_KEY` o `AIRTABLE_AUTH_TOKEN` dalle variabili d'ambiente
- Se anche queste mancano, la richiesta fallisce

### `base_id` (Obbligatorio)

**Tipo:** `string`  
**Formato:** `app` seguito da 14 caratteri alfanumerici  
**Esempio:** `"appFXNhUnafY4yRM5"`  
**Descrizione:** ID della base Airtable che contiene le tabelle.

**Validazione:**
- Deve corrispondere al pattern: `/^app[a-zA-Z0-9]{14}$/`
- Se omesso, usa `AIRTABLE_BASE_ID` dalle variabili d'ambiente

### `table_id` (Obbligatorio)

**Tipo:** `string`  
**Formato:** `tbl` seguito da 14 caratteri alfanumerici  
**Esempio:** `"tbl3pqIm4XZBf65Fp"`  
**Descrizione:** ID della tabella Airtable che contiene l'inventario dei vini.

**Validazione:**
- Deve corrispondere al pattern: `/^tbl[a-zA-Z0-9]{14}$/`
- Se omesso, usa `AIRTABLE_INV_TAB_ID` dalle variabili d'ambiente

### `wine_list_tab_id` (Obbligatorio)

**Tipo:** `string`  
**Formato:** `tbl` seguito da 14 caratteri alfanumerici  
**Esempio:** `"tbl3pqIm4XZBf65Fp"`  
**Descrizione:** ID della tabella Airtable dove salvare i record delle carte dei vini generate.

**Validazione:**
- Deve corrispondere al pattern: `/^tbl[a-zA-Z0-9]{14}$/`
- Se omesso, usa `AIRTABLE_WINE_LIST_TAB_ID` dalle variabili d'ambiente

### `enoteca_table_id` (Obbligatorio)

**Tipo:** `string`  
**Formato:** `tbl` seguito da 14 caratteri alfanumerici  
**Esempio:** `"tblXYZ9876543210"`  
**Descrizione:** ID della tabella Airtable che contiene i record delle enoteche.

**Validazione:**
- Deve corrispondere al pattern: `/^tbl[a-zA-Z0-9]{14}$/`
- Se omesso, usa `AIRTABLE_ENO_TAB_ID` dalle variabili d'ambiente

### `out_tab_id` (Obbligatorio)

**Tipo:** `string`  
**Formato:** `tbl` seguito da 14 caratteri alfanumerici  
**Esempio:** `"tbl3pqIm4XZBf65Fp"`  
**Descrizione:** ID della tabella Airtable dove salvare l'output (generalmente uguale a `wine_list_tab_id`).

**Validazione:**
- Deve corrispondere al pattern: `/^tbl[a-zA-Z0-9]{14}$/`
- Se omesso, usa `AIRTABLE_OUT_TAB_ID` dalle variabili d'ambiente

### `out_field_id` (Obbligatorio)

**Tipo:** `string`  
**Formato:** `fld` seguito da caratteri alfanumerici  
**Esempio:** `"fldzJAZ8ffCr4NMLO"`  
**Descrizione:** ID del campo attachment nella tabella output dove caricare il PDF generato.

**Validazione:**
- Deve corrispondere al pattern: `/^fld[a-zA-Z0-9]+$/`
- Se mancante o formato errato, la richiesta viene rifiutata con errore 400

---

## 🔧 Parametri Opzionali

Il sistema non accetta parametri opzionali nella richiesta. Tutti i parametri devono essere forniti esplicitamente o tramite variabili d'ambiente.

**Nota:** Se alcuni parametri non vengono passati nella richiesta, il sistema tenta di recuperarli dalle variabili d'ambiente. Se anche queste mancano, la richiesta fallisce.

---

## 📝 Esempi di Richiesta

### Esempio Base

```bash
curl -X POST http://localhost:3000/wine-list \
  -H "Content-Type: application/json" \
  -d '{
    "enotecaId": "recABC1234567890",
    "access_token": "patm1It1CgNgk7QGY.abc123...",
    "base_id": "appFXNhUnafY4yRM5",
    "table_id": "tbl3pqIm4XZBf65Fp",
    "wine_list_tab_id": "tbl3pqIm4XZBf65Fp",
    "enoteca_table_id": "tblXYZ9876543210",
    "out_tab_id": "tbl3pqIm4XZBf65Fp",
    "out_field_id": "fldzJAZ8ffCr4NMLO"
  }'
```

### Esempio con JavaScript (Fetch API)

```javascript
const response = await fetch('http://localhost:3000/wine-list', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    enotecaId: 'recABC1234567890',
    access_token: 'patm1It1CgNgk7QGY.abc123...',
    base_id: 'appFXNhUnafY4yRM5',
    table_id: 'tbl3pqIm4XZBf65Fp',
    wine_list_tab_id: 'tbl3pqIm4XZBf65Fp',
    enoteca_table_id: 'tblXYZ9876543210',
    out_tab_id: 'tbl3pqIm4XZBf65Fp',
    out_field_id: 'fldzJAZ8ffCr4NMLO'
  })
});

const result = await response.json();
console.log(result);
```

### Esempio con Python (requests)

```python
import requests

url = "http://localhost:3000/wine-list"
payload = {
    "enotecaId": "recABC1234567890",
    "access_token": "patm1It1CgNgk7QGY.abc123...",
    "base_id": "appFXNhUnafY4yRM5",
    "table_id": "tbl3pqIm4XZBf65Fp",
    "wine_list_tab_id": "tbl3pqIm4XZBf65Fp",
    "enoteca_table_id": "tblXYZ9876543210",
    "out_tab_id": "tbl3pqIm4XZBf65Fp",
    "out_field_id": "fldzJAZ8ffCr4NMLO"
}

response = requests.post(url, json=payload)
result = response.json()
print(result)
```

---

## 📤 Output e Risultati

### Risposta di Successo

Quando la generazione viene completata con successo, il sistema restituisce:

**Status Code:** `200 OK`

**Body:**
```json
{
  "success": true,
  "message": "PDF generation started"
}
```

**Nota:** Il messaggio indica che la generazione è stata avviata. Il processo è asincrono e il PDF viene generato e caricato su Airtable in background.

### File Generati

Il sistema genera i seguenti file durante l'esecuzione:

1. **File YAML** (temporaneo, per debug)
   - **Percorso:** `data/menu/{enoteca-id}/{YYYY-MM-DD} - Carta dei Vini - {enoteca-id}.yaml`
   - **Formato:** YAML strutturato con metadati e lista vini
   - **Scopo:** Intermedio, utilizzato per generare HTML/PDF

2. **File HTML** (temporaneo, per debug)
   - **Percorso:** `out/{YYYY-MM-DD}_Carta-dei-Vini_{nome-enoteca}.html`
   - **Formato:** HTML renderizzato con template Handlebars
   - **Scopo:** Intermedio, utilizzato per generare PDF

3. **File PDF** (output finale)
   - **Percorso:** `out/{YYYY-MM-DD}_Carta-dei-Vini_{nome-enoteca}.pdf`
   - **Formato:** PDF A4 con margini ottimizzati (20mm top, 12mm sides, 18mm bottom)
   - **Scopo:** Documento finale caricato su Airtable

### Record Airtable Creato

Il sistema crea un nuovo record nella tabella "Wine List" con:

- **Campo `Enoteca`:** Link al record dell'enoteca (array con `enotecaId`)
- **Campo `Data`:** Data di generazione in formato ISO 8601
- **Campo `PDF Carta dei Vini`:** Allegato PDF generato

**Nota:** Il campo `Carta dei Vini` è un campo calcolato/linkato e viene popolato automaticamente da Airtable.

---

## ⚠️ Gestione degli Errori

### Errori di Validazione Parametri (400 Bad Request)

Quando uno o più parametri non sono validi, il sistema restituisce:

**Status Code:** `400 Bad Request`

**Body:**
```json
{
  "success": false,
  "message": "Invalid parameters",
  "paramError": {
    "enotecaId": "Missing `enotecaId` parameter",
    "base_id": "Invalid `base_id` parameter: must match /^app[a-zA-Z0-9]{14}$/",
    ...
  },
  "location": "src/lib/api/server/worker.js:wineListController"
}
```

**Campi `paramError`:**
- Ogni chiave corrisponde a un parametro non valido
- Il valore descrive l'errore specifico

### Errori di Elaborazione (500 Internal Server Error)

Quando si verifica un errore durante l'elaborazione, il sistema restituisce:

**Status Code:** `500 Internal Server Error`

**Body:**
```json
{
  "success": false,
  "message": "Error during PDF generation",
  "error": "Error message here",
  "location": "src/lib/api/server/worker.js:wineListController",
  "source": "src/generation-handler.js:startGeneration"
}
```

### Categorie di Errori Comuni

1. **Errori di Autenticazione Airtable**
   - Token non valido o scaduto
   - Permessi insufficienti sulla base Airtable
   - **Sintomo:** Errore 401/403 da Airtable API

2. **Errori di Record Non Trovato**
   - `enotecaId` non esiste in Airtable
   - Tabella non trovata
   - **Sintomo:** Errore 404 da Airtable API

3. **Errori di Dati Mancanti**
   - Nessun vino trovato con filtro "Carta dei Vini" per l'enoteca
   - Campi obbligatori mancanti nei record vino
   - **Sintomo:** Errore durante validazione/normalizzazione

4. **Errori di Generazione PDF**
   - Puppeteer non riesce a generare PDF
   - Template Handlebars non trovato
   - **Sintomo:** Errore durante build/rendering

5. **Errori di Upload Airtable**
   - Upload del PDF fallisce
   - Campo attachment non valido
   - **Sintomo:** Errore durante `loadWineListToAirtable`

### Come Interpretare gli Errori

- **`location`:** Indica il file e la funzione dove si è verificato l'errore
- **`source`:** Indica la fonte originale dell'errore (se disponibile)
- **`error`:** Messaggio descrittivo dell'errore
- **`paramError`:** Dettagli specifici sugli errori di validazione

**Raccomandazione:** Controllare sempre il campo `location` e `source` per identificare dove si è verificato il problema.

---

## 📌 Note Operative

### Vincoli e Limitazioni

1. **Formato ID Airtable**
   - Tutti gli ID devono rispettare i formati specifici (`rec...`, `app...`, `tbl...`, `fld...`)
   - Il sistema valida rigorosamente questi formati

2. **Filtro Vini**
   - Solo i vini con checkbox `Carta dei Vini` attiva vengono inclusi
   - Solo i vini associati all'enoteca specificata vengono inclusi
   - Se nessun vino corrisponde ai criteri, la generazione può fallire o produrre un PDF vuoto

3. **Campi Obbligatori nei Record Vino**
   - I seguenti campi sono obbligatori e i record senza questi campi vengono scartati:
     - `Vino + Annata`
     - `Produttore`
     - `Zona`
     - `Prezzo In Carta Testo`
     - `Tipologia`
     - `Regione`

4. **Campi Opzionali**
   - I seguenti campi sono opzionali ma consigliati:
     - `Lista Vitigni AI`
     - `Luogo di Produzione`
     - `Affinamento AI`
     - `Alcolicità AI`
   - I record con campi opzionali mancanti vengono comunque processati ma generano warning nei log

5. **Generazione PDF**
   - Il PDF viene generato in formato A4
   - I margini sono fissi e non configurabili via API
   - Il rendering richiede Puppeteer/Chrome, che deve essere disponibile nel sistema

6. **Upload Airtable**
   - Il sistema crea sempre un nuovo record per ogni generazione
   - Non aggiorna record esistenti
   - Il PDF viene caricato come allegato nel campo specificato

### Raccomandazioni d'Uso

1. **Gestione Token**
   - Non esporre mai i token Airtable nel codice client
   - Utilizzare variabili d'ambiente o sistemi di gestione segreti
   - Ruotare i token periodicamente

2. **Gestione Errori**
   - Implementare retry logic nel client per errori temporanei
   - Loggare sempre gli errori per debugging
   - Non mostrare messaggi di errore tecnici agli utenti finali

3. **Performance**
   - La generazione può richiedere diversi secondi (dipende dal numero di vini)
   - Implementare timeout appropriati nel client (consigliato: 60-120 secondi)
   - Considerare l'implementazione di webhook o polling per notificare il completamento

4. **Validazione Dati Airtable**
   - Verificare che i dati in Airtable siano completi prima di chiamare l'API
   - Assicurarsi che almeno un vino abbia `Carta dei Vini` attiva per l'enoteca
   - Verificare che l'enoteca abbia logo, QR code e altri dati necessari

5. **Monitoraggio**
   - Controllare i log del sistema per identificare problemi
   - I log vengono salvati in `logs/` con formato `YYYY-MM-DD - wine-list-log`
   - Monitorare gli errori di Airtable API per problemi di quota o rate limiting

### Considerazioni di Sicurezza

1. **Autenticazione**
   - Il sistema non implementa autenticazione HTTP propria
   - Si affida all'autenticazione Airtable tramite token
   - **Raccomandazione:** Implementare autenticazione aggiuntiva (API key, OAuth) se esposto pubblicamente

2. **Validazione Input**
   - Il sistema valida rigorosamente i formati degli ID
   - Previene path traversal nei nomi file
   - **Nota:** Non valida il contenuto dei dati Airtable (affidarsi a Airtable)

3. **Sensibili Dati**
   - I token vengono sanitizzati nei log (mostrati parzialmente)
   - I log non contengono dati completi dei token

### Limitazioni Conosciute

1. **Processo Sincrono**
   - La richiesta HTTP rimane aperta fino al completamento della generazione
   - Per grandi volumi di dati, questo può causare timeout
   - **Workaround:** Implementare timeout lunghi nel client o processare in background

2. **Nessun Webhook**
   - Il sistema non supporta notifiche asincrone di completamento
   - Il client deve attendere la risposta HTTP

3. **Nessuna Gestione Concorrenza**
   - Richieste multiple per la stessa enoteca possono generare conflitti
   - **Raccomandazione:** Implementare rate limiting o coda di elaborazione

4. **Nessun Versioning**
   - Ogni generazione crea un nuovo record in Airtable
   - Non c'è tracciamento delle versioni precedenti

---

## 📊 Riepilogo Operativo

### Quick Reference

**Endpoint Principale:**
- `POST /wine-list` - Genera carta dei vini

**Parametri Obbligatori:**
- `enotecaId` (string, formato `rec...`)
- `access_token` (string, token Airtable)
- `base_id` (string, formato `app...`)
- `table_id` (string, formato `tbl...`)
- `wine_list_tab_id` (string, formato `tbl...`)
- `enoteca_table_id` (string, formato `tbl...`)
- `out_tab_id` (string, formato `tbl...`)
- `out_field_id` (string, formato `fld...`)

**Risposta di Successo:**
- Status: `200`
- Body: `{ "success": true, "message": "PDF generation started" }`

**Risposta di Errore:**
- Status: `400` (validazione) o `500` (elaborazione)
- Body: `{ "success": false, "message": "...", "error": "...", "paramError": {...} }`

**Output:**
- PDF generato in `out/`
- Record creato in Airtable con PDF allegato

### Flusso Operativo Tipico

1. Client prepara richiesta con tutti i parametri obbligatori
2. Client invia POST a `/wine-list`
3. Sistema valida parametri
4. Sistema recupera dati da Airtable
5. Sistema genera YAML, HTML, PDF
6. Sistema carica PDF su Airtable
7. Sistema restituisce risposta di successo
8. Client verifica `success: true` e considera operazione completata

---

## 📄 Licenza

Questo progetto è rilasciato sotto licenza MIT.
