import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import stylesRouter from "./styles";
import documentsRouter from "./documents";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(stylesRouter);
// Mounted last: this router applies requireAuth to everything it owns.
router.use(documentsRouter);

export default router;
