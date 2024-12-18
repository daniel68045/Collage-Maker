require("dotenv").config();
const express = require("express");
const axios = require("axios");
const querystring = require("querystring");

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
  const accessToken = req.query.access_token || await getAccessToken(); // Use client credentials if no token provided
  console.log("Access Token being used:", accessToken);

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

    // Collect genres from the user's top artists
    const userGenres = new Set();
    topArtists.forEach(artist => {
      artist.genres.forEach(genre => userGenres.add(genre));
    });

    // Fetch saved tracks and albums
    const savedArtists = new Set();
    const trackResponse = await axios.get(`${SPOTIFY_API_URL}/me/tracks?limit=50`, { headers });
    trackResponse.data.items.forEach(item => savedArtists.add(item.track.artists[0].name));

    const albumResponse = await axios.get(`${SPOTIFY_API_URL}/me/albums?limit=50`, { headers });
    albumResponse.data.items.forEach(item => savedArtists.add(item.album.artists[0].name));

    // Use genres to search for related artists
    let recommendations = [];
    for (const genre of userGenres) {
      const searchResponse = await axios.get(`${SPOTIFY_API_URL}/search`, {
        headers,
        params: { q: `genre:${genre}`, type: "artist", limit: 5 }
      });

      searchResponse.data.artists.items.forEach(artist => {
        if (!savedArtists.has(artist.name) && artist.popularity > 50) {
          recommendations.push(artist.name);
        }
      });
    }

    // Fallback to user's top artists if no recommendations are found
    if (recommendations.length === 0) {
      recommendations = topArtists.slice(0, 5).map(artist => artist.name);
    }

    recommendations = [...new Set(recommendations)];
    res.render("recommended", { recommendations });

  } catch (error) {
    if (error.response) {
      console.error("Spotify API Error:", error.response.data);
      res.status(error.response.status).send(error.response.data);
    } else {
      console.error("Unknown Error:", error.message);
      res.status(500).send("An unknown error occurred");
    }
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
