import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

const ALLOWED_ORIGINS = [
  "https://statchasers.com",
  "https://www.statchasers.com",
  "http://localhost",
  "http://localhost:3000",
  "http://localhost:5173",
];

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isAllowed =
        ALLOWED_ORIGINS.includes(origin) ||
        /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
        origin.includes(".replit.dev") ||
        origin.includes(".replit.app") ||
        origin.includes(".repl.co");
      callback(null, isAllowed);
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Embeddable WordPress/Divi script. A single <script src=".../embed/depth-charts.js">
// tag plus a <div id="statchasers-depth-charts"> renders the public page in an iframe.
app.get("/embed/depth-charts.js", (req, res) => {
  const baseUrl = process.env.REPLIT_DOMAINS
    ? "https://" + process.env.REPLIT_DOMAINS.split(",")[0]
    : "";
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(`(function() {
  var container = document.getElementById('statchasers-depth-charts');
  if (!container) return;
  var iframe = document.createElement('iframe');
  iframe.src = '${baseUrl}/nfl-depth-charts';
  iframe.title = 'StatChasers NFL Depth Charts';
  iframe.style.width = '100%';
  iframe.style.minHeight = '900px';
  iframe.style.border = 'none';
  iframe.style.borderRadius = '8px';
  iframe.setAttribute('loading', 'lazy');
  container.appendChild(iframe);
})();
`);
});

app.use("/api", router);

export default app;
