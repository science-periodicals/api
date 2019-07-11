import { Router } from 'express';
import bodyParser from 'body-parser';
import pick from 'lodash/pick';
import omit from 'lodash/omit';
import { frame, contextLink } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { addLibrarian, parseQuery, acl } from '../middlewares/librarian';
import { cache, uncache } from '../utils/cache-utils';

const jsonParser = bodyParser.json({
  limit: '100mb',
  type: ['application/json', 'application/*+json']
});

const router = new Router({ caseSensitive: true });

/**
 * Get a graph
 */
router.get('/:graphId', addLibrarian, parseQuery, (req, res, next) => {
  cache(
    req,
    callback => {
      let graphId = `graph:${req.params.graphId}`;
      if (req.query.version) {
        graphId += `?version=${req.query.version}`;
      }

      req.librarian.get(
        graphId,
        {
          acl: req.app.locals.config.acl,
          potentialActions: req.query.potentialActions,
          nodes: req.query.nodes,
          anonymize: req.app.locals.config.anonymize
        },
        (err, doc) => {
          if (err) return callback(err);
          if (doc['@type'] !== 'Graph') {
            return callback(createError(404, 'Not found'));
          }

          if (!req.query.frame) {
            return callback(null, doc);
          }

          // frame
          let docFrame;
          if (req.query.frame === true) {
            let mainEntityId;
            if (doc.mainEntity) {
              mainEntityId = doc.mainEntity['@id'] || doc.mainEntity;
            }
            if (typeof mainEntityId !== 'string') {
              return callback(
                createError(
                  400,
                  'A frame must be specified as the Graph does not have a main entity'
                )
              );
            }

            docFrame = {
              '@id': mainEntityId,
              '@embed': '@always'
            };
          } else {
            docFrame = req.query.frame;
          }

          // we omit the @id in order to avoid framing a named graph (more complex)
          frame(omit(doc, ['@id']), docFrame, (err, framed) => {
            if (err) return callback(err);
            callback(null, framed);
          });
        }
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
 * Delete a graph
 */
router.delete('/:graphId', addLibrarian, acl(), (req, res, next) => {
  req.librarian.delete(
    `graph:${req.params.graphId}`,
    {
      acl: req.app.locals.config.acl,
      anonymize: req.app.locals.config.anonymize
    },
    (err, deleted) => {
      if (err) return next(err);
      res.set('Link', contextLink);
      res.json(deleted);

      uncache(req, deleted, err => {
        if (err) {
          req.log.error(
            { err, deleted, url: req.originalUrl },
            `error invalidating cache`
          );
        }
      });
    }
  );
});

/**
 * Search for Graphs
 * Note that public sifter need to be able to query that route (so need to be cautious with acl and not use `the acl()` middleware...)
 */
router.get('/', addLibrarian, parseQuery, (req, res, next) => {
  cache(
    req,
    callback => {
      req.librarian.search(
        'graph',
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
      if (err) {
        return next(err);
      }
      res.set('Link', contextLink);
      res.send(payload);
    }
  );
});

/**
 * Same as GET (used to allow user to search long string of text that would
 * create issue with URL length limits)
 */
router.post('/', addLibrarian, parseQuery, jsonParser, (req, res, next) => {
  cache(
    req,
    callback => {
      req.librarian.search(
        'graph',
        Object.assign(
          pick(req.query, [
            'addActiveRoleIds',
            'includeDocs',
            'potentialActions',
            'nodes',
            'limit'
          ]),
          req.body
        ),
        {
          acl: req.app.locals.config.acl,
          baseUrl: `${req.protocol}://${req.headers.host}${req.baseUrl}${req.path}`,
          anonymize: req.app.locals.config.anonymize
        },
        callback
      );
    },
    (err, payload) => {
      if (err) {
        return next(err);
      }
      res.set('Link', contextLink);
      res.send(payload);
    }
  );
});

export default router;
