require("dotenv").config();
const express = require("express");
const axios = require("axios");
const querystring = require("querystring");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const session = require("express-session");

const app = express();
const port = 8888;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:8888/callback";
const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const SCOPE = "user-top-read user-library-read";

app.set("view engine", "ejs");

app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);

// Home route
app.get("/", (req, res) => {
  res.render("index");
});

// Login route
app.get("/login", (req, res) => {
  const authUrl = `${SPOTIFY_AUTH_URL}?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&scope=${SCOPE}&show_dialog=true`;
  res.redirect(authUrl);
});

// Logout route
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
      return res.status(500).send("Error logging out. Please try again.");
    }
    res.redirect("/");
  });
});

// Callback route
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
    req.session.accessToken = accessToken;
    res.redirect("/filters");
  } catch (error) {
    console.error("Error during Spotify callback:", error.message);
    res.redirect("/");
  }
});

// Filter selection route
app.get("/filters", (req, res) => {
  if (!req.session.accessToken) {
    return res.redirect("/");
  }
  res.render("filters");
});

// Collage route
app.post("/collage", async (req, res) => {
  const accessToken = req.session.accessToken;
  const { timeRange, gridSize, chartType, showNames } = req.body;

  if (!accessToken) {
    return res
      .status(400)
      .send("Access token is missing. Please log in again.");
  }

  try {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const totalItems = gridSize ** 2;
    let fetchedData = [];
    let offset = 0;

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
      if (items.length < 50) break;
    }

    while (fetchedData.length < totalItems) {
      fetchedData.push({ name: "No artist available", image: null });
    }

    const data = fetchedData.map((item) => ({
      name: item.name,
      image: item.images?.[0]?.url || item.album?.images?.[0]?.url || null,
    }));

    const cellSize = Math.floor(1200 / gridSize) * 2;
    const adjustedGridWidth = cellSize * gridSize;
    const adjustedGridHeight = cellSize * gridSize;
    const composites = [];

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const row = Math.floor(i / gridSize);
      const col = i % gridSize;

      const baseFontSize = -1;
      const scalingFactor = 4;
      const fontSize = Math.max(
        baseFontSize,
        Math.floor(baseFontSize + scalingFactor * Math.log(cellSize))
      );
      const textPadding = Math.floor(fontSize / 4);

      const tempSvg = `
          <svg xmlns="http://www.w3.org/2000/svg" width="5000" height="200">
            <text x="0" y="${fontSize}" font-size="${fontSize}" font-family="Arial" alignment-baseline="hanging">${item.name}</text>
          </svg>`;
      const tempBuffer = Buffer.from(tempSvg);
      const textMetadata = await sharp(tempBuffer).metadata();
      let textWidth = textMetadata.width || 100;

      if (textWidth + textPadding * 2 > cellSize) {
        textWidth = cellSize - textPadding * 2;
      }

      const highDpiScale = 3;
      const scaledFontSize = fontSize * highDpiScale;
      const scaledTextPadding = textPadding * highDpiScale;
      const scaledTextWidth = (textWidth + textPadding * 2) * highDpiScale;

      const highResTextSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${scaledTextWidth}" height="${
        (fontSize + textPadding * 2) * highDpiScale
      }">
        <rect x="0" y="0" width="${scaledTextWidth}" height="${
        (fontSize + textPadding * 2) * highDpiScale
      }" fill="black" />
        <text x="${scaledTextPadding}" y="${
        scaledFontSize + scaledTextPadding / 2
      }" font-size="${scaledFontSize}" fill="white" text-anchor="start" alignment-baseline="hanging" 
    font-family="Monospace" letter-spacing="-2.5">
          ${item.name}
        </text>
      </svg>`;

      const imageBuffer = item.image
        ? (await axios.get(item.image, { responseType: "arraybuffer" })).data
        : await sharp({
            create: {
              width: cellSize,
              height: cellSize,
              channels: 3,
              background: { r: 255, g: 255, b: 255 },
            },
          })
            .png()
            .toBuffer();

      const imageLayer = await sharp(imageBuffer)
        .resize(cellSize, cellSize, {
          fit: "cover",
          kernel: sharp.kernel.lanczos3,
        })
        .png()
        .toBuffer();

      composites.push({
        input: imageLayer,
        top: row * cellSize,
        left: col * cellSize,
      });
    }

    const grid = sharp({
      create: {
        width: adjustedGridWidth,
        height: adjustedGridHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    });

    const outputBuffer = await grid
      .composite(composites)
      .png({ quality: 100 })
      .toBuffer();
    const outputPath = path.join(__dirname, "public", "collage.png");
    fs.writeFileSync(outputPath, outputBuffer);

    res.render("collage", {
      collagePath: "/collage.png",
      filters: { timeRange, gridSize, chartType, showNames },
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
