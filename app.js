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
      grant_type: "client_credentials"
    }), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: {
        username: CLIENT_ID,
        password: CLIENT_SECRET
      }
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
        client_secret: CLIENT_SECRET
      })
    );

    const accessToken = tokenResponse.data.access_token;
    res.redirect(`/recommend?access_token=${accessToken}`);
  } catch (error) {
    console.error("Error exchanging code for token:", error);
    res.status(500).send("Error during authentication");
  }
});

// Recommendation route (generate artist recommendations)
app.get("/recommend", async (req, res) => {
  const accessToken = req.query.access_token || await getAccessToken();

  if (!accessToken) {
    return res.redirect("/");
  }

  try {
    const headers = { Authorization: `Bearer ${accessToken}` };

    // Fetch user's top artists
    const topArtistsResponse = await axios.get(`${SPOTIFY_API_URL}/me/top/artists`, { headers });
    const topArtists = topArtistsResponse.data.items;

    if (!topArtists || topArtists.length === 0) {
      return res.send("No top artists found.");
    }

    // Prepare artist data (limit to 25 artists for a 5x5 grid)
    const artists = topArtists.slice(0, 25).map(artist => ({
      name: artist.name,
      image: artist.images.length > 0 ? artist.images[0].url : null, // Use artist's image if available
    }));

    // Fetch and process artist images
    const imagePromises = artists.map(async (artist, index) => {
      const artistImageBuffer = artist.image
        ? (await axios.get(artist.image, { responseType: "arraybuffer" })).data
        : fs.readFileSync(path.join(__dirname, "public", "placeholder.png")); // Use placeholder if no image

      // Add text overlay for the artist's name
      return sharp(artistImageBuffer)
        .resize(200, 200) // Resize each image to 200x200 pixels
        .composite([{
          input: Buffer.from(`
            <svg width="200" height="200">
              <rect x="0" y="150" width="200" height="50" fill="black" opacity="0.6"/>
              <text x="100" y="180" font-size="14" font-family="Arial" fill="white" text-anchor="middle">${artist.name}</text>
            </svg>
          `),
          top: 0,
          left: 0
        }])
        .toBuffer();
    });

    const processedImages = await Promise.all(imagePromises);

    // Combine into a 5x5 grid
    const grid = sharp({
      create: {
        width: 1000, // 5 images * 200px
        height: 1000, // 5 images * 200px
        channels: 3,
        background: { r: 255, g: 255, b: 255 }, // White background
      },
    });

    const composites = processedImages.map((imageBuffer, index) => ({
      input: imageBuffer,
      top: Math.floor(index / 5) * 200,
      left: (index % 5) * 200,
    }));

    const outputBuffer = await grid.composite(composites).png().toBuffer();

    // Save or serve the image
    const outputPath = path.join(__dirname, "public", "collage.png");
    fs.writeFileSync(outputPath, outputBuffer);

    res.sendFile(outputPath); // Serve the generated image to the client
  } catch (error) {
    console.error("Error creating collage:", error);
    res.status(500).send(`Error creating collage: ${error.message}`);
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
