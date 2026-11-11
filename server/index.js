import express from "express";
import quoteHandler from "./quote-handler.js";
import health from "../api/health.js";
import stocksHandler from "./directory.js";

import heatmapHandler from "./heatmap-handler.js";

import { securityHeaders } from "./security.js";

const app = express();
app.disable("x-powered-by");
app.use(securityHeaders);
app.all("/api/health", health);
app.all("/api/stocks", stocksHandler);
app.all("/api/heatmap", heatmapHandler);
app.all("/api/quote/:symbol", quoteHandler);
app.use(express.static("dist"));
app.listen(Number(process.env.PORT) || 3001, "0.0.0.0", () => {
  console.log("Tickr API listening on port " + (process.env.PORT || 3001));
});
