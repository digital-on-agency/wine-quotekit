// Test script for uploadRecordWithAttachment function
import dotenv from "dotenv";
import { uploadRecordWithAttachment } from "./src/lib/api/airtable/airtableApi.js";
import path from "node:path";

// Load environment variables
dotenv.config();

async function testUpload() {
  try {
    console.log("🧪 Testing uploadRecordWithAttachment function...\n");

    // Use values from environment or from the log file
    const token = process.env.AIRTABLE_AUTH_TOKEN || "patm1It1CgNgk7QGY.a5f27767877a843a0b9e04b4f9964571f6cab00bc0be51552bcfebf967f120c9";
    const baseId = process.env.AIRTABLE_BASE_ID || "appFXNhUnafY4yRM5";
    const tableIdOrName = process.env.AIRTABLE_WINE_LIST_TAB_ID || "tbl3pqIm4XZBf65Fp";
    const attachmentFieldIdOrName = "fldzJAZ8ffCr4NMLO";
    
    // Use an existing PDF file for testing
    const pdfPath = path.join(process.cwd(), "out", "2025-12-28_Carta-dei-Vini_Porgi_l_Altra_Pancia.pdf");
    
    // Test fields
    const fields = {
      Enoteca: ["recoBeLAxlhrj7jvw"],
      Data: new Date().toISOString(),
    };

    if (!token) {
      throw new Error("AIRTABLE_API_KEY or AIRTABLE_AUTH_TOKEN environment variable is required");
    }

    console.log("📋 Test parameters:");
    console.log(`   Base ID: ${baseId}`);
    console.log(`   Table: ${tableIdOrName}`);
    console.log(`   Attachment Field: ${attachmentFieldIdOrName}`);
    console.log(`   PDF Path: ${pdfPath}`);
    console.log(`   Fields: ${JSON.stringify(fields, null, 2)}\n`);

    console.log("🚀 Starting upload...\n");

    const result = await uploadRecordWithAttachment({
      token,
      baseId,
      tableIdOrName,
      fields,
      attachmentFieldIdOrName,
      filePath: pdfPath,
      filename: `test-upload-${Date.now()}.pdf`,
    });

    console.log("\n✅ Upload successful!");
    console.log(`   Record ID: ${result.id}`);
    console.log(`   Created Time: ${result.createdTime}`);
    if (result.fields && result.fields[attachmentFieldIdOrName]) {
      const attachments = result.fields[attachmentFieldIdOrName];
      console.log(`   Attachments: ${attachments.length} file(s)`);
      attachments.forEach((att, idx) => {
        console.log(`     ${idx + 1}. ${att.filename || att.url}`);
      });
    }
    
    return result;
  } catch (error) {
    console.error("\n❌ Upload failed!");
    console.error(`   Error: ${error.message}`);
    if (error.status) {
      console.error(`   Status: ${error.status} ${error.statusText || ""}`);
    }
    if (error.cause) {
      console.error(`   Cause: ${error.cause.message}`);
    }
    throw error;
  }
}

// Run the test
testUpload()
  .then(() => {
    console.log("\n✨ Test completed successfully!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n💥 Test failed!");
    process.exit(1);
  });

