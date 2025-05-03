const axios = require("axios");
const FormData = require("form-data");

const mindeeApiKey = process.env.MINDEE_API_KEY;

if (!mindeeApiKey) {
  console.error("Missing MINDEE_API_KEY");
  process.exit(1);
}

// Extract from passport using real Mindee endpoint
async function extractDataFromImage(imageUrl) {
  const form = new FormData();
  const response = await axios.get(imageUrl, { responseType: "stream" });
  form.append("document", response.data);

  try {
    const res = await axios.post(
      "https://api.mindee.net/v1/products/mindee/passport/v1/predict",
      form,
      {
        headers: {
          Authorization: `Token ${mindeeApiKey}`,
          ...form.getHeaders(),
        },
      }
    );

    return res.data.document.inference.prediction;
  } catch (err) {
    console.error("Mindee API error (passport):", err.message);
    throw new Error("Mindee passport extraction failed");
  }
}

// Mock vehicle document extraction
async function extractDataFromVehicleDoc(imageUrl) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        vehicle_number: { value: "MOCK-VID-1234" },
      });
    }, 1000);
  });
}

module.exports = {
  extractDataFromImage,
  extractDataFromVehicleDoc,
};