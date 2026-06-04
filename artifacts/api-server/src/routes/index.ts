import { Router, type IRouter } from "express";
import healthRouter from "./health";
import depthChartsRouter from "./depthCharts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(depthChartsRouter);

export default router;
