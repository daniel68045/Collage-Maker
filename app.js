require("dotenv").config();
const express = require("express");
const axios = require("axios");
const querystring = require("querystring");
const sharp = require("sharp"); // Ensure sharp is imported
const fs = require("fs");
const path = require("path");

const app = express();
const port = 8888;

// Set EJS as view engine
app.set("view engine", "ejs");

// Spotify API credentials
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:8888/callback";
const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const SCOPE = "user-top-read user-library-read";

// Middleware to serve static files and parse URL-encoded bodies
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));

// Home route
app.get("/", (req, res) => {
  res.render("index");
});

// Login route (redirect to Spotify for authentication)
app.get("/login", (req, res) => {
  const authUrl = `${SPOTIFY_AUTH_URL}?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&scope=${SCOPE}&show_dialog=true`;
  res.redirect(authUrl);
});

// Callback route (Spotify redirects here after login)
app.get("/callback", async (req, res) => {
  const code = req.query.code;

  try {
    const tokenResponse = await axios.post(
      SPOTIFY_TOKEN_URL,
      querystring.stringify({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      })
    );

    const accessToken = tokenResponse.data.access_token;
    res.redirect(`/filters?access_token=${accessToken}`);
  } catch (error) {
    console.error("Error exchanging code for token:", error);
    res.status(500).send("Error during authentication");
  }
});

// Filter selection route
app.get("/filters", (req, res) => {
  const accessToken = req.query.access_token; // Pass the token to the next step
  res.render("filters", { accessToken });
});

// Recommendation route (generate chart based on filters)
app.get("/recommend", async (req, res) => {
  const { accessToken, timeRange, gridSize, chartType, showNames } = req.query;

  if (!accessToken) {
    return res.redirect("/");
  }

  try {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const totalItems = gridSize ** 2;
    let fetchedData = [];
    let offset = 0;

    // Fetch data with pagination
    while (fetchedData.length < totalItems) {
      const endpoint =
        chartType === "artists"
          ? `${SPOTIFY_API_URL}/me/top/artists`
          : `${SPOTIFY_API_URL}/me/top/tracks`;

      const response = await axios.get(endpoint, {
        headers,
        params: {
          time_range: timeRange,
          limit: Math.min(50, totalItems - fetchedData.length),
          offset,
        },
      });

      const items = response.data.items;
      fetchedData = fetchedData.concat(items);

      offset += 50;
      if (items.length < 50) break; // Exit loop if no more items
    }

    const data = fetchedData.map((item) => ({
      name: item.name,
      image: item.images?.[0]?.url || item.album?.images?.[0]?.url || null, // Use the largest image
    }));

    // High-resolution PNG size (adjust if needed)
    const gridWidth = 1200; // Fixed width for high DPI
    const gridHeight = 1200; // Fixed height for high DPI
    const cellSize = Math.floor(gridWidth / gridSize); // Base cell size
    const adjustedGridWidth = cellSize * gridSize; // Total width based on cell size
    const adjustedGridHeight = cellSize * gridSize; // Total height based on cell size

    // Fetch and resize artist images
    const imagePromises = data.map(async (item) => {
      const imageBuffer = item.image
        ? (await axios.get(item.image, { responseType: "arraybuffer" })).data
        : fs.readFileSync(path.join(__dirname, "public", "placeholder.png"));

      return sharp(imageBuffer)
        .resize(cellSize, cellSize, {
          fit: "cover",
          kernel: sharp.kernel.lanczos3, // High-quality resizing
        })
        .png({ quality: 100 }) // Preserve image quality
        .toBuffer();
    });

    const processedImages = await Promise.all(imagePromises);

    // Composite images into a single grid
    const composites = processedImages.map((buffer, index) => ({
      input: buffer,
      top: Math.floor(index / gridSize) * cellSize,
      left: (index % gridSize) * cellSize,
    }));

    // Create grid with adjusted dimensions
    const grid = sharp({
      create: {
        width: adjustedGridWidth, // Use adjusted width
        height: adjustedGridHeight, // Use adjusted height
        channels: 3,
        background: { r: 255, g: 255, b: 255 }, // White background
      },
    });

    const outputBuffer = await grid.composite(composites).png().toBuffer();
    const outputPath = path.join(__dirname, "public", "collage.png");
    fs.writeFileSync(outputPath, outputBuffer);

    res.render("recommended", {
      collagePath: "/collage.png",
      showNames: showNames === "true", // Pass visibility toggle
    });
  } catch (error) {
    console.error("Error generating chart:", error);
    res.status(500).send(`Error generating chart: ${error.message}`);
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
