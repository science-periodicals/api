import { Router } from 'express';
import bodyParser from 'body-parser';
import flatten from 'lodash/flatten';
import omit from 'lodash/omit';
import asyncMap from 'async/map';
import { toIndexableString } from '@scipe/collate';
import { getId, arrayify } from '@scipe/jsonld';
import {
  getScopeId,
  createId,
  getRootPartId,
  parseUsername
} from '@scipe/librarian';
import createError from '@scipe/create-error';
import { addLibrarian, parseQuery } from '../middlewares/librarian';

const jsonParser = bodyParser.json({
  limit: '100mb',
  type: ['application/json', 'application/*+json']
});
const router = new Router({ caseSensitive: true });

/**
 * Take a list of _id and _rev from PouchDB (req.body) and return the
 * missing documents with full history (document are retrieved with
 * `revs=true`).
 *
 * - req.body: list of _id and _rev { id, rev } sent by PouchDB
 */
router.post(
  '/periodical/:periodicalId',
  addLibrarian,
  parseQuery,
  jsonParser,
  (req, res, next) => {
    req.librarian.checkReadAcl(
      `journal:${req.params.periodicalId}`,
      { acl: req.app.locals.config.acl },
      err => {
        if (err) {
          req.log.trace(
            { err, periodicalId: `journal:${req.params.periodicalId}` },
            'load periodical: error in checkReadAcl'
          );
          return next(err);
        }
        next();
      }
    );
  },
  (req, res, next) => {
    const _id = createId('journal', `journal:${req.params.periodicalId}`)._id;

    req.librarian.db.get(
      {
        url: `/${encodeURIComponent(_id)}`,
        qs: { revs: true },
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          req.log.trace(
            { err, periodicalId: `journal:${req.params.periodicalId}` },
            'load periodical: error in get'
          );
          return next(err);
        }

        if (
          arrayify(req.body).some(
            ({ id, rev }) => body._id === id && body._rev === rev
          )
        ) {
          req.log.trace(
            { periodicalId: `journal:${req.params.periodicalId}` },
            'API /load OK'
          );
          return res.json([]);
        }

        req.log.trace(
          { periodicalId: `journal:${req.params.periodicalId}` },
          'API /load OK'
        );
        res.json([body]);
      }
    );
  }
);

/**
 * Take a list of _id and _rev from PouchDB (req.body) and return the
 * missing documents with full history (document are retrieved with
 * `revs=true`).
 *
 * Note: we always fetch _all_ the versions
 *
 * - req.body: list of _id and _rev { id, rev } sent by PouchDB
 */
router.post(
  '/graph/:graphId',
  addLibrarian,
  parseQuery,
  jsonParser,
  (req, res, next) => {
    let graphId = `graph:${req.params.graphId}`;
    req.graphId = graphId;

    const TYPES = ['graph', 'release', 'action', 'workflow', 'type'];
    if (
      arrayify(req.query.type).some(type => {
        return !TYPES.includes(type);
      })
    ) {
      return next(
        createError(
          400,
          `invalid type query string parameter type must be a JSON list containing values from: ${TYPES.join(
            ', '
          )}`
        )
      );
    }

    req.types = req.query.type || TYPES;

    req.librarian.checkPublicAvailability(req.graphId, (err, isPublic) => {
      if (err) {
        req.log.trace(
          { err, graphId: req.graphId },
          'load: error in checkPublicAvailability'
        );
        return next(err);
      }
      req.librarian.checkAcl(
        { acl: req.app.locals.config.acl, docs: req.graphId },
        (err, check) => {
          if (err) {
            req.log.trace(
              { err, graphId: req.graphId },
              'load: error in checkAcl'
            );
            return next(err);
          }
          // this will be needed later when using checkReadAclSync to further filter out the documents
          req.isPublic = isPublic;
          req.check = check;
          next();
        }
      );
    });
  },
  (req, res, next) => {
    const scopeId = getScopeId(req.graphId);
    req.scopeId = scopeId;

    asyncMap(
      req.types,
      (type, cb) => {
        let qs;

        if (type === 'graph') {
          qs = {
            key: JSON.stringify(toIndexableString([scopeId, 'graph']))
          };
        } else if (type === 'workflow') {
          const graph = req.check.store.get(req.graphId);
          const journalId = getScopeId(getRootPartId(graph));
          req.journalScopeId = journalId;
          const workflowId = getId(graph && graph.workflow);
          if (!journalId || !workflowId) {
            return cb(null, null);
          }
          qs = {
            key: JSON.stringify(
              toIndexableString([journalId, 'workflow', workflowId])
            )
          };
        } else if (type === 'type') {
          const graph = req.check.store.get(req.graphId);
          const journalId = getScopeId(getRootPartId(graph));
          req.journalScopeId = journalId;
          const typeId = getId(graph && graph.additionalType);
          if (!journalId || !typeId) {
            return cb(null, null);
          }
          qs = {
            key: JSON.stringify(toIndexableString([journalId, 'type', typeId]))
          };
        } else {
          // Note: that will also get all the version of the releases (type === `release`)
          qs = {
            startkey: JSON.stringify(toIndexableString([scopeId, type, ''])),
            endkey: JSON.stringify(toIndexableString([scopeId, type, '\ufff0']))
          };
        }

        req.librarian.db.get(
          {
            url: '/_all_docs',
            qs,
            json: true
          },
          (err, resp, body) => {
            if ((err = createError(err, resp, body))) {
              return cb(err);
            }
            cb(null, arrayify(body.rows));
          }
        );
      },
      (err, data) => {
        if (err) {
          req.log.trace(
            { err, graphId: req.graphId, types: req.types },
            'load: error in asyncMap'
          );
          return next(err);
        }

        const rows = flatten(data);
        req.revs = rows
          .filter(row => row && row.id && row.value && row.value.rev)
          .map(row => ({ id: row.id, rev: row.value.rev }));

        next();
      }
    );
  },
  (req, res, next) => {
    const pouchInput = req.body || [];

    const pouchIdMap = pouchInput.reduce((idMap, doc) => {
      if (doc.id && doc.rev) {
        idMap[doc.id] = doc.rev;
      }
      return idMap;
    }, {});

    const couchIdMap = req.revs.reduce((idMap, doc) => {
      if (doc.id && doc.rev) {
        idMap[doc.id] = doc.rev;
      }
      return idMap;
    }, {});

    const docs = req.revs.filter(rev => {
      return !(rev.id in pouchIdMap && rev.rev === pouchIdMap[rev.id]);
    });

    // add potentially deleted docs to docs (those id where sent by PouchDB but can't be found in CouchDB => they probably were deleted and the user start a fast forward replication _after_ those deletion => we need to send them to PouchDB
    const deleted = pouchInput.filter(({ id }) => !(id in couchIdMap));

    if (!docs.length && !deleted.length) {
      return res.json([]);
    }

    req.librarian.db.post(
      {
        url: '/_bulk_get',
        json: {
          docs: docs.concat(deleted.map(data => omit(data, ['rev'])))
        },
        qs: {
          revs: true
        }
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          req.log.trace(
            { err, graphId: req.graphId },
            'load: error in _bulk_get'
          );
          return next(err);
        }
        req.log.trace({ graphId: req.graphId }, 'API /load');

        try {
          var payload = arrayify(body.results)
            .map(entry => {
              // TODO better understand the _bulk_get response payload.
              // `docs` is an array but it seems to always have only 1 entry.
              // doesn't seem to be documentation as to what the other docs may be
              // (see https://docs.couchdb.org/en/stable/api/database/bulk-api.html#db-bulk-get) maybe the attachments ?
              const doc = entry.docs && entry.docs[0] && entry.docs[0].ok;
              if (doc) {
                const safeDoc = req.librarian.checkReadAclSync(doc, {
                  acl: req.app.locals.config.acl,
                  isPublic: req.isPublic,
                  check: req.check,
                  scopeId:
                    (doc['@id'] || '').startsWith('workflow:') ||
                    (doc['@id'] || '').startsWith('type:')
                      ? req.journalScopeId
                      : req.scopeId
                });

                if (safeDoc) {
                  return '@lucene' in safeDoc
                    ? omit(safeDoc, ['@lucene'])
                    : safeDoc;
                }
              }
            })
            .filter(Boolean);
        } catch (err) {
          req.log.error(
            { err, graphId: req.graphId },
            'load: error in checkReadAclSync'
          );
        }

        handleAnonymize(
          payload,
          {
            username: parseUsername(req),
            anonymize: req.app.locals.config.anonymize,
            librarian: req.librarian
          },
          (err, payload) => {
            if (err) {
              req.log.trace(
                { err, graphId: req.graphId },
                'load: error in anonymize'
              );
              return next(err);
            }

            req.log.trace(
              {
                graphId: req.graphId,
                payloadLength: payload && payload.length
              },
              'API /load after ACL'
            );

            res.json(payload);
          }
        );
      }
    );
  }
);

function handleAnonymize(
  payload,
  { username, anonymize, librarian },
  callback
) {
  const viewer = username
    ? `user:${username}`
    : { '@type': 'Audience', audienceType: 'public' };

  librarian.anonymize(payload, { viewer, anonymize }, callback);
}

export default router;
