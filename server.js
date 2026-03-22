const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const REPO_OWNER = process.env.REPO_OWNER || "mmjohnson84BMP";
const REPO_NAME = process.env.REPO_NAME || "flowstackclaude";
const STATUS_FILE = process.env.STATUS_FILE || "SOCRATES_STATUS.json";

app.use(express.static(path.join(__dirname, "public")));

// Proxy endpoint — fetches status from GitHub with auth token server-side
app.get("/api/status", async (req, res) => {
  try {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${STATUS_FILE}`;
    const headers = {
      Accept: "application/vnd.github.v3.raw",
      "User-Agent": "socrates-monitor",
    };
    if (GITHUB_TOKEN) {
      headers.Authorization = `token ${GITHUB_TOKEN}`;
    }

    const response = await fetch(url, { headers });

    if (response.status === 404) {
      return res.json({ error: "not_found", message: "Status file not found" });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: "github_error",
        message: `GitHub API returned ${response.status}`,
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error fetching status:", error);
    res.status(500).json({ error: "fetch_error", message: error.message });
  }
});

app.get("/health", (req, res) => res.send("ok"));

app.listen(PORT, () => {
  console.log(`Socrates Monitor live on port ${PORT}`);
});
