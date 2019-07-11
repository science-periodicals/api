import { Router } from 'express';
import { context } from '@scipe/jsonld';

const router = new Router({ caseSensitive: true });

router.get('/', (req, res, next) => {
  // serve science @context if request is made with
  // Accept header set to application/ld+json or application/json
  const accepts = req.accepts([
    'text/html',
    'application/ld+json',
    'application/json'
  ]);

  if (
    !req.headers['x-pouchdb'] &&
    (accepts === 'application/ld+json' || accepts === 'application/json')
  ) {
    // Chrome can display ajax response when pressing back button so we invalidate the cache
    // see http://stackoverflow.com/questions/9956255/chrome-displays-ajax-response-when-pressing-back-button
    res.header('Vary', 'Accept');

    // Allow CORS for the context
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );
    res.set('Content-Type', 'application/ld+json');
    return res.json(context);
  } else {
    return next();
  }
});

export default router;
