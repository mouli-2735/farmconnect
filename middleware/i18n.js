const { makeT, SUPPORTED } = require("../lib/i18n");

const LANG_COOKIE = "fc_lang";

function attachLanguage(req, res, next) {
  let lang = req.query.lang || (req.cookies && req.cookies[LANG_COOKIE]) || "en";
  if (!SUPPORTED.includes(lang)) lang = "en";

  if (req.query.lang && SUPPORTED.includes(req.query.lang)) {
    res.setHeader("Set-Cookie", `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`);
  }

  req.lang = lang;
  res.locals.lang = lang;
  res.locals.t = makeT(lang);
  next();
}

module.exports = { attachLanguage, LANG_COOKIE };
