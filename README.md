# Coming Soon Page with Daily Quotes

This is a MERN stack application featuring a "Coming Soon" page and an interactive Daily Quote section powered by the Groq API.

## Prerequisites

1.  **Node.js**: You must have Node.js installed. Download it from [nodejs.org](https://nodejs.org/).
2.  **MongoDB**: You need a MongoDB connection string. You can use [MongoDB Atlas](https://www.mongodb.com/atlas) for a free cloud database.
3.  **Groq API Key**: Get your API key from [Groq Cloud](https://console.groq.com/).

## Setup Instructions

### 1. Backend Setup

Navigate to the `server` directory and install dependencies:

```bash
cd server
npm install
```

Create a `.env` file in the `server` directory (or rename `.env.example`) and add your credentials:

```env
MONGODB_URI=your_mongodb_connection_string
GROQ_API_KEY=your_groq_api_key
PORT=5000
```

Start the backend server:

```bash
npm start
```

### 2. Frontend Setup

Open a new terminal, navigate to the `client` directory and install dependencies:

```bash
cd client
npm install
```

Start the frontend development server:

```bash
npm run dev
```

The application will be available at standard Vite port (usually `http://localhost:5173`).

## Features

-   **Coming Soon Hero**: Beautiful, responsive layout with glassmorphism effects.
-   **Daily Quote**: Fetches a new motivational quote from Groq API once per day and caches it in MongoDB.
-   **Premium Design**: Uses Outfit and Playfair Display fonts with dynamic gradients.
