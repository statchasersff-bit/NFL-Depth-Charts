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

app.use("/api", router);

export default app;
