const express = require("express");
require("dotenv").config();

const { attachSession } = require("./middleware/auth");
const { attachLanguage } = require("./middleware/i18n");

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set("view engine", "ejs");
app.set("views", "./views");
app.set("trust proxy", 1); // so req.ip is correct behind a reverse proxy (rate limiting depends on it)

// Static assets + form parsing (increased limit for AI produce photos)
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use(express.json({ limit: "15mb" }));

// Session + language must run before routes, since routes/views rely on
// req.user, req.session.csrfToken, req.lang and res.locals.t.
app.use(attachSession);
app.use(attachLanguage);

// Routes
const homeRouter = require("./routes/home");
const authRouter = require("./routes/auth");
const cropsRouter = require("./routes/crops");
const pricesRouter = require("./routes/prices");
const ordersRouter = require("./routes/orders");
const poolRouter = require("./routes/pool");
const ussdRouter = require("./routes/ussd");

app.use("/", homeRouter);
app.use("/", authRouter);
app.use("/", cropsRouter);
app.use("/", pricesRouter);
app.use("/", ordersRouter);
app.use("/", poolRouter);
app.use("/", ussdRouter);

app.listen(PORT, () => {
  console.log(`FarmConnect running at http://localhost:${PORT}`);
});
