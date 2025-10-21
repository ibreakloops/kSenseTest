import axios from "axios";

const API_KEY = "ak_187451dfb5cc74e6dd9a13e1533abf8a51a8b8fc3d666a14";
const BASE_URL = "https://assessment.ksensetech.com/api";
const headers = { "x-api-key": API_KEY };

// --- FETCH PATIENTS SAFELY ---
async function fetchPatients() {
    let allPatients = [];
    let page = 1;
    let hasNext = true;

    while (hasNext) {
        try {
            const res = await axios.get(`${BASE_URL}/patients?page=${page}&limit=5`, { headers });

            // safely extract fields with fallbacks
            const data = res.data?.data || [];
            const pagination = res.data?.pagination || {};

            if (!Array.isArray(data) || data.length === 0) {
                console.warn(`⚠️ No data found on page ${page}, stopping fetch.`);
                break;
            }

            allPatients = allPatients.concat(data);

            hasNext = Boolean(pagination.hasNext);
            page++;

            // avoid hitting rate limits
            await new Promise((r) => setTimeout(r, 300));
        } catch (err) {
            const status = err.response?.status;
            if ([429, 500, 503].includes(status)) {
                console.warn(`Retrying page ${page} after error ${status}...`);
                await new Promise((r) => setTimeout(r, 1500));
            } else {
                console.error("Fetch error:", err.message);
                break;
            }
        }
    }

    console.log(`Fetched ${allPatients.length} patients`);
    return allPatients;
}

// --- HELPERS ---

function parseBloodPressure(bpStr) {
    if (!bpStr || typeof bpStr !== "string" || !bpStr.includes("/")) return null;
    const [systolicStr, diastolicStr] = bpStr.split("/");
    const systolic = parseInt(systolicStr);
    const diastolic = parseInt(diastolicStr);
    if (isNaN(systolic) || isNaN(diastolic)) return null;
    return { systolic, diastolic };
}

function getBloodPressureRisk(bp) {
    if (!bp) return 0;
    const { systolic, diastolic } = bp;

    if (systolic < 120 && diastolic < 80) return 1;
    if (systolic >= 120 && systolic <= 129 && diastolic < 80) return 2;
    if ((systolic >= 130 && systolic <= 139) || (diastolic >= 80 && diastolic <= 89)) return 3;
    if (systolic >= 140 || diastolic >= 90) return 4;
    return 0;
}

function getTemperatureRisk(temp) {
    if (typeof temp !== "number" || isNaN(temp)) return 0;
    if (temp <= 99.5) return 0;
    if (temp >= 99.6 && temp <= 100.9) return 1;
    if (temp >= 101) return 2;
    return 0;
}

function getAgeRisk(age) {
    if (typeof age !== "number" || isNaN(age)) return 0;
    if (age < 40) return 1;
    if (age <= 65) return 1;
    if (age > 65) return 2;
    return 0;
}

function hasDataQualityIssue(p) {
    const bp = parseBloodPressure(p?.blood_pressure);
    const ageValid = typeof p?.age === "number" && !isNaN(p.age);
    const tempValid = typeof p?.temperature === "number" && !isNaN(p.temperature);
    return !bp || !ageValid || !tempValid;
}

// --- MAIN PROCESSING ---

async function processPatients() {
    const patients = await fetchPatients();

    const highRiskPatients = [];
    const feverPatients = [];
    const dataQualityIssues = [];

    for (const p of patients) {
        if (!p || typeof p !== "object") {
            console.warn("Skipping invalid patient:", p);
            continue;
        }

        const bp = parseBloodPressure(p.blood_pressure);
        const bpRisk = getBloodPressureRisk(bp);
        const tempRisk = getTemperatureRisk(p.temperature);
        const ageRisk = getAgeRisk(p.age);
        const totalRisk = bpRisk + tempRisk + ageRisk;

        if (hasDataQualityIssue(p)) dataQualityIssues.push(p.patient_id);
        if (p.temperature >= 99.6) feverPatients.push(p.patient_id);
        if (totalRisk >= 4) highRiskPatients.push(p.patient_id);
    }

    return { highRiskPatients, feverPatients, dataQualityIssues };
}

// --- SUBMIT RESULTS ---

async function submitResults() {
    const { highRiskPatients, feverPatients, dataQualityIssues } = await processPatients();

    console.log("Submitting results...");
    try {
        const res = await axios.post(
            `${BASE_URL}/submit-assessment`,
            {
                high_risk_patients: highRiskPatients,
                fever_patients: feverPatients,
                data_quality_issues: dataQualityIssues,
            },
            { headers }
        );
        console.log("✅ Submission Response:");
        console.log(JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.error("❌ Submission failed:", err.response?.data || err.message);
    }
}

submitResults();
