// ######## DEPENDENCIES ########
import main from "./index.js"; // main function (custom): runs the full wine list pipeline from credentials to PDF uploaded on Airtable

// ######## FUNCTIONS ########

export default async function cli() {
    try {
        // runs the full wine list pipeline from credentials to PDF uploaded on Airtable
        const result = await main("recoBeLAxlhrj7jvw", "appFXNhUnafY4yRM5", "patm1It1CgNgk7QGY.a5f27767877a843a0b9e04b4f9964571f6cab00bc0be51552bcfebf967f120c9");

        if (!result.ok) {
            throw new DetailedError("Error updating record", {
                cause: result.error,
                source: "src/cli.js:cli",
                details: {
                    enotecaId: "recoBeLAxlhrj7jvw",
                }
            })
        }

        console.log(result.step_time);
        process.exit(0);
    } catch (error) {
        if (error.status === 408) {
        // if status is 408, retry up to 3 times before failing
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