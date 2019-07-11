import { Router } from 'express';
import { contextLink } from '@scipe/jsonld';
import { addLibrarian, parseQuery } from '../middlewares/librarian';
import { cache } from '../utils/cache-utils';

const router = new Router({ caseSensitive: true });

/**
 * Get a worfklow by @id
 */
router.get('/:worfklowId', addLibrarian, parseQuery, (req, res, next) => {
  cache(
    req,
    callback => {
      let workflowId = `workflow:${req.params.worfklowId}`;
      if (req.query.version) {
        workflowId += `?version=${req.query.version}`;
      }

      req.librarian.get(
        workflowId,
        {
          acl: req.app.locals.config.acl,
          anonymize: req.app.locals.config.anonymize
        },
        callback
      );
    },
    (err, payload) => {
      if (err) return next(err);
      res.set('Link', contextLink);
      res.send(payload);
    }
  );
});

/**
 * Search for worfklows
 */
router.get('/', addLibrarian, parseQuery, (req, res, next) => {
  cache(
    req,
    callback => {
      req.librarian.search(
        'workflow',
        req.query,
        {
          acl: req.app.locals.config.acl,
          baseUrl: `${req.protocol}://${req.headers.host}${req.baseUrl}${req.path}`,
          anonymize: req.app.locals.config.anonymize
        },
        callback
      );
    },
    (err, payload) => {
      if (err) return next(err);
      res.set('Link', contextLink);
      res.send(payload);
    }
  );
});

export default router;
