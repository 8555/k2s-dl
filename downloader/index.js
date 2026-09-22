import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import prettyBytes from "pretty-bytes";

const LINKS_FILE = "/links.txt"; // File containing the links of the files to download, separated by newlines
const TMP_DIR = "/output/tmp"; // Where to store unfinished downloads and captcha images temporarily
const OUTPUT_DIR = "/output"; // Where to store the downloaded files once completed
const CAPTCHA_SOLVER_URL = "http://localhost:9955/";
const API_BASE_URL = "https://keep2share.cc/api/v2/";
const HOUR_MS = 60 * 60 * 1000;

const links = fs
    .readFileSync(LINKS_FILE, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

workerThread(4);
workerThread(6);

async function workerThread(ipVer = 4) {
    function log(msg) {
        const prefix = `[IPv${ipVer}]`;
        const timestamp = new Date().toLocaleTimeString("en-GB");

        console.log(`${timestamp} ${prefix} ${msg}`);
    }

    async function apiRequest(apiFunction, data = null) {
        const url = API_BASE_URL + apiFunction;

        const options = {
            family: ipVer,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            validateStatus: false,
            data: data ? JSON.stringify(data) : "{}",
        };

        let response;
        while (!response) {
            try {
                response = await axios.request(url, options);
            } catch (error) {
                log(`⚠️ API request failed (${error.code}), retrying`);
                await sleep(5000);
            }
        }

        return response.data;
    }

    async function downloadFile(url, filePath, forceIPv4 = false, tryResume = false) {
        const options = {
            family: forceIPv4 ? 4 : ipVer,
            method: "GET",
            responseType: "stream",
            headers: {
                Accept: "*/*",
            },
        };

        let startByte = 0;
        if (tryResume && fs.existsSync(filePath)) {
            startByte = fs.statSync(filePath).size;
            options.headers.Range = `bytes=${startByte}-`;
        }

        try {
            const response = await axios.request(url, options);
            const writer = fs.createWriteStream(filePath, { flags: tryResume && response.status === 206 ? "a" : "w" });

            await new Promise((resolve, reject) => {
                const fail = (error) => {
                    // Close the write stream
                    writer.close();
                    reject(error);
                };

                response.data.pipe(writer);
                writer.on("finish", resolve);
                writer.on("error", fail);
                response.data.on("error", fail);
            });
        } catch (error) {
            switch (error.code) {
                case "ECONNRESET":
                    log("⚠️ Connection to server interrupted, retrying");
                    return downloadFile(url, filePath, forceIPv4, true);
                default:
                    throw error;
            }
        }
    }

    async function getCaptchaSolution(img) {
        const formData = new FormData();
        formData.append("image", new Blob([fs.readFileSync(img)]));

        const response = await axios.request(CAPTCHA_SOLVER_URL, { method: "POST", data: formData });

        return response.data.solution;
    }

    while (true) {
        // Start by getting the first link, removing it from the global array
        const link = links.shift();
        if (!link) return;

        log(`Starting to process '${link}'`);

        // Extract the file ID from the URL
        const fileID = link.match(/k2s\.cc\/file\/(.{13})/)[1];
        if (!fileID) {
            log(`⚠️ Failed to extract file ID from link '${link}', skipping`);
            continue;
        }

        // Get the file info
        const fileInfo = await apiRequest("getFileStatus", { id: fileID });
        const fileName = fileInfo.name;
        const fileSize = fileInfo.size;

        if (fileInfo.status === "error") {
            log(`⚠️ Error getting file info: ${fileInfo.message}, skipping`);
            continue;
        } else if (!fileName || !fileSize) {
            log("⚠️ Failed to parse file info from API response, skipping");
            continue;
        }

        log(`ℹ️ Got file info, name: ${fileName}, size: ${prettyBytes(fileSize)}`);

        const tmpFilePath = path.join(TMP_DIR, fileID);
        const finishedFilePath = path.join(OUTPUT_DIR, fileName);

        // Check if the file already exists
        if (fs.existsSync(finishedFilePath)) {
            if (fs.statSync(finishedFilePath).size === fileSize) {
                log("File already exists with the correct size, skipping");
                continue;
            } else {
                log("⚠️ File already exists but with an incorrect size, deleting");
                fs.rmSync(finishedFilePath);
            }
        }

        let downloadKey = "";

        while (true) {
            // Request & download the captcha
            log("Requesting captcha");

            const captcha = await apiRequest("requestCaptcha");
            const captchaID = captcha.challenge;
            const captchaURL = captcha.captcha_url;

            if (!captchaID || !captchaURL) {
                log(`❌ Failed to parse API response: ${captcha}`);
                return;
            }

            const captchaImgName = `captcha_${captchaID}.png`;
            const captchaImgPath = path.join(TMP_DIR, captchaImgName);

            try {
                await downloadFile(captchaURL, captchaImgPath);
            } catch (error) {
                log(`❌ Captcha image download failed (${error.code})`);
                return;
            }

            log("Requesting captcha solution");

            let captchaSolution;

            try {
                captchaSolution = await getCaptchaSolution(captchaImgPath);
            } catch (error) {
                log("Failed to get captcha solution, retrying");
                continue;
            } finally {
                if (fs.existsSync(captchaImgPath)) fs.rmSync(captchaImgPath);
            }

            log(`Got captcha solution: ${captchaSolution}`);

            const stage1 = await apiRequest("getUrl", { file_id: fileID, captcha_challenge: captchaID, captcha_response: captchaSolution });

            if (stage1.url) {
                // We got the download URL immediately, likely because we solved the captcha earlier already
                break;
            } else if (stage1.errorCode === 31 || stage1.message === "Invalid captcha code") {
                log("Captcha solution was incorrect, retrying");
                continue;
            } else if (stage1.errorCode === 21) {
                // File not available, likely because we exceeded the daily traffic limit
                log(`Download not available: ${stage1.errors[0].message}, retrying in 2 hours`);
                await sleep(HOUR_MS * 2);
                continue;
            } else if (stage1.time_wait > 120) {
                // We are on cooldown still, wait and request a new captcha after it expires
                log(`On cooldown for another ${stage1.time_wait} seconds, waiting`);
                await sleep(stage1.time_wait * 1000);
                continue;
            } else if (stage1.status !== "success" || !stage1.free_download_key) {
                // Unknown error
                log(`❌ Failed to parse API response: ${JSON.stringify(stage1)}`);
                return;
            }

            // Success
            log(`⏳ Captcha accepted, waiting ${stage1.time_wait} seconds`);
            downloadKey = stage1.free_download_key;
            await sleep(stage1.time_wait * 1000);
            break;
        }

        const stage2 = await apiRequest("getUrl", { file_id: fileID, free_download_key: downloadKey });
        const downloadURL = stage2.url;

        if (!downloadURL) {
            log(`❌ Failed to parse API response: ${JSON.stringify(stage2)}`);
            return;
        }

        if (fs.existsSync(tmpFilePath)) {
            log(`Deleting partially downloaded file`);
            fs.rmSync(tmpFilePath);
        }

        log(`➡️ Starting download of '${fileName}'`);

        // Always download via IPv4, as some download servers are unreachable via IPv6 even though they have an AAAA record
        downloadFile(downloadURL, tmpFilePath, true)
            .then(() => {
                if (fs.statSync(tmpFilePath).size !== fileSize) {
                    log(`❌ File size of '${fileName}' did not match the size given by the API!`);
                    return;
                }

                try {
                    fs.renameSync(tmpFilePath, finishedFilePath);
                } catch (error) {
                    if (error.code === "EXDEV") {
                        fs.cpSync(tmpFilePath, finishedFilePath);
                        fs.rmSync(tmpFilePath);
                    } else throw error;
                }

                log(`✅ Finished downloading '${fileName}'`);
            })
            .catch((error) => {
                log(`❌ Error downloading '${fileName}' (${error.code}), re-adding link to download queue`);
                links.unshift(link);
            });

        // Start the next download 2 hours later
        await sleep(HOUR_MS * 2);
    }
}

function sleep(ms) {
    return new Promise((resolve) => {
        return setTimeout(resolve, ms);
    });
}
