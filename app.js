require("dotenv").config();
const express = require("express");
const axios = require("axios");
const querystring = require("querystring");
const sharp = require("sharp");
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

// Function to get access token using client credentials
async function getAccessToken() {
  try {
    const response = await axios.post(SPOTIFY_TOKEN_URL, querystring.stringify({
      grant_type: "client_credentials",
    }), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: {
        username: CLIENT_ID,
        password: CLIENT_SECRET,
      },
    });

    return response.data.access_token;
  } catch (error) {
    console.error("Error fetching access token:", error);
    throw new Error("Unable to fetch access token");
  }
}

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
  const { accessToken, timeRange, gridSize, chartType } = req.query;

  if (!accessToken) {
    return res.redirect("/");
  }

  try {
    const headers = { Authorization: `Bearer ${accessToken}` };
    let data;

    if (chartType === "artists") {
      // Fetch user's top artists based on time range
      const response = await axios.get(`${SPOTIFY_API_URL}/me/top/artists`, {
        headers,
        params: { time_range: timeRange, limit: gridSize ** 2 },
      });
      data = response.data.items.map(artist => ({
        name: artist.name,
        image: artist.images.length > 0 ? artist.images[0].url : null,
      }));
    } else if (chartType === "songs") {
      // Fetch user's top tracks based on time range
      const response = await axios.get(`${SPOTIFY_API_URL}/me/top/tracks`, {
        headers,
        params: { time_range: timeRange, limit: gridSize ** 2 },
      });
      data = response.data.items.map(track => ({
        name: track.name,
        image: track.album.images.length > 0 ? track.album.images[0].url : null,
      }));
    }

    // Fetch and process images
    const imagePromises = data.map(async item => {
      const imageBuffer = item.image
        ? (await axios.get(item.image, { responseType: "arraybuffer" })).data
        : fs.readFileSync(path.join(__dirname, "public", "placeholder.png"));

      return sharp(imageBuffer).resize(200, 200).toBuffer();
    });

    const processedImages = await Promise.all(imagePromises);

    // Create grid
    const grid = sharp({
      create: {
        width: gridSize * 200,
        height: gridSize * 200,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    });

    const composites = processedImages.map((imageBuffer, index) => ({
      input: imageBuffer,
      top: Math.floor(index / gridSize) * 200,
      left: (index % gridSize) * 200,
    }));

    const outputBuffer = await grid.composite(composites).png().toBuffer();
    const outputPath = path.join(__dirname, "public", "collage.png");
    fs.writeFileSync(outputPath, outputBuffer);

    // Group names for display
    const nameRows = [];
    for (let i = 0; i < data.length; i += gridSize) {
      nameRows.push(data.slice(i, i + gridSize).map(item => item.name));
    }

    res.render("recommended", { collagePath: "/collage.png", nameRows });
  } catch (error) {
    console.error("Error generating chart:", error);
    res.status(500).send(`Error generating chart: ${error.message}`);
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

