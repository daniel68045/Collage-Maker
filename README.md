## Spotify Music Collage Maker
A web application that generates a collage based on your top artists or songs on Spotify. Users can customize the collage by selecting time ranges, grid sizes, and whether to display artist or song names. The collage is created using Spotify's Web API and rendered with dynamically generated images and text.

## Stack

**Backend**: Node.js with Express  
**Frontend**: EJS templates for rendering HTML  
**API**: Spotify Web API for fetching user data  
**Image Processing**: Sharp library for creating and manipulating image grids  
**Session Management**: Express-session for creating user sessions

## How to Run

1. Clone into repository with web URL: 
    ```
    git clone https://github.com/daniel68045/Collage-Maker.git
    ```
2. Install dependencies:
    ```
    npm install
    ```
3. Set up enviromental variables in .env file
    ```
    CLIENT_ID=<your-spotify-client-id>
    CLIENT_SECRET=<your-spotify-client-secret>
    SESSION_SECRET=<a-random-secret-key>    
    ```
4. Run the application
    ```
    node app.js
    ```

## Note

This app is in development mode, Spotify restricts the number of users that can access its Web API, please submit a response to this form so you can be added to the list of valid users: https://docs.google.com/forms/d/1RczCzGf9NKg6bcSy68FWf1kPq-NUKQZfLnEnpwsyWQ0/edit
