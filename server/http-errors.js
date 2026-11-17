/* One shape for every error the API sends, so the website can always read it:
   { success: false, code: "SOME_CODE", message: "Words for a person", requestId: "ab12cd34" } */

function fail(res, status, code, message, extra = {}) {
  return res.status(status).json({
    success: false,
    code,
    message,
    ...extra,
    requestId: res.req && res.req.id
  });
}

module.exports = { fail };
