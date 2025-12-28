// # -------------------------- IMPORT DEPENDENCIES --------------------------
// filesystem: file system operations for reading and writing files
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// logger: logging library
import { logger } from "./lib/logger/index.js";
// handlebars: template engine for HTML generation
import Handlebars from "handlebars";
// yaml: library for YAML serialization
import yaml from "js-yaml";
// helpers: helper functions for formatting currency and dates
import { eur, formatDate } from "./helpers/misc.js";
// puppeteer: headless browser for PDF generation
import puppeteer from "puppeteer";

// # -------------------------- GLOBAL VARIABLES --------------------------
// __filename: current file name
const __filename = fileURLToPath(import.meta.url);
// __dirname: current directory name
const __dirname = path.dirname(__filename);
// TPL_DIR: template directory
const TPL_DIR = path.join(__dirname, "..", "templates");
// OUT_DIR: output directory
const OUT_DIR = path.join(__dirname, "..", "out");

/** Reads a YAML file from disk and parses it into a JavaScript object.
 *
 * @param {string} p
 * Absolute or relative path to the YAML file to read.
 *
 * @returns {any}
 * The parsed YAML content as a JavaScript value (object, array, or primitive),
 * depending on the file structure.
 *
 * @throws {Error}
 * Throws if the file cannot be read or if the YAML content is invalid.
 *
 * @notes
 * - Uses synchronous file I/O (`fs.readFileSync`).
 * - Intended for configuration or build-time utilities, not hot paths.
 */
function readYaml(p) {
  const raw = fs.readFileSync(p, "utf8");
  return yaml.load(raw);
}

/** Loads and registers all Handlebars partial templates from the `partials` directory.
 *
 * This function scans the `TPL_DIR/partials` folder, reads each `.hbs` file,
 * and registers it as a Handlebars partial using the filename (without extension)
 * as the partial name.
 *
 * @returns {void}
 * This function does not return a value.
 *
 * @throws {Error}
 * Throws if the partials directory cannot be read or if a file cannot be loaded.
 *
 * @notes
 * - Uses synchronous filesystem operations (`fs.readdirSync`, `fs.readFileSync`).
 * - Intended to be executed once during application startup or build time.
 * - Assumes all files in the directory are valid Handlebars partials.
 */
function loadPartials() {
  const partialsDir = path.join(TPL_DIR, "partials");
  fs.readdirSync(partialsDir).forEach((f) => {
    const name = path.basename(f, ".hbs");
    const src = fs.readFileSync(path.join(partialsDir, f), "utf8");
    Handlebars.registerPartial(name, src);
  });
}

/** Registers custom Handlebars helper functions used in templates.
 *
 * This function binds domain-specific formatting helpers to Handlebars,
 * making them available inside all compiled templates.
 *
 * Registered helpers:
 * - `eur`: formats numeric values as Euro currency.
 * - `formatDate`: formats date values into a human-readable string.
 *
 * @returns {void}
 * This function does not return a value.
 *
 * @notes
 * - Should be called once during application or template engine initialization.
 * - Helpers must be registered before compiling or rendering templates.
 * - Assumes `eur` and `formatDate` helpers are already defined and imported.
 */
function registerHelpers() {
  Handlebars.registerHelper("eur", eur);
  Handlebars.registerHelper("formatDate", formatDate);
}

/** Builds the Handlebars rendering context for the **wine list PDF** starting from a YAML payload.
 *
 * This function adapts raw YAML data into a template-friendly structure by:
 * - Resolving **main cover** data (`main_cover`)
 * - Loading **category definitions** from `categories.yaml` (local to the YAML folder or fallback to `/data`)
 * - Grouping wine sections by **category → region → zone**
 * - Sorting wines within each zone by **producer**
 * - Producing both a nested structure (`winesByRegion / winesByZone`) and a flattened `wines` array per category
 *   (useful for *backward compatibility* in templates).
 *
 * @param {object} rawData
 * The parsed YAML object containing `meta`, `main_cover`, and `wines` sections.
 *
 * @param {string} absData
 * Absolute path of the YAML file being processed (used to resolve `categories.yaml`).
 *
 * @returns {{ ctx: object; layoutPath: string }}
 * An object containing:
 * - `ctx`: the Handlebars context (`{ meta, main_cover, categories }`)
 * - `layoutPath`: the absolute path to the Handlebars layout template (`layout.hbs`)
 *
 * @notes
 * - Category lookups are attempted using a `categories.yaml` file; missing categories are handled gracefully
 *   by generating a fallback id from the category name.
 * - Regions and zones default to `"Altre regioni"` and `"Senza zona"` when missing.
 * - Wine sorting inside each zone uses a case-insensitive comparison on `producer`.
 * - Only categories containing at least one wine are included in the final context.
 */
function buildWineListContext(rawData, absData) {
  // Supports both "main_cover" and "main_cover" in the YAML
  const main_cover = rawData.main_cover || rawData["main_cover"] || {};

  // Read the category definitions from the separate file
  // First check in the same directory as the file, then in the data/ directory
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
    logger.warn(`File categories.yaml not found in ${categoriesDefPath}`, {
      location: "src/build.js:buildWineListContext",
      categoriesDefPath: categoriesDefPath,
    });
  }

  // Create a map of categories by id for quick access
  const categoriesDefMap = new Map();
  categoriesDefinitions.forEach((catDef) => {
    categoriesDefMap.set(catDef.id, catDef);
  });

  // Array of wine sections as defined in the YAML
  const winesSections = rawData.wines || [];

  // Group by category (e.g. "Rosso", "Bianco" etc.)
  const categoriesMap = new Map();

  // For each wine section, group by category, region, and zone
  winesSections.forEach((section) => {
    // Normalize category: handle both string and array formats
    // In YAML, category can be an array like [Vini Bianchi] or a string
    let categoryName = section.category;
    if (Array.isArray(categoryName)) {
      categoryName = categoryName[0] || "Senza categoria";
    }
    categoryName = String(categoryName || "Senza categoria");

    // Normalize region: handle both string and array formats
    // In YAML, region can be an array like [Toscana] or a string
    let region = section.region;
    if (Array.isArray(region)) {
      region = region[0] || null;
    }
    region = region || null;

    const zone = section.zone || "Senza zona"; // Zone is at section level, not item level
    const items = section.items || [];

    // Get or create the category
    let category = categoriesMap.get(categoryName);
    if (!category) {
      // Look up the category definition in the categories.yaml file
      const categoryDef = categoriesDefMap.get(categoryName) || {};

      // Debug: check if the category was found
      if (!categoryDef.id) {
        logger.warn(
          `Category "${categoryName}" not found in categories.yaml`,
          {
            location: "src/build.js:buildWineListContext",
            categoryName: categoryName,
          }
        );
      }

      category = {
        id: categoryDef.id || categoryName.toLowerCase().replace(/\s+/g, "_"),
        name: categoryDef.name || categoryName,
        subtitle: categoryDef.subtitle || null,
        note: categoryDef.note || null,
        icon_path: categoryDef.icon_path || null,
        icon_alt: categoryDef.icon_alt || `${categoryName} icon`,
        winesByRegion: [], // Array of objects { region, winesByZone: [...] }
      };
      categoriesMap.set(categoryName, category);
    }

    // Group wines by region within the category
    // Check if a section already exists for this region
    let regionGroup = category.winesByRegion.find((rg) => rg.region === region);
    if (!regionGroup) {
      regionGroup = {
        region: region || "Altre regioni",
        winesByZone: [], // Array of objects { zone, wines: [...] }
      };
      category.winesByRegion.push(regionGroup);
    }

    // Group wines by zone within the region
    // Zone is defined at section level, so all items in this section share the same zone
    // Check if a section already exists for this zone
    let zoneGroup = regionGroup.winesByZone.find((zg) => zg.zone === zone);
    if (!zoneGroup) {
      zoneGroup = {
        zone: zone,
        wines: [],
      };
      regionGroup.winesByZone.push(zoneGroup);
    }

    // Add all items from this section to the zone group
    items.forEach((item) => {
      zoneGroup.wines.push({
        ...item,
        zone, // Include zone in the wine item so template can access it
        region, // so in the listing you can also show the region
        category: categoryName,
      });
    });
  });

  // Sort wines by producer within each zone
  categoriesMap.forEach((category) => {
    category.winesByRegion.forEach((regionGroup) => {
      regionGroup.winesByZone.forEach((zoneGroup) => {
        zoneGroup.wines.sort((a, b) => {
          const producerA = (a.producer || "").toLowerCase();
          const producerB = (b.producer || "").toLowerCase();
          return producerA.localeCompare(producerB);
        });
      });
    });
  });

  // Filter only categories that have at least one wine
  // And create also a flat "wines" array for backward compatibility (if necessary)
  const categoriesWithWines = Array.from(categoriesMap.values())
    .map((cat) => {
      // Calculate the total number of wines from all regions and zones
      const totalWines = cat.winesByRegion.reduce((sum, rg) => {
        return (
          sum +
          rg.winesByZone.reduce((sumZone, zg) => sumZone + zg.wines.length, 0)
        );
      }, 0);
      // Add also a flat "wines" array for backward compatibility (if necessary)
      cat.wines = cat.winesByRegion.flatMap((rg) =>
        rg.winesByZone.flatMap((zg) => zg.wines)
      );
      return cat;
    })
    .filter((cat) => cat.wines.length > 0);

  // Sort categories according to the order in categories.yaml
  // Create a map of category order from categoriesDefinitions
  const categoryOrderMap = new Map();
  categoriesDefinitions.forEach((catDef, index) => {
    categoryOrderMap.set(catDef.id, index);
  });

  // Sort categories: first by order in categories.yaml, then by name for categories not in yaml
  const categories = categoriesWithWines.sort((a, b) => {
    const orderA = categoryOrderMap.has(a.id) ? categoryOrderMap.get(a.id) : Infinity;
    const orderB = categoryOrderMap.has(b.id) ? categoryOrderMap.get(b.id) : Infinity;
    
    // If both are in categories.yaml, sort by their order
    if (orderA !== Infinity && orderB !== Infinity) {
      return orderA - orderB;
    }
    
    // If only one is in categories.yaml, it comes first
    if (orderA !== Infinity) return -1;
    if (orderB !== Infinity) return 1;
    
    // If neither is in categories.yaml, sort alphabetically by name
    return (a.name || "").localeCompare(b.name || "");
  });

  // This is the context that will go into the Handlebars template
  const ctx = {
    meta: rawData.meta || {},
    main_cover,
    categories,
  };

  // Template specific for wine list
  const layoutPath = path.join(TPL_DIR, "layout.hbs");

  return { ctx, layoutPath };
}

/** Generates a **wine list** document from a YAML source file, producing an **HTML** file and (optionally) a **PDF**.
 *
 * The function:
 * - Resolves `dataPath` to an absolute path and loads YAML via `readYaml`.
 * - Prepares Handlebars by loading partials and registering helpers.
 * - Builds a template-ready context using `buildWineListContext`.
 * - Compiles the Handlebars layout into an HTML string and writes it to disk.
 * - If `onlyHtml` is `false`, renders the HTML into a PDF using Puppeteer (A4, background printing enabled).
 *
 * @param {string} dataPath
 * Path to the input YAML file (relative or absolute).
 *
 * @param {object} [options]
 * Optional configuration object.
 *
 * @param {boolean} [options.onlyHtml=false]
 * When `true`, writes only the HTML file and skips PDF generation.
 *
 * @param {string | null} [options.outputDir=null]
 * Output directory for generated files. If provided, it is resolved to an absolute path;
 * otherwise the default `OUT_DIR` is used.
 *
 * @returns {Promise<string>}
 * Resolves with the absolute path to the generated PDF file when the HTML (and PDF, if enabled) have been written.
 * Returns the PDF path if PDF was generated, or the HTML path if onlyHtml is true.
 *
 * @throws {Error}
 * Propagates filesystem, YAML parsing, Handlebars compilation, or Puppeteer errors.
 *
 * @usage
 * ```js
 * await build("data/wine-list.yaml");
 * await build("data/wine-list.yaml", { onlyHtml: true, outputDir: "./dist/out" });
 * ```
 *
 * @notes
 * - Output naming: `${YYYY-MM-DD}_Carta-dei-Vini_${VENUE_NAME}.(html|pdf)` where `VENUE_NAME` is sanitized.
 * - PDF rendering uses `waitUntil: "networkidle0"` and `printBackground: true` for more faithful output.
 */
export async function build(
  dataPath,
  { onlyHtml = false, outputDir = null } = {}
) {
  // Use provided outputDir or default to OUT_DIR
  const finalOutputDir = outputDir ? path.resolve(outputDir) : OUT_DIR;
  if (!fs.existsSync(finalOutputDir))
    fs.mkdirSync(finalOutputDir, { recursive: true });

  // Resolve absolute path of the YAML file
  const absData = path.resolve(dataPath);
  const rawData = readYaml(absData);

  // Prepara Handlebars: load partials and register helpers
  loadPartials();
  registerHelpers();

  // Build wine list context: adapts raw YAML data into a template-friendly structure
  const { ctx, layoutPath } = buildWineListContext(rawData, absData);

  // Compile the template: compiles the Handlebars template into an HTML string
  const layoutSrc = fs.readFileSync(layoutPath, "utf8");
  const template = Handlebars.compile(layoutSrc, { noEscape: true });
  const html = template(ctx);

  // Naming file: use data and venue name
  const date = ctx.meta?.date ? new Date(ctx.meta.date) : new Date();
  const formattedDate = date.toISOString().split("T")[0];

  let venueName = ctx.main_cover?.venue_name || "carta_vini";
  venueName = venueName.replace(/[^\w\-]+/g, "_");

  // Naming file: [YYYY-MM-DD]_Carta-dei-Vini_[VENUE_NAME]
  const base = `${formattedDate}_Carta-dei-Vini_${venueName}`;

  const htmlPath = path.join(finalOutputDir, `${base}.html`);
  const pdfPath = path.join(finalOutputDir, `${base}.pdf`);

  // Save HTML file
  fs.writeFileSync(htmlPath, html, "utf8");

  if (onlyHtml) {
    // TODO: keeo or not?
    // logger.info(`HTML pronto: ${htmlPath}`, {
    //   location: "src/build.js:build",
    //   htmlPath: htmlPath,
    // });
    return htmlPath;
  }

  // Launch a headless browser and navigate to the HTML file
  const browser = await puppeteer.launch({
    args: ["--font-render-hinting=none"],
  });
  // Create a new page in the browser
  const page = await browser.newPage();
  // Navigate to the HTML file
  await page.goto("file://" + htmlPath, { waitUntil: "networkidle0" });
  // Generate the PDF
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: "20mm", right: "12mm", bottom: "18mm", left: "12mm" }, // Margini imprescindibili
  });
  // Close the browser
  await browser.close();

  // TODO: keeo or not?
  // logger.info(`PDF pronto: ${pdfPath}`, {
  //   location: "src/build.js:build",
  //   pdfPath: pdfPath,
  // });

  // Return the PDF path so callers can use it
  return pdfPath;
}

// Entry point: parse CLI arguments and run build
// Only execute when run directly, not when imported as a module
if (
  process.argv[1] === new URL(import.meta.url).pathname ||
  process.argv[1] === new URL(import.meta.url).href.replace("file://", "")
) {
  (async () => {
    const args = process.argv.slice(2);
    if (args.length === 0) {
      console.error("Uso: npm run build -- data/menu/<file>.yaml [--html]");
      process.exit(1);
    }
    const onlyHtml = args.includes("--html");
    const dataPath = args.find(
      (a) => a.endsWith(".yaml") || a.endsWith(".yml")
    );
    await build(dataPath, { onlyHtml });
  })();
}
