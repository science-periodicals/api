import { Router } from 'express';
import { contextLink } from '@scipe/jsonld';
import { addLibrarian, parseQuery } from '../middlewares/librarian';
import { cache } from '../utils/cache-utils';

const router = new Router({ caseSensitive: true });

/**
 * Get a type by @id
 */
router.get('/:typeId', addLibrarian, parseQuery, (req, res, next) => {
  cache(
    req,
    callback => {
      let typeId = `type:${req.params.typeId}`;
      if (req.query.version) {
        typeId += `?version=${req.query.version}`;
      }

      req.librarian.get(
        typeId,
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
 * Search for types
 */
router.get('/', addLibrarian, parseQuery, (req, res, next) => {
  cache(
    req,
    callback => {
      req.librarian.search(
        'type',
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
