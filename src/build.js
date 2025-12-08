// Import dependencies and helpers
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";
import yaml from "js-yaml";
import { mdToHtml } from "./markdown.js";
import { eur, formatDate, computeTotals } from "./helpers/misc.js";
import puppeteer from "puppeteer";

// Setup working directories and template/output paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TPL_DIR = path.join(__dirname, "..", "templates");
const OUT_DIR = path.join(__dirname, "..", "out");

// Helper to read and parse a YAML file
function readYaml(p) {
  const raw = fs.readFileSync(p, "utf8");
  return yaml.load(raw);
}

// Register Handlebars partials from the partials directory
function loadPartials() {
  const partialsDir = path.join(TPL_DIR, "partials");
  fs.readdirSync(partialsDir).forEach((f) => {
    const name = path.basename(f, ".hbs");
    const src = fs.readFileSync(path.join(partialsDir, f), "utf8");
    Handlebars.registerPartial(name, src);
  });
}

// Register custom Handlebars helpers (currency, date formatting)
function registerHelpers() {
  Handlebars.registerHelper("eur", eur);
  Handlebars.registerHelper("formatDate", formatDate);
}

// Costruisce il contesto per la CARTA DEI VINI
function buildWineListContext(rawData, absData) {
  // Supporta sia "main_cover" che "main_cover" nel YAML
  const main_cover = rawData.main_cover || rawData["main_cover"] || {};

  // Leggi le definizioni delle categorie dal file separato
  // Cerca prima nella stessa directory del file, poi nella directory data/
  const dataDir = path.dirname(absData);
  const dataRootDir = path.join(__dirname, "..", "data");
  
  let categoriesDefPath = path.join(dataDir, "categories.yaml");
  if (!fs.existsSync(categoriesDefPath)) {
    categoriesDefPath = path.join(dataRootDir, "categories.yaml");
  }
  
  let categoriesDefinitions = [];
  if (fs.existsSync(categoriesDefPath)) {
    const categoriesDefData = readYaml(categoriesDefPath);
    categoriesDefinitions = categoriesDefData.categories || [];
  } else {
    console.warn(`File categories.yaml non trovato in ${categoriesDefPath}`);
  }

  // Crea una mappa delle categorie per id per accesso rapido
  const categoriesDefMap = new Map();
  categoriesDefinitions.forEach((catDef) => {
    categoriesDefMap.set(catDef.id, catDef);
  });
  
  // Debug: mostra le categorie caricate
  if (categoriesDefinitions.length > 0) {
    console.log(`Caricate ${categoriesDefinitions.length} categorie da categories.yaml`);
  }

  // Array di sezioni vini così come da YAML
  const winesSections = rawData.wines || [];

  // Raggruppiamo per categoria (es. "Rosso", "Bianco" ecc.)
  const categoriesMap = new Map();

  winesSections.forEach((section) => {
    const categoryName = section.category || "Senza categoria";
    const region = section.region || null;
    const items = section.items || [];

    // Recupera o crea la categoria
    let category = categoriesMap.get(categoryName);
    if (!category) {
      // Cerca la definizione della categoria nel file categories.yaml
      const categoryDef = categoriesDefMap.get(categoryName) || {};
      
      // Debug: verifica se la categoria è stata trovata
      if (!categoryDef.id) {
        console.warn(`Categoria "${categoryName}" non trovata in categories.yaml`);
      }
      
      category = {
        id: categoryDef.id || categoryName.toLowerCase().replace(/\s+/g, "_"),
        name: categoryDef.name || categoryName,
        subtitle: categoryDef.subtitle || null,
        note: categoryDef.note || null,
        icon_path: categoryDef.icon_path || null,
        icon_alt: categoryDef.icon_alt || `${categoryName} icon`,
        winesByRegion: [],  // Array di oggetti { region, wines: [...] }
      };
      categoriesMap.set(categoryName, category);
    }

    // Raggruppa i vini per regione all'interno della categoria
    // Cerca se esiste già una sezione per questa regione
    let regionGroup = category.winesByRegion.find(rg => rg.region === region);
    if (!regionGroup) {
      regionGroup = {
        region: region || "Altre regioni",
        winesByAppellation: []  // Array di oggetti { appellation, wines: [...] }
      };
      category.winesByRegion.push(regionGroup);
    }

    // Raggruppa i vini per appellation all'interno della regione
    items.forEach((item) => {
      const appellation = item.appellation || "Senza denominazione";
      
      // Cerca se esiste già una sezione per questa appellation
      let appellationGroup = regionGroup.winesByAppellation.find(ag => ag.appellation === appellation);
      if (!appellationGroup) {
        appellationGroup = {
          appellation: appellation,
          wines: []
        };
        regionGroup.winesByAppellation.push(appellationGroup);
      }

      // Aggiunge il vino al gruppo dell'appellation
      appellationGroup.wines.push({
        ...item,
        region,        // così nel listing puoi anche mostrare la regione
        category: categoryName,
      });
    });
  });

  // Filtra solo le categorie che hanno almeno un vino
  // E crea anche un array "wines" piatto per retrocompatibilità (se necessario)
  const categories = Array.from(categoriesMap.values())
    .map(cat => {
      // Calcola il totale dei vini da tutte le regioni e appellations
      const totalWines = cat.winesByRegion.reduce((sum, rg) => {
        return sum + rg.winesByAppellation.reduce((sumApp, ag) => sumApp + ag.wines.length, 0);
      }, 0);
      // Aggiungi anche un array "wines" piatto per retrocompatibilità
      cat.wines = cat.winesByRegion.flatMap(rg => 
        rg.winesByAppellation.flatMap(ag => ag.wines)
      );
      return cat;
    })
    .filter(cat => cat.wines.length > 0);

  // Questo è il contesto che andrà nel template Handlebars
  const ctx = {
    meta: rawData.meta || {},
    main_cover,
    categories,
  };

  // Template specifico per carta vini
  const layoutPath = path.join(TPL_DIR, "layout.hbs");

  return { ctx, layoutPath };
}

// Costruisce il contesto per il preventivo classico
function buildQuoteContext(rawData, absData) {
  // Load and process Markdown for scope and terms (inline or file)
  const scopeSrc = rawData.scope_md_path
    ? fs.readFileSync(path.resolve(path.dirname(absData), rawData.scope_md_path), "utf8")
    : rawData.scope_md || "";
  const termsSrc = rawData.terms_md_path
    ? fs.readFileSync(path.resolve(path.dirname(absData), rawData.terms_md_path), "utf8")
    : rawData.terms_md || "";

  const scope_html = scopeSrc ? mdToHtml(scopeSrc) : "";
  const terms_html = termsSrc ? mdToHtml(termsSrc) : "";

  const itemsWithTotal = (rawData.items || []).map((it) => ({
    ...it,
    total: (Number(it.qty) || 0) * (Number(it.unit_price) || 0),
  }));
  const totals = computeTotals(itemsWithTotal, rawData.pricing || {});

  const ctx = {
    ...rawData,
    items: itemsWithTotal,
    totals,
    scope_html,
    terms_html,
  };

  const layoutPath = path.join(TPL_DIR, "layout.hbs");

  return { ctx, layoutPath };
}

// Costruisce il documento
async function build(dataPath, { onlyHtml = false } = {}) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const absData = path.resolve(dataPath);
  const rawData = readYaml(absData);

  // Prepara Handlebars
  loadPartials();
  registerHelpers();

  // 1. Determina che tipo di documento è
  //   - se ha "main_cover" o "main_cover" + "wines" -> carta vini
  //   - altrimenti treat as preventivo classico
  let ctx, layoutPath;
  let docType;

  if ((rawData["main_cover"] || rawData.main_cover) && rawData.wines) {
    docType = "wine_list";
    ({ ctx, layoutPath } = buildWineListContext(rawData, absData));
  } else {
    docType = "quote";
    ({ ctx, layoutPath } = buildQuoteContext(rawData, absData));
  }

  // 2. Compila il template giusto
  const layoutSrc = fs.readFileSync(layoutPath, "utf8");
  const template = Handlebars.compile(layoutSrc, { noEscape: true });
  const html = template(ctx);

  // 3. Naming file: differenziamo quote vs wine_list
  let base;

  if (docType === "wine_list") {
    const date = ctx.meta?.date ? new Date(ctx.meta.date) : new Date();
    const formattedDate = date.toISOString().split("T")[0];

    let venueName = ctx.main_cover?.venue_name || "carta_vini";
    venueName = venueName.replace(/[^\w\-]+/g, "_");

    base = `${formattedDate}_${venueName}`;
  } else {
    const date = rawData.meta?.date ? new Date(rawData.meta.date) : new Date();
    const formattedDate = date.toISOString().split("T")[0];

    let entityName =
      rawData.client?.company?.trim() ||
      rawData.client?.name?.trim() ||
      "unknown_customer";
    entityName = entityName.replace(/[^\w\-]+/g, "_");

    base = `${formattedDate}_${entityName}`;
  }

  const htmlPath = path.join(OUT_DIR, `${base}.html`);
  const pdfPath = path.join(OUT_DIR, `${base}.pdf`);

  fs.writeFileSync(htmlPath, html, "utf8");

  if (onlyHtml) {
    console.log(`HTML pronto: ${htmlPath}`);
    return;
  }

  const browser = await puppeteer.launch({
    args: ["--font-render-hinting=none"],
  });
  const page = await browser.newPage();
  await page.goto("file://" + htmlPath, { waitUntil: "networkidle0" });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: "20mm", right: "12mm", bottom: "18mm", left: "12mm" }, // Margini imprescindibili
  });
  await browser.close();

  console.log(`PDF pronto: ${pdfPath}`);
}


// Entry point: parse CLI arguments and run build
(async () => {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Uso: npm run build -- data/proposals/<file>.yaml [--html]");
    process.exit(1);
  }
  const onlyHtml = args.includes("--html");
  const dataPath = args.find((a) => a.endsWith(".yaml") || a.endsWith(".yml"));
  await build(dataPath, { onlyHtml });
})();
