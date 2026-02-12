// # entrypoint CLI (node src/cli.js ...)
// CLI thin: parse argomenti (es. restaurant slug, output format, date, paths), valida input base e chiama buildWineList da src/index.js. Gestisce exit code e stampa errori user-friendly.

import main from "./index.js";

export default async function cli() {
    const start = performance.now();

    try {

        const pdfPath = await main("recoBeLAxlhrj7jvw", "appFXNhUnafY4yRM5", "patm1It1CgNgk7QGY.a5f27767877a843a0b9e04b4f9964571f6cab00bc0be51552bcfebf967f120c9");

        const elapsed = ((performance.now() - start) / 1000).toFixed(2);
        console.log(`PDF generated successfully: ${pdfPath} (${elapsed}s)`);
    } catch (error) {
        if (error.status === 408) {
        // Se status è 408, ritenta fino a 3 volte prima di fallire
        let attempts = 1;
        let maxAttempts = 3;
        let lastError = error;
        while (attempts < maxAttempts && error.status === 408) {
            console.warn(`Timeout (${error.status}), ritento (${attempts + 1}/${maxAttempts})...`);
            try {
                const pdfPath = await main("recoBeLAxlhrj7jvw", "appFXNhUnafY4yRM5", "patm1It1CgNgk7QGY.a5f27767877a843a0b9e04b4f9964571f6cab00bc0be51552bcfebf967f120c9");
                const elapsed = ((performance.now() - start) / 1000).toFixed(2);
                console.log(`PDF generated successfully: ${pdfPath} (${elapsed}s)`);
                process.exit(0);
            } catch (err) {
                lastError = err;
                attempts++;
                if (attempts >= maxAttempts || err.status !== 408) {
                    break;
                }
            }
        }
        if (lastError && lastError.status === 408) {
            console.error(`Errore timeout dopo ${maxAttempts} tentativi.`);
        }
        }
        console.error(`Error generating PDF: ${error}`);
        console.error(error.cause);
        console.error(error.details);
        console.error(error.source);
        process.exit(1);
    } 
}

cli();