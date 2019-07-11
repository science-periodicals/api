import { contextLink } from '@scipe/jsonld';

export default function error(config) {
  return function(err, req, res, next) {
    if (res.headersSent) {
      if (req.log) {
        req.log.trace({ err }, 'headers were already sent');
      }
      // See https://expressjs.com/en/guide/error-handling.html
      return next(err);
    }

    // stripe error use `code` as string but provide a `statusCode`
    const statusCode = err.statusCode || err.code || 400;
    let payload;
    if (err.action) {
      payload = Object.assign({}, err.action, {
        actionStatus: 'FailedActionStatus', // always overwrite actionStatus
        error: Object.assign(
          {
            '@type': 'Error',
            description: err.message,
            statusCode
          },
          err.action.error
        )
      });
    } else {
      payload = {
        '@type': 'Error',
        statusCode,
        description: err.message || ''
      };
    }

    res
      .set('Link', contextLink)
      .set('Content-Type', 'application/json')
      .status(statusCode)
      .json(payload);
  };
}
