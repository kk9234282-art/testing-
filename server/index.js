import express from "express";
import quoteHandler from "./quote-handler.js";
import health from "../api/health.js";
import stocksHandler from "./directory.js";

const app = express();
app.get("/api/health", health);
app.get("/api/stocks", stocksHandler);
app.get("/api/quote/:symbol", quoteHandler);
app.use(express.static("dist"));
app.listen(Number(process.env.PORT) || 3001, "0.0.0.0", () => {
  console.log("Tickr API listening on port " + (process.env.PORT || 3001));
});
