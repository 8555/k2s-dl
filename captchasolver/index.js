import fs from "node:fs";
import child_process from "node:child_process";
import sharp from "sharp";
import express from "express";
import multer from "multer";

const PORT = 9955;
const UPLOAD_DIR = "/tmp";
const CAPTCHA_MAX_CHARS = 6;
const CAPTCHA_MIN_CHARS = 6;
const app = express();
const upload = multer({ dest: UPLOAD_DIR });

async function getCaptchaSolution(inputImgPath) {
    const bwImgPath = inputImgPath + "_bw";

    // Convert the input image to pure black/white by turning any non-near-white pixel black
    await sharp(inputImgPath)
        .threshold(253, { grayscale: true })
        .toFile(bwImgPath);

    // Run Darknet
    const outputRaw = child_process
        .execSync(
            `/app/darknet/darknet detector test data/obj.data yolov4-tiny-custom.cfg yolov4-tiny-custom_last.weights ${bwImgPath} -dont_show`,
            { cwd: "/app/darknet", stdio: ["pipe", "pipe", "ignore"] },
        )
        .toString();
    let predictions = outputRaw
        .split("\n")
        .map((line) => line.match(/^(.):\s*(\d+)%$/))
        .filter(Boolean)
        .map((match) => {
            const char = match[1];
            const confidence = match[2];
            return { char, confidence: Number(confidence) };
        });

    // Remove most unlikely predictions if more than 6 characters are detected
    while (predictions.length > CAPTCHA_MAX_CHARS) {
        const minConfidence = Math.min(...predictions.map((p) => p.confidence));
        const indexToRemove = predictions.findIndex(
            (p) => p.confidence === minConfidence,
        );
        predictions = predictions.filter((_, i) => i !== indexToRemove);
    }

    if (predictions.length < CAPTCHA_MIN_CHARS) {
        return null;
    }

    const solution = predictions.map((p) => p.char).join("");

    // Cleanup
    fs.rmSync(inputImgPath);
    fs.rmSync(bwImgPath);

    return solution;
}

app.post("/", upload.single("image"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const captchaSolution = await getCaptchaSolution(req.file.path);

    if (!captchaSolution)
        res.status(500).json({
            error: "Unable to solve provided captcha image",
        });
    else res.json({ solution: captchaSolution });
});

app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}...`);
});
